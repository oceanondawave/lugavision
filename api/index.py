import os
import requests
import json
from http.server import BaseHTTPRequestHandler
from gtts import gTTS
from io import BytesIO

# --- CONFIGURATION ---
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY')

# --- API HELPER FUNCTIONS ---

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
                            {"type": "text", "text": "Hãy mô tả hình ảnh càng chi tiết càng tốt. Mô tả ảnh phải hợp lý và chi tiết về không gian và hãy mô tả với chất lượng tốt nhất có thể để giúp người khiếm thị nhận biết và có trải nghiệm thật chính xác. Mô tả phải chân thực và chính xác, không bỏ sót bất kỳ chi tiết nào, không được thay đổi sự thật và bịa đặt về chi tiết không có thật trong hình ảnh."},
                            {"type": "image_url", "image_url": {"url": image_url}}
                        ]
                    }
                ]
            })
        )
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        return data['choices'][0]['message']['content']
    except requests.exceptions.RequestException as e:
        print(f"OpenRouter Vision API error: {e}")
        return None

def get_text_to_speech_audio_gtts(text):
    """Converts text to speech using gTTS and returns the audio data as bytes."""
    try:
        # Create an in-memory binary stream
        audio_fp = BytesIO()
        # Create gTTS object and write audio to the in-memory file
        tts = gTTS(text, lang='vi', slow=False)
        tts.write_to_fp(audio_fp)
        # Go to the beginning of the stream
        audio_fp.seek(0)
        return audio_fp.read()
    except Exception as e:
        print(f"gTTS error: {e}")
        return None

def send_message(chat_id, text):
    """Sends a text message to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text}
    requests.post(url, json=payload)

def send_audio(chat_id, audio_bytes, caption):
    """Sends an audio file with a caption to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendAudio"
    files = {'audio': ('description.mp3', audio_bytes, 'audio/mpeg')}
    data = {'chat_id': chat_id, 'caption': caption}
    response = requests.post(url, data=data, files=files)
    if not response.ok:
        print(f"Telegram sendAudio error: {response.text}")

# --- MAIN HANDLER for Vercel ---

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            payload = json.loads(self.rfile.read(content_length))

            if 'message' in payload and 'photo' in payload['message']:
                chat_id = payload['message']['chat']['id']
                
                send_message(chat_id, "Luga Vision đang xử lý hình ảnh, chờ xíu nha đồng chí...")

                # Get the file_id of the highest resolution photo
                file_id = payload['message']['photo'][-1]['file_id']

                # Use the file_id to get the file path from Telegram
                file_info_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getFile?file_id={file_id}"
                file_info_res = requests.get(file_info_url).json()
                file_path = file_info_res['result']['file_path']

                # Construct the temporary public URL for the image
                image_url = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}"

                # 1. Get the image description
                description = get_vision_description(image_url)
                if not description:
                    send_message(chat_id, "Rất tiếc, Luga Vision không thể mô tả hình ảnh này. Thử ảnh khác đi đồng chí!")
                    self.send_response(200)
                    self.end_headers()
                    return

                # 2. Get the text-to-speech audio using gTTS
                audio = get_text_to_speech_audio_gtts(description)
                if not audio:
                    send_message(chat_id, f"(Lỗi tạo âm thanh) Mô tả: {description}")
                    self.send_response(200)
                    self.end_headers()
                    return

                # 3. Send the audio with the description as a caption
                send_audio(chat_id, audio, description)

            else:
                chat_id = payload['message']['chat']['id']
                send_message(chat_id, "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn.")

            # Send a 200 OK response
            self.send_response(200)
            self.end_headers()

        except Exception as e:
            print(f"Error in main handler: {e}")
            # Send a 500 Internal Server Error response
            self.send_response(500)
            self.end_headers()
