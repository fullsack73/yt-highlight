# application.py

import os
import sys
import time
import traceback
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor

import librosa
import numpy as np
import yt_dlp
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException
import requests

# --- 1. 환경 설정 및 Flask 앱 초기화 ---

YOUTUBE_COOKIES_ENV = os.environ.get('YOUTUBE_COOKIES')
COOKIE_FILE_PATH = '/tmp/cookies.txt'

application = Flask(__name__, static_folder='frontend/dist', static_url_path='')

DOWNLOAD_DIRECTORY = '/var/app/current/downloads'
application.config['UPLOAD_FOLDER'] = DOWNLOAD_DIRECTORY
application.config['CACHE_FOLDER'] = '/tmp/yt-hl-cache'

# --- 2. 스레드 풀 및 에러 핸들러 ---
application.audio_executor = ThreadPoolExecutor(max_workers=2)
application.audio_analysis_futures = {}

@application.errorhandler(Exception)
def handle_exception(e):
    application.logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
    traceback.print_exc()
    status_code = 500
    error_message = "An unexpected error occurred on the server."
    if isinstance(e, HTTPException):
        status_code = e.code if e.code else 500
        error_message = e.name if e.name else "HTTP Exception"
    response = jsonify({'status': 'error', 'error': error_message, 'message': str(e)})
    response.status_code = status_code
    return response

# --- 3. 폴더 생성 및 헬퍼 함수 ---

os.makedirs(application.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(application.config['CACHE_FOLDER'], exist_ok=True)

# (All helper functions below this are unchanged)
def get_cache_key(youtube_url):
    video_id = None
    patterns = [r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)', r'youtube\.com/shorts/([\w-]+)']
    for pattern in patterns:
        match = re.search(pattern, youtube_url)
        if match:
            video_id = match.group(1)
            break
    if not video_id:
        return hashlib.md5(youtube_url.encode()).hexdigest()
    return video_id

def check_cache(cache_key):
    cache_file = os.path.join(application.config['CACHE_FOLDER'], f"{cache_key}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f: return json.load(f)
        except Exception: return None
    return None

def save_to_cache(cache_key, data):
    cache_file = os.path.join(application.config['CACHE_FOLDER'], f"{cache_key}.json")
    with open(cache_file, 'w') as f: json.dump(data, f, indent=2)

### EB-FIX: A more robust download function ###
def download_audio(youtube_url, output_path='.'):
    """
    Downloads and converts audio in one atomic operation, returning the final file path.
    """
    try:
        output_template = os.path.join(output_path, '%(id)s.%(ext)s')
        ydl_opts = {
            'format': 'worstaudio/worst',
            'outtmpl': output_template,
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '64'}],
            'quiet': True, 'noplaylist': True, 'socket_timeout': 60, 'retries': 3,
            'nocheckcertificate': True, 'ignoreerrors': False, 'throttledratelimit': 1024*1024,
            'sleep_interval_requests': 2, 'max_sleep_interval': 5,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        }
        if COOKIE_FILE_PATH and os.path.exists(COOKIE_FILE_PATH):
            ydl_opts['cookiefile'] = COOKIE_FILE_PATH
            print(f"[DOWNLOAD] Using cookie file from: {COOKIE_FILE_PATH}")
        else:
            print(f"[DOWNLOAD_WARNING] Cookie file not found at {COOKIE_FILE_PATH}. Proceeding without cookies.")

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Perform download and get the final, post-processed info dict in one call.
            # This is more robust than getting info first.
            info_dict = ydl.extract_info(youtube_url, download=True)
            
            final_filepath = None
            # The final path is usually in 'requested_downloads' after post-processing
            if 'requested_downloads' in info_dict and info_dict['requested_downloads']:
                final_filepath = info_dict['requested_downloads'][0].get('filepath')
            # Fallback for different yt-dlp versions or flows
            elif 'filepath' in info_dict:
                final_filepath = info_dict.get('filepath')

            # The ultimate verification: does the file exist on disk?
            if final_filepath and os.path.exists(final_filepath):
                 print(f"[DOWNLOAD] Success. Final file is at: {final_filepath}")
                 return final_filepath
            else:
                 # If we get here, something went wrong and the file is missing.
                 print(f"[DOWNLOAD_ERROR] yt-dlp finished, but the final file could not be found.")
                 print(f"Final info_dict for debugging: {info_dict}")
                 raise Exception("Could not find the final audio file after processing.")
    except Exception as e:
        print(f"[DOWNLOAD_ERROR] Critical failure in download_audio: {e}")
        traceback.print_exc()
        raise

def calculate_energy(y, frame_length, hop_length):
    if len(y) < frame_length: return np.array([])
    return np.array([np.sum(np.abs(y[i:i+frame_length])**2) for i in range(0, len(y) - frame_length, hop_length)])

def get_highlights(audio_path, max_highlights=15, target_sr=16000):
    try:
        y, sr = librosa.load(audio_path, sr=target_sr, res_type='kaiser_fast', mono=True)
        if librosa.get_duration(y=y, sr=sr) < 5: return []
        frame_length, hop_length = int(sr * 0.1), int(sr * 0.05)
        energy = calculate_energy(y, frame_length, hop_length)
        if len(energy) < 10: return []
        threshold = np.percentile(energy, 95)
        peaks = np.where(energy > threshold)[0]
        highlight_times = []
        if len(peaks) > 0:
            highlight_times_sec = (peaks * hop_length / sr).tolist()
            last_time = -5
            for t_sec in highlight_times_sec:
                if t_sec - last_time >= 5.0:
                    highlight_times.append(t_sec)
                    last_time = t_sec
        return sorted([round(t, 2) for t in highlight_times])[:max_highlights]
    except Exception as e:
        print(f"Error in get_highlights: {e}")
        traceback.print_exc()
        return []

def background_analysis_task(url, key, force_processing_flag):
    audio_filepath = None
    try:
        audio_filepath = download_audio(url, application.config['UPLOAD_FOLDER'])
        audio_highlights = get_highlights(audio_filepath)
        if not audio_highlights and librosa.get_duration(filename=audio_filepath) >= 5:
             raise Exception("Highlight analysis failed or returned no results.")
        result_data = {
            'status': 'success',
            'message': 'Analysis complete.',
            'audio_highlights': audio_highlights,
            'timestamp': time.time(),
            'download_filename': os.path.basename(audio_filepath) 
        }
        save_to_cache(key, result_data)
    except Exception as e:
        print(f"[BG_TASK_ERROR] for key {key}: {e}")
        traceback.print_exc()
        error_data = {'status': 'error', 'message': f"Analysis failed: {str(e)}", 'timestamp': time.time()}
        save_to_cache(key, error_data)
    finally:
        # Leaving the file for download.
        if key in application.audio_analysis_futures:
            del application.audio_analysis_futures[key]

# --- 4. API 라우트 ---
@application.route('/api/process-youtube', methods=['POST'])
def process_youtube_url_endpoint():
    data = request.get_json()
    if not data or 'youtube_url' not in data: return jsonify({'status': 'error', 'message': "'youtube_url' is required"}), 400
    youtube_url, force_fresh = data.get('youtube_url'), data.get('force_fresh', False)
    cache_key = get_cache_key(youtube_url)
    if not force_fresh and (cached_result := check_cache(cache_key)): return jsonify(cached_result)
    if cache_key in application.audio_analysis_futures and not application.audio_analysis_futures[cache_key].done():
        return jsonify({'status': 'processing', 'message': 'Analysis already in progress.'})
    future = application.audio_executor.submit(background_analysis_task, youtube_url, cache_key, force_fresh)
    application.audio_analysis_futures[cache_key] = future
    return jsonify({'status': 'processing', 'message': 'Analysis initiated.', 'cache_key': cache_key})

@application.route('/api/analysis-status', methods=['GET'])
def analysis_status_endpoint():
    youtube_url = request.args.get('youtube_url')
    if not youtube_url: return jsonify({'status': 'error', 'message': "'youtube_url' is required"}), 400
    cache_key = get_cache_key(youtube_url)
    if (cached_result := check_cache(cache_key)): return jsonify(cached_result)
    if cache_key in application.audio_analysis_futures and not application.audio_analysis_futures[cache_key].done():
        return jsonify({'status': 'processing', 'message': 'Analysis ongoing.'})
    return jsonify({'status': 'not_started', 'message': 'Analysis not initiated or result is missing.'})

# --- 5. Health Check 및 File/App 서빙 ---
@application.route('/health')
def health_check():
    return jsonify(status="ok"), 200

@application.route('/download/<path:filename>')
def download_file(filename):
    try:
        return send_from_directory(DOWNLOAD_DIRECTORY, filename, as_attachment=True)
    except FileNotFoundError:
        return "File not found.", 404

@application.route('/', defaults={'path': ''})
@application.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(os.path.join(application.static_folder, path)):
        return send_from_directory(application.static_folder, path)
    else:
        return send_from_directory(application.static_folder, 'index.html')

# --- 6. 메인 실행 블록 ---
if __name__ == '__main__':
    application.run(debug=True, host='0.0.0.0', port=5000)