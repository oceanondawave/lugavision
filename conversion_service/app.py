# This file should be named app.py

import os
import requests
import json
from flask import Flask, request, jsonify
from gtts import gTTS
from pydub import AudioSegment
from io import BytesIO
import traceback

# --- CONFIGURATION ---
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY')

app = Flask(__name__)

# --- HELPER FUNCTIONS ---

def send_message(chat_id, text):
    """Sends a text message to a user."""
    print(f"Attempting to send debug message to {chat_id}...")
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        response = requests.post(url, json={"chat_id": chat_id, "text": text})
        response.raise_for_status()
        print("Debug message sent successfully.")
    except requests.exceptions.RequestException as e:
        print(f"CRITICAL: Failed to send debug message: {e}")


# --- MAIN ROUTES ---

@app.route('/', methods=['GET'])
def health_check():
    """A simple endpoint to confirm the service is running and configured."""
    tg_token_loaded = "loaded" if TELEGRAM_BOT_TOKEN else "missing"
    or_key_loaded = "loaded" if OPENROUTER_API_KEY else "missing"
    status = "ok" if tg_token_loaded == "loaded" and or_key_loaded == "loaded" else "error"
    return jsonify({
        "status": status,
        "TELEGRAM_BOT_TOKEN": tg_token_loaded,
        "OPENROUTER_API_KEY": or_key_loaded
    })

@app.route('/process', methods=['POST'])
def process_image_request():
    # This is a special debugging version of the function.
    print("DEBUG: /process endpoint was hit.")
    try:
        data = request.get_json()
        chat_id = data.get('chat_id')

        if not chat_id:
            print("DEBUG: Request was missing chat_id.")
            return jsonify({"error": "No chat_id provided"}), 400

        # The only goal is to see if we can send a message back.
        send_message(chat_id, "DEBUG: Koyeb received the request successfully!")

        return jsonify({"status": "debug_test_successful"})

    except Exception as e:
        # If even this simple test fails, we need to know why.
        print(f"DEBUG: CRASHED during simple test. Error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Crashed during debug test", "details": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
