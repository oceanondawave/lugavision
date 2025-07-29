# This file should be named app.py

from flask import Flask, request, jsonify, send_file
from gtts import gTTS
from pydub import AudioSegment
from io import BytesIO

# Initialize the Flask app
app = Flask(__name__)

@app.route('/convert', methods=['POST'])
def convert_text_to_audio():
    # Get the text from the incoming JSON request
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({"error": "No text provided"}), 400

    text_to_speak = data['text']

    try:
        # 1. Generate the initial audio with gTTS into an in-memory file
        gtts_fp = BytesIO()
        tts = gTTS(text=text_to_speak, lang='vi', slow=False)
        tts.write_to_fp(gtts_fp)
        gtts_fp.seek(0)

        # 2. Load the audio from the in-memory file with pydub
        sound = AudioSegment.from_file(gtts_fp, format="mp3")

        # 3. Speed it up (1.0 is normal speed)
        fast_sound = sound.speedup(playback_speed=1.0)

        # 4. Export the new, faster audio to another in-memory file in OGG format
        final_audio_fp = BytesIO()
        # Use 'ogg' format and 'libopus' codec for Telegram voice messages
        fast_sound.export(final_audio_fp, format="ogg", codec="libopus")
        final_audio_fp.seek(0)

        # 5. Send the audio file back in the response
        return send_file(
            final_audio_fp,
            mimetype="audio/ogg",
            as_attachment=True,
            download_name="voice.ogg"
        )

    except Exception as e:
        print(f"An error occurred: {e}")
        return jsonify({"error": "Failed to process audio"}), 500

# This allows running the app locally for testing if needed
if __name__ == '__main__':
    app.run(debug=True, port=5000)
