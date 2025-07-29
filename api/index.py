import os
import requests
import json
import re # Import the regular expression module
from http.server import BaseHTTPRequestHandler
from gtts import gTTS
from io import BytesIO
from pydub import AudioSegment

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
                            {"type": "text", "text": "Hãy mô tả hình ảnh càng chi tiết càng tốt. Mô tả ảnh phải hợp lý và chi tiết về không gian và hãy mô tả với chất lượng tốt nhất có thể để giúp người khiếm thị nhận biết và có trải nghiệm thật chính xác. Mô tả phải chân thực và chính xác, không bỏ sót bất kỳ chi tiết nào, không được thay đổi sự thật và bịa đặt về chi tiết không có thật trong hình ảnh. Nếu trong ảnh có từ ngữ bằng Tiếng Anh, hãy giữ nguyên các từ ngữ đó trong câu trả lời, sau đó dịch lại bằng Tiếng Việt. Hãy luôn trả về ngay mô tả hình ảnh, không cần giới thiệu hay nhắc lại yêu cầu."},
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
    text = text.replace('*', '').replace('_', '').replace('~', '').replace('`', '').replace('#', '')
    return text

# *** NEW, ADVANCED TTS FUNCTION ***
def get_bilingual_speech_audio(text):
    """
    Generates speech from text, switching between Vietnamese and English voices,
    and returns the final audio sped up by 2x.
    """
    try:
        # Regex to find English words/phrases (and numbers)
        english_pattern = r'[a-zA-Z0-9\s.,!?\'"-]+'
        
        # Split the text into Vietnamese and English parts
        parts = re.split(f'({english_pattern})', text)
        
        # This will hold the combined audio
        combined_sound = AudioSegment.empty()

        for part in parts:
            if not part.strip():
                continue

            # Determine the language of the part
            if re.fullmatch(english_pattern, part.strip()):
                lang = 'en'
            else:
                lang = 'vi'
            
            # Generate audio for this part
            gtts_fp = BytesIO()
            tts = gTTS(text=part.strip(), lang=lang, slow=False)
            tts.write_to_fp(gtts_fp)
            gtts_fp.seek(0)
            
            # Load the audio part with pydub and add it to the combined audio
            sound_part = AudioSegment.from_file(gtts_fp, format="mp3")
            combined_sound += sound_part

        # Speed up the final combined audio
        fast_sound = combined_sound.speedup(playback_speed=2.0)

        # Export to an in-memory file
        final_audio_fp = BytesIO()
        fast_sound.export(final_audio_fp, format="mp3")
        final_audio_fp.seek(0)

        return final_audio_fp.read()

    except Exception as e:
        print(f"Bilingual TTS error: {e}")
        return None


def send_message(chat_id, text):
    """Sends a text message to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text}
    requests.post(url, json=payload)

def send_audio(chat_id, audio_bytes):
    """Sends an audio file to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendAudio"
    files = {'audio': ('motahinhanh.mp3', audio_bytes, 'audio/mpeg')}
    data = {'chat_id': chat_id}
    response = requests.post(url, data=data, files=files)
    if not response.ok:
        print(f"Telegram sendAudio error: {response.text}")

def send_document(chat_id, text_content):
    """Sends a text file to a user."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"
    text_file = BytesIO(text_content.encode('utf-8'))
    files = {'document': ('motahinhanh.txt', text_file, 'text/plain')}
    data = {'chat_id': chat_id}
    response = requests.post(url, data=data, files=files)
    if not response.ok:
        print(f"Telegram sendDocument error: {response.text}")

# --- MAIN HANDLER for Vercel ---

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            payload = json.loads(self.rfile.read(content_length))

            if 'message' in payload and 'photo' in payload['message']:
                chat_id = payload['message']['chat']['id']
                
                send_message(chat_id, "Luga Vision đang xử lý hình ảnh, chờ xíu nha đồng chí...")

                file_id = payload['message']['photo'][-1]['file_id']
                file_info_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getFile?file_id={file_id}"
                file_info_res = requests.get(file_info_url).json()
                file_path = file_info_res['result']['file_path']
                image_url = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}"

                description = get_vision_description(image_url)
                if not description:
                    send_message(chat_id, "Rất tiếc, Luga Vision không thể mô tả hình ảnh này. Thử lại lần nữa hoặc thử ảnh khác đi đồng chí!")
                    self.send_response(200)
                    self.end_headers()
                    return

                plain_text_description = clean_markdown_for_tts(description)
                
                custom_text = "\nĐồng chí còn ảnh nào khác không? Làm khó Luga Vision thử xem!"
                full_description_for_audio = plain_text_description + custom_text

                # **MODIFIED**: Call the new advanced bilingual function
                audio = get_bilingual_speech_audio(full_description_for_audio)

                if not audio:
                    send_message(chat_id, f"(Lỗi tạo âm thanh) Mô tả văn bản:\n\n{description}")
                    self.send_response(200)
                    self.end_headers()
                    return

                send_audio(chat_id, audio)
                send_document(chat_id, plain_text_description)

            else:
                chat_id = payload['message']['chat']['id']
                send_message(chat_id, "Chào bạn hiền, vui lòng gửi một hình ảnh để Luga Vision miêu tả cho bạn. Tớ chỉ biết mô tả hình ảnh chứ không biết nói gì khác!")

            self.send_response(200)
            self.end_headers()

        except Exception as e:
            print(f"Error in main handler: {e}")
            self.send_response(500)
            self.end_headers()