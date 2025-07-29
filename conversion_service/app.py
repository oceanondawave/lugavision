# This file should be named app.py

from flask import Flask, request, jsonify, send_file
from gtts import gTTS
from pydub import AudioSegment
from io import BytesIO
import traceback # Import the traceback module to get detailed errors

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

        # 3. Export the audio directly to OGG format with a specified bitrate for better quality.
        #    The speedup function is not needed for 1.0x speed.
        final_audio_fp = BytesIO()
        sound.export(final_audio_fp, format="ogg", codec="libopus", bitrate="48k")
        final_audio_fp.seek(0)

        # 4. Send the audio file back in the response
        return send_file(
            final_audio_fp,
            mimetype="audio/ogg",
            as_attachment=True,
            download_name="voice.ogg"
        )

    except Exception as e:
        # **FIX**: Instead of just printing, return the actual error message in the JSON response
        print(f"An error occurred: {e}")
        # Get the full traceback for detailed debugging
        error_details = traceback.format_exc()
        print(error_details)
        return jsonify({
            "error": f"Failed to process audio: {str(e)}",
            "details": error_details
        }), 500

# This allows running the app locally for testing if needed
if __name__ == '__main__':
    app.run(debug=True, port=5000)
