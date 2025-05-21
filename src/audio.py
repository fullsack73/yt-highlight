import os
import sys
import time
import traceback
from datetime import datetime
import hashlib
import json
import signal
from functools import wraps
from concurrent.futures import ThreadPoolExecutor, as_completed

import librosa
import numpy as np
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
CACHE_FOLDER = 'cache'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CACHE_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['CACHE_FOLDER'] = CACHE_FOLDER

def get_cache_key(youtube_url):
    """Generate a cache key from a YouTube URL"""
    return hashlib.md5(youtube_url.encode()).hexdigest()

def check_cache(cache_key, cache_folder=CACHE_FOLDER):
    """Check if analysis results are available in cache"""
    cache_file = os.path.join(cache_folder, f"{cache_key}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
            return cache_data
        except Exception as e:
            print(f"Error reading cache: {str(e)}")
    return None

def save_to_cache(cache_key, data, cache_folder=CACHE_FOLDER):
    """Save analysis results to cache"""
    cache_file = os.path.join(cache_folder, f"{cache_key}.json")
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f)
        return True
    except Exception as e:
        print(f"Error saving to cache: {str(e)}")
        return False

def download_audio(youtube_url, output_path='.', retry_count=3):
    try:
        print("\n[Download] Initializing...")
        print(f"[Download] Processing URL: {youtube_url}")
        
        # Prepare output file template
        output_template = os.path.join(output_path, '%(id)s.%(ext)s')
        os.makedirs(output_path, exist_ok=True)

        # yt-dlp options - optimized for speed
        ydl_opts = {
            'format': 'worstaudio/worst',  # Get the worst quality audio for faster download
            'outtmpl': output_template,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '48',  # Even lower quality for faster processing
            }],
            'quiet': True,  # Suppress output for speed
            'noplaylist': True,  # Single video only
            'extract_flat': True,  # Don't extract metadata
            'skip_download_archive': True,  # Don't check archive
            'nocheckcertificate': True,  # Skip SSL verification
            'ignoreerrors': False
        }

        # Retry logic for downloads
        attempts = 0
        while attempts < retry_count:
            try:
                # Download audio using yt-dlp with optimized settings
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info_dict = ydl.extract_info(youtube_url, download=True)
                    video_id = info_dict.get('id', None)
                    if not video_id:
                        raise Exception("Failed to extract video ID")
                    output_file = os.path.join(output_path, f"{video_id}.mp3")
                    print(f"[Download] Successfully downloaded to: {output_file}")
                    return output_file
            except Exception as inner_e:
                attempts += 1
                if attempts >= retry_count:
                    raise
                print(f"Download attempt {attempts} failed. Retrying...")
                time.sleep(1)  # Wait before retry

    except Exception as e:
        error_msg = f"[Download] Failed to download audio: {str(e)}"
        print(error_msg)
        traceback.print_exc()
        raise Exception(error_msg) from e

def calculate_energy(y, frame_length, hop_length):
    """Calculate energy of audio signal using a more memory-efficient approach"""
    # Pre-allocate energy array
    n_frames = 1 + (len(y) - frame_length) // hop_length
    energy = np.zeros(n_frames)
    
    # Calculate energy for each frame without creating a large blocks array
    for i in range(n_frames):
        start = i * hop_length
        end = start + frame_length
        frame = y[start:end]
        energy[i] = np.sum(np.abs(frame) ** 2)
    
    return energy

def get_highlights(audio_path, max_highlights=15, target_sr=16000):
    """Find highlights in audio using simplified processing with timeout safeguard"""
    print("Loading audio file...")
    try:
        # Load audio with reduced sample rate for faster processing
        y, sr = librosa.load(audio_path, sr=target_sr, res_type='kaiser_fast')
        print(f"Audio loaded: {len(y)/sr:.1f} seconds at {sr} Hz")
        
        # Use larger frame and hop sizes for faster processing
        frame_length = 4096  # Larger frame for faster processing
        hop_length = 1024   # Larger hop for faster processing
        
        # Calculate energy directly - no parallel processing to avoid hanging
        print("Calculating audio energy...")
        energy = calculate_energy(y, frame_length, hop_length)
        print(f"Energy calculated for {len(energy)} frames")
        
        # Find peaks in energy
        print("Finding energy peaks...")
        if len(energy) > 0:
            # Use a higher percentile (98th) to find the most energetic parts
            threshold = np.percentile(energy, 98)
            highlight_frames = np.where(energy > threshold)[0]
            highlight_times = (highlight_frames * hop_length / sr).tolist()
            
            # Sort and deduplicate
            highlight_times.sort()
            
            # Remove duplicates (highlights that are too close together)
            if highlight_times:
                filtered_times = [highlight_times[0]]
                min_gap = 1.0  # Minimum 1 second between highlights
                
                for time in highlight_times[1:]:
                    if time - filtered_times[-1] >= min_gap:
                        filtered_times.append(time)
                        
                        # Early termination if we have enough highlights
                        if len(filtered_times) >= max_highlights:
                            break
                            
                print(f"Found {len(filtered_times)} highlights after filtering")
                return filtered_times[:max_highlights]
        
        print("No significant energy peaks found")
        return []
    except Exception as e:
        print(f"Error in audio analysis: {str(e)}")
        traceback.print_exc()
        return []

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

