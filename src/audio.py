from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import librosa
import numpy as np
import os
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='../frontend/build', static_url_path='')

# Enable CORS for all routes
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:3000", "http://127.0.0.1:3000"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# Ensure upload directory exists
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

def get_highlights(audio_path):
    y, sr = librosa.load(audio_path)
    frame_length = 2048
    hop_length = 512
    energy = np.array([
        sum(abs(y[i:i+frame_length]**2))
        for i in range(0, len(y), hop_length)
    ])
    threshold = np.percentile(energy, 95)  # Top 5% energy
    highlight_frames = np.where(energy > threshold)[0]
    highlight_times = (highlight_frames * hop_length / sr).tolist()
    return highlight_times

@app.route('/api/highlights', methods=['POST'])
def analyze_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        try:
            highlights = get_highlights(filepath)
            return jsonify({
                'status': 'success',
                'highlights': highlights
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500
        finally:
            # Clean up the uploaded file
            if os.path.exists(filepath):
                os.remove(filepath)

# Serve React App
@app.route('/')
def serve():
    return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
