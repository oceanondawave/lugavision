# This file should be named app.py

import os
import requests
import json
from flask import Flask, request, jsonify
from gtts import gTTS
from pydub import AudioSegment
from io import BytesIO
import traceback
# threading is no longer needed

# --- CONFIGURATION ---
# This service now needs all the secrets
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY')

app = Flask(__name__)

# --- HELPER FUNCTIONS ---

def get_vision_description(image_url):
    """Gets a Vietnamese description of an image using the OpenRouter Vision API."""
    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json"
            },
            data=json.dumps({
                "model": "google/gemma-3-27b-it:free",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Hãy mô tả hình ảnh từ khái quát đến chi tiết, càng chi tiết càng tốt. Mô tả ảnh phải hợp lý và chi tiết về không gian và hãy mô tả với chất lượng tốt nhất có thể để giúp người khiếm thị nhận biết và có trải nghiệm thật chính xác. Mô tả phải chân thực và chính xác, không bỏ sót bất kỳ chi tiết nào, không được thay đổi sự thật và bịa đặt về chi tiết không có thật trong hình ảnh. Nếu trong ảnh có chữ bằng Tiếng Anh hoặc ngôn ngữ khác, hãy giữ nguyên nó trong câu trả lời sau đó dịch sang Tiếng Việt. Hãy luôn trả về ngay mô tả hình ảnh, không cần giới thiệu hay nhắc lại yêu cầu."},
                            {"type": "image_url", "image_url": {"url": image_url}}
                        ]
                    }
                ]
            })
        )
        response.raise_for_status()
        data = response.json()
        return data['choices'][0]['message']['content']
    except requests.exceptions.RequestException as e:
        print(f"OpenRouter Vision API error: {e}")
        return None

def clean_markdown_for_tts(text):
    """Removes common markdown characters from text for cleaner TTS output."""
    return text.replace('*', '').replace('_', '').replace('~', '').replace('`', '').replace('#', '')

def get_ogg_audio(text):
    """Converts text to speech using gTTS and returns the audio data as bytes."""
    try:
        gtts_fp = BytesIO()
        tts = gTTS(text=text, lang='vi', slow=False)
        tts.write_to_fp(gtts_fp)
        gtts_fp.seek(0)
        sound = AudioSegment.from_file(gtts_fp, format="mp3")
        final_audio_fp = BytesIO()
        sound.export(final_audio_fp, format="ogg", codec="libopus", bitrate="48k")
        final_audio_fp.seek(0)
        return final_audio_fp.read()
    except Exception as e:
        print(f"Audio generation error: {e}")
        return None

def send_message(chat_id, text):
    """Sends a text message to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    requests.post(url, json={"chat_id": chat_id, "text": text})

def send_voice(chat_id, ogg_audio_bytes):
    """Sends an OGG audio file as a playable voice message."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVoice"
    files = {'voice': ('voice.ogg', ogg_audio_bytes, 'audio/ogg')}
    requests.post(url, data={'chat_id': chat_id}, files=files)

def send_document(chat_id, text_content):
    """Sends a text file to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"
    text_file = BytesIO(text_content.encode('utf-8'))
    files = {'document': ('motahinhanh.txt', text_file, 'text/plain')}
    requests.post(url, data={'chat_id': chat_id}, files=files)

# This function is no longer run in a separate thread.
def process_image(image_url, chat_id):
    """This function now runs synchronously and does all the heavy work."""
    current_step = "initializing"
    try:
        current_step = "sending 'processing' message"
        send_message(chat_id, "Luga Vision đang xử lý hình ảnh, chờ xíu nha đồng chí...")

        current_step = "getting vision description"
        description = get_vision_description(image_url)
        if not description:
            send_message(chat_id, "Rất tiếc, Luga Vision không thể mô tả hình ảnh này...")
            return

        current_step = "cleaning markdown"
        plain_text_description = clean_markdown_for_tts(description)
        custom_text = "\nĐồng chí còn ảnh nào khác không? Làm khó Luga Vision thử xem!"
        full_description_for_audio = plain_text_description + custom_text

        current_step = "generating audio"
        audio = get_ogg_audio(full_description_for_audio)
        if not audio:
            send_message(chat_id, f"Luga Vision đã gặp lỗi khi đọc cho bạn mô tả... nên mình gửi cho bạn nội dung dưới dạng tin nhắn nè:\n\n{plain_text_description}")
            return

        current_step = "sending voice message"
        send_voice(chat_id, audio)
        
        current_step = "sending text document"
        send_document(chat_id, plain_text_description)

    except Exception as e:
        error_message = f"Đã xảy ra lỗi ở bước: {current_step}.\n\nChi tiết lỗi: {str(e)}"
        print(error_message)
        traceback.print_exc()
        try:
            send_message(chat_id, error_message)
        except Exception as notify_error:
            print(f"Failed to notify user of error: {notify_error}")

@app.route('/process', methods=['POST'])
def process_image_request():
    data = request.get_json()
    if not data or 'image_url' not in data or 'chat_id' not in data:
        return jsonify({"error": "Missing image_url or chat_id"}), 400

    image_url = data['image_url']
    chat_id = data['chat_id']

    # **FIX**: Call the processing function directly instead of using a thread.
    # The Vercel bot will not wait for this to finish.
    process_image(image_url, chat_id)

    # Immediately return a success response to the Vercel bot
    return jsonify({"status": "processing_started"}), 202

if __name__ == '__main__':
    app.run(debug=True, port=5000)