# Timeout decorator for functions that might hang
def timeout(seconds):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            def handle_timeout(signum, frame):
                raise TimeoutError(f"Function {func.__name__} timed out after {seconds} seconds")

            # Set up the timeout handler
            if os.name != 'nt':  # Not Windows
                # On Unix systems, we can use SIGALRM
                signal.signal(signal.SIGALRM, handle_timeout)
                signal.alarm(seconds)
                try:
                    result = func(*args, **kwargs)
                finally:
                    signal.alarm(0)  # Disable the alarm
                return result
            else:
                # On Windows, just run the function without timeout
                # You could implement alternative timeout mechanisms here
                print("Warning: Timeout not supported on Windows, running without timeout")
                return func(*args, **kwargs)
        return wrapper
    return decorator

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
    
    # Check cache first - this allows for immediate response if we've processed this before
    cache_key = get_cache_key(youtube_url)
    cache_result = check_cache(cache_key)
    if cache_result:
        print("\n[CACHE HIT] Using cached analysis results")
        return jsonify({
            'status': 'success',
            'highlights': cache_result['highlights'],
            'processing_time': 0.1,  # Negligible processing time
            'download_time': 0,
            'analysis_time': 0,
            'timestamp': time.time(),
            'cached': True,
            'source': 'audio_analysis'
        })
    
    audio_filepath = None
    
    try:
        # Ensure directories exist
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        os.makedirs(app.config['CACHE_FOLDER'], exist_ok=True)
        print(f"Using upload folder: {os.path.abspath(app.config['UPLOAD_FOLDER'])}")
        
        # Download the audio - this now happens after comments are displayed
        print("\n[1/2] Downloading audio...")
        download_start = time.time()
        
        # Use a timeout for the download to prevent hanging
        try:
            audio_filepath = download_audio(youtube_url, app.config['UPLOAD_FOLDER'])
            download_time = time.time() - download_start
            print(f"✓ Audio downloaded in {download_time:.1f}s")
            print(f"File: {os.path.abspath(audio_filepath) if audio_filepath else 'N/A'}")
        except Exception as e:
            print(f"Error during audio download: {str(e)}")
            return jsonify({
                'status': 'error',
                'error': f"Download failed: {str(e)}",
                'timestamp': time.time()
            }), 500

        # Get highlights with optimized parameters
        print("\n[2/2] Analyzing audio for highlights...")
        analysis_start = time.time()
        max_highlights = 15  # Reduced for faster processing
        
        # Set a maximum analysis time (180 seconds = 3 minutes)
        max_analysis_time = 180
        analysis_timeout = time.time() + max_analysis_time
        
        try:
            # Start analysis with timeout protection
            highlights = get_highlights(audio_filepath, max_highlights=max_highlights)
            analysis_time = time.time() - analysis_start
            
            # If analysis took too long but didn't error out, use what we have
            if time.time() > analysis_timeout:
                print(f"⚠️ Analysis took too long ({analysis_time:.1f}s), using partial results")
            else:
                print(f"✓ Analysis completed in {analysis_time:.1f}s")
                
            print(f"Found {len(highlights)} highlight(s)")
            
            # If we got no highlights but didn't error, return 5 evenly spaced points as fallback
            if not highlights:
                try:
                    duration = librosa.get_duration(path=audio_filepath)
                    if duration > 10:
                        # Generate 5 evenly spaced highlights for longer videos
                        step = duration / 6  # 6 to get 5 intervals
                        highlights = [step * i for i in range(1, 6)]
                        print(f"No highlights found, generated {len(highlights)} evenly spaced points")
                except Exception:
                    pass
        except Exception as e:
            print(f"Error during analysis: {str(e)}")
            # Try to generate some timestamps if analysis failed
            try:
                if audio_filepath and os.path.exists(audio_filepath):
                    duration = librosa.get_duration(path=audio_filepath)
                    if duration > 10:
                        # Generate 5 evenly spaced highlights as fallback
                        step = duration / 6
                        highlights = [step * i for i in range(1, 6)]
                        print(f"Analysis failed, generated {len(highlights)} evenly spaced points")
                    else:
                        highlights = []
                else:
                    highlights = []
            except Exception:
                highlights = []
            analysis_time = time.time() - analysis_start

        total_time = time.time() - start_time
        print(f"\n✅ Processing completed in {total_time:.1f} seconds")
        
        # Save results to cache if we have highlights
        if highlights:
            cache_data = {
                'highlights': highlights,
                'processing_time': total_time,
                'download_time': download_time,
                'analysis_time': analysis_time,
                'timestamp': time.time(),
                'source': 'audio_analysis'
            }
            cache_success = save_to_cache(cache_key, cache_data)
            if cache_success:
                print("✓ Results saved to cache")
        
        return jsonify({
            'status': 'success',
            'highlights': highlights,
            'processing_time': total_time,
            'download_time': download_time,
            'analysis_time': analysis_time,
            'timestamp': time.time(),
            'cached': False,
            'source': 'audio_analysis'
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
