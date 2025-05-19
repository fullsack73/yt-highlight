import os
import sys
import time
import traceback
from datetime import datetime

import librosa
import numpy as np
import pytube
import yt_dlp  # Import yt-dlp for downloading YouTube videos
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='../frontend/build', static_url_path='')

# Enable CORS for all routes - simplified for development
CORS(app, resources={
    r"/api/*": {
        "origins": "*",  # Allow all origins for development
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True
    }
})

# Ensure upload directory exists
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

def download_audio(youtube_url, output_path='.'):
    try:
        print("\n[Download] Initializing...")
        print(f"[Download] Processing URL: {youtube_url}")
        
        # Prepare output file template
        output_template = os.path.join(output_path, '%(id)s.%(ext)s')
        os.makedirs(output_path, exist_ok=True)

        # yt-dlp options
        ydl_opts = {
            'format': 'worstaudio/worst',
            'outtmpl': output_template,
            'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '64',  # Lower quality for faster processing
            }],
            'quiet': False,  # Set to True to suppress yt-dlp output
            'noplaylist': True,  # Ensure only a single video is downloaded
        }

        # Download audio using yt-dlp
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(youtube_url, download=True)
            video_id = info_dict.get('id', None)
            if not video_id:
                raise Exception("Failed to extract video ID")
            output_file = os.path.join(output_path, f"{video_id}.mp3")
            print(f"[Download] Successfully downloaded to: {output_file}")
            return output_file

    except Exception as e:
        error_msg = f"[Download] Failed to download audio: {str(e)}"
        print(error_msg)
        traceback.print_exc()
        raise Exception(error_msg) from e

def get_highlights(audio_path):
    y, sr = librosa.load(audio_path)
    frame_length = 2048
    hop_length = 512
    energy = np.array([
        sum(abs(y[i:i+frame_length]**2))
        for i in range(0, len(y), hop_length)
    ])
    threshold = np.percentile(energy, 98)  # Top 5% energy
    highlight_frames = np.where(energy > threshold)[0]
    highlight_times = (highlight_frames * hop_length / sr).tolist()
    return highlight_times

@app.route('/api/highlights', methods=['POST'])
def analyze_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
        min_duration = 1.0  # Minimum duration in seconds
    highlight_times = [
        t for t in (highlight_frames * hop_length / sr).tolist()
        if t >= min_duration
    ]
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

@app.route('/api/process-youtube', methods=['POST'])
def process_youtube_url():
    start_time = time.time()
    data = request.get_json()
    
    if not data:
        return jsonify({
            'status': 'error',
            'error': 'No data provided',
            'timestamp': time.time()
        }), 400
        
    youtube_url = data.get('youtube_url')
    if not youtube_url:
        return jsonify({
            'status': 'error',
            'error': 'No youtube_url provided',
            'timestamp': time.time()
        }), 400

    print(f"\n{'='*50}\nProcessing YouTube URL: {youtube_url}")
    print(f"Start time: {time.ctime()}")
    
    audio_filepath = None
    
    try:
        # Ensure upload directory exists
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        print(f"Using upload folder: {os.path.abspath(app.config['UPLOAD_FOLDER'])}")
        
        # Download the audio
        print("\n[1/2] Downloading audio...")
        download_start = time.time()
        audio_filepath = download_audio(youtube_url, app.config['UPLOAD_FOLDER'])
        download_time = time.time() - download_start
        print(f"✓ Audio downloaded in {download_time:.1f}s")
        print(f"File: {os.path.abspath(audio_filepath) if audio_filepath else 'N/A'}")

        # Get highlights
        print("\n[2/2] Analyzing audio for highlights...")
        analysis_start = time.time()
        highlights = get_highlights(audio_filepath)
        analysis_time = time.time() - analysis_start
        print(f"✓ Analysis completed in {analysis_time:.1f}s")
        print(f"Found {len(highlights)} highlight(s)")

        total_time = time.time() - start_time
        print(f"\n✅ Processing completed in {total_time:.1f} seconds")
        
        return jsonify({
            'status': 'success',
            'highlights': highlights,
            'processing_time': total_time,
            'download_time': download_time,
            'analysis_time': analysis_time,
            'timestamp': time.time()
        })

    except Exception as e:
        import traceback
        error_type = type(e).__name__
        error_trace = traceback.format_exc()
        
        print(f"\n❌ Error ({error_type}): {str(e)}")
        print("\nTraceback:")
        print(error_trace)
        print("\nSystem Info:")
        print(f"Python: {sys.version}")
        print(f"pytube: {pytube.__version__ if 'pytube' in sys.modules else 'Not found'}")
        
        return jsonify({
            'status': 'error',
            'error': f"{error_type}: {str(e)}",
            'error_type': error_type,
            'traceback': error_trace.splitlines()[-5:],  # Include last 5 lines of traceback
            'timestamp': time.time(),
            'python_version': sys.version.split()[0],
            'pytube_version': pytube.__version__ if 'pytube' in sys.modules else 'Not found'
        }), 500
        
    finally:
        # Clean up the downloaded file
        if audio_filepath and os.path.exists(audio_filepath):
            try:
                file_size = os.path.getsize(audio_filepath) / (1024 * 1024)  # in MB
                os.remove(audio_filepath)
                print(f"\n✓ Cleaned up: {audio_filepath} ({file_size:.2f} MB)")
            except Exception as e:
                print(f"\n⚠️ Error cleaning up {audio_filepath}: {str(e)}")
        
        total_time = time.time() - start_time
        print(f"\nTotal processing time: {total_time:.1f} seconds")
        print(f"End time: {time.ctime()}")
        print("="*50)

# Serve React App
@app.route('/')
def serve():
    return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
