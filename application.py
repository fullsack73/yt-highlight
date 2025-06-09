import os
import sys
import time
import traceback
from datetime import datetime
import hashlib
import json
import signal
import re
from functools import wraps
from concurrent.futures import ThreadPoolExecutor

import librosa
import numpy as np
import yt_dlp
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException
import requests

COOKIE_FILE_PATH = '/tmp/cookies.txt'
YOUTUBE_COOKIES_ENV = os.environ.get('YOUTUBE_COOKIES')

if YOUTUBE_COOKIES_ENV:
    try:
        with open(COOKIE_FILE_PATH, 'w') as f:
            f.write(YOUTUBE_COOKIES_ENV)
        print(f"[COOKIE_SETUP] Successfully wrote cookies to {COOKIE_FILE_PATH}")
    except Exception as e:
        print(f"[COOKIE_SETUP_ERROR] Failed to write cookies to file: {e}")
        # 파일 쓰기 실패 시, 해당 경로를 None으로 설정하여 이후 로직에서 사용하지 않도록 함
        COOKIE_FILE_PATH = None 
else:
    print("[COOKIE_SETUP_WARNING] YOUTUBE_COOKIES environment variable not found.")
    COOKIE_FILE_PATH = None

# --- 1. 경로 설정 및 Flask 앱 초기화 (최종 수정안) ---

# Flask 앱 초기화.
# application.py가 루트에 있으므로, static_folder 경로는 매우 간단해집니다.
# 'frontend/dist'는 React 빌드 결과물이 있는 폴더입니다.
# static_url_path=''는 /assets/.. 같은 URL을 그대로 사용하게 해줍니다.
application = Flask(__name__, static_folder='frontend/dist', static_url_path='')

# 임시 파일(업로드, 캐시)을 위한 폴더 경로를 /tmp로 변경하여 안정성 확보
application.config['UPLOAD_FOLDER'] = '/tmp/yt-hl-uploads'
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
    detail_message = str(e)

    if isinstance(e, HTTPException):
        status_code = e.code if e.code is not None else 500
        error_message = e.name if e.name else "HTTP Exception"
        if e.description:
             detail_message = e.description

    response_data = {
        'status': 'error',
        'error': error_message,
        'message': detail_message,
        'timestamp': time.time()
    }
    response = jsonify(response_data)
    response.status_code = status_code
    return response

# --- 3. 폴더 생성 및 헬퍼 함수 ---

os.makedirs(application.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(application.config['CACHE_FOLDER'], exist_ok=True)

def get_cache_key(youtube_url):
    video_id = None
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)',
        r'youtube\.com/shorts/([\w-]+)'
    ]
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
            with open(cache_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"[CACHE] Error reading cache file {cache_file}: {str(e)}")
    return None

def save_to_cache(cache_key, data):
    cache_file = os.path.join(application.config['CACHE_FOLDER'], f"{cache_key}.json")
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[CACHE] Error saving to cache file {cache_file}: {str(e)}")

def download_audio(youtube_url, output_path='.', retry_count=3):
    try:
        match = re.search(r'(?:youtube\.com/(?:[^/]+/.+/|(?:v|e(?:mbed)?)/|.*[?&]v=)|youtu\.be/)([^"&?/ ]{11})', youtube_url)
        video_id_for_filename = match.group(1) if match else hashlib.md5(youtube_url.encode()).hexdigest()
        
        output_template = os.path.join(output_path, '%(id)s.%(ext)s')
        cookie_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt')

        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/worstaudio/worst', 'outtmpl': output_template,
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '64'}],
            'quiet': False, 'noplaylist': True, 'socket_timeout': 60, 'retries': 10,
            'nocheckcertificate': True, 'ignoreerrors': False,
            'cookies': cookie_file_path,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            'sleep_interval_requests': 0.5,
            'max_sleep_interval_requests': 1.5,
        }

        if os.path.exists(COOKIE_FILE_PATH):
            ydl_opts['cookiefile'] = COOKIE_FILE_PATH
            print(f"[DOWNLOAD] Using cookie file from: {COOKIE_FILE_PATH}")
        else:
            print(f"[DOWNLOAD_WARNING] Cookie file not found at {COOKIE_FILE_PATH}. Proceeding without cookies.")

        if COOKIE_FILE_PATH and os.path.exists(COOKIE_FILE_PATH):
            ydl_opts['cookiefile'] = COOKIE_FILE_PATH
            print(f"[DOWNLOAD] Using cookie file: {COOKIE_FILE_PATH}")
        else:
            print("[DOWNLOAD] Proceeding without cookie file.")
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(youtube_url, download=True)
            if not info_dict:
                raise Exception("yt-dlp extract_info returned no data")

            downloaded_id = info_dict.get('id', video_id_for_filename)
            expected_file = os.path.join(output_path, f"{downloaded_id}.mp3")
            
            if os.path.exists(expected_file):
                file_size = os.path.getsize(expected_file)
                if file_size < 1000:
                    os.remove(expected_file)
                    raise Exception(f"Downloaded file is too small: {file_size} bytes.")
                return expected_file
            else:
                raise Exception(f"Downloaded file not found at expected path: {expected_file}")

    except yt_dlp.utils.DownloadError as de:
        if "private video" in str(de).lower() or "video unavailable" in str(de).lower():
            raise Exception(f"Video is private or unavailable: {str(de)}") from de
        raise Exception(f"Download failed for {youtube_url}. Error: {str(de)}") from de
    except Exception as e:
        raise Exception(f"Critical failure in download_audio for {youtube_url}: {str(e)}") from e


def calculate_energy(y, frame_length, hop_length):
    if len(y) < frame_length: return np.array([])
    return np.array([np.sum(np.abs(y[i:i+frame_length])**2) for i in range(0, len(y) - frame_length, hop_length)])

def get_highlights(audio_path, max_highlights=15, target_sr=16000):
    try:
        y, sr = librosa.load(audio_path, sr=target_sr, res_type='kaiser_fast', mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        if duration < 5: return []

        frame_length = int(sr * 0.1); hop_length = int(frame_length / 2)
        energy = calculate_energy(y, frame_length, hop_length)
        if len(energy) < 10: return []

        threshold = np.percentile(energy, 95)
        peaks = np.where(energy > threshold)[0]
        
        highlight_times = []
        if len(peaks) > 0:
            highlight_times_sec = (peaks * hop_length / sr).tolist()
            highlight_times_sec.sort()
            
            if highlight_times_sec:
                highlight_times.append(highlight_times_sec[0])
                for t_sec in highlight_times_sec[1:]:
                    if t_sec - highlight_times[-1] >= 2.0:
                        highlight_times.append(t_sec)

        return sorted(list(set(round(t, 2) for t in highlight_times)))[:max_highlights]
    except Exception as e:
        traceback.print_exc()
        return []

def format_ms_to_time_string(ms_string: str):
    if ms_string is None or not str(ms_string).isdigit(): return "N/A"
    ms = int(ms_string)
    seconds_total = ms // 1000
    return f"{seconds_total // 60:02d}:{seconds_total % 60:02d}"

def get_youtube_most_replayed_heatmap_data(video_id: str):
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        headers = {"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.5"}
        response = requests.get(video_url, headers=headers, timeout=15)
        response.raise_for_status()
        html_content = response.text
        
        match = re.search(r'var\s+ytInitialData\s*=\s*({.*?});', html_content)
        if not match:
            return "Error: Could not find ytInitialData."

        initial_data = json.loads(match.group(1))
        
        markers_map = initial_data.get('playerOverlays', {}).get('playerOverlayRenderer', {}).get('decoratedPlayerBarRenderer', {}).get('decoratedPlayerBarRenderer', {}).get('playerBar', {}).get('multiMarkersPlayerBarRenderer', {}).get('markersMap', [])

        for item in markers_map:
            if item.get('value', {}).get('heatmap'):
                heatmap_renderer = item['value']['heatmap']['heatmapRenderer']
                heat_markers = heatmap_renderer.get('heatMarkers', [])
                if heat_markers:
                    return {"data": heat_markers}
        
        return "Error: Heatmap data not found in structure."
    except Exception as e:
        traceback.print_exc()
        return f"Error: {e}"

def background_analysis_task(url, key, force_processing_flag):
    task_start_time = time.time()
    audio_filepath = None
    try:
        audio_filepath = download_audio(url, application.config['UPLOAD_FOLDER'])
        audio_highlights = get_highlights(audio_filepath)
        
        result_data = {
            'status': 'success',
            'message': 'Analysis complete.',
            'audio_highlights': audio_highlights,
            'timestamp': time.time()
        }
        save_to_cache(key, result_data)

    except Exception as e:
        traceback.print_exc()
        error_data = {
            'status': 'error',
            'message': str(e),
            'timestamp': time.time()
        }
        save_to_cache(key, error_data)
    finally:
        if audio_filepath and os.path.exists(audio_filepath):
            try:
                os.remove(audio_filepath)
            except Exception as e_clean:
                print(f"Error cleaning up file {audio_filepath}: {e_clean}")
        if key in application.audio_analysis_futures:
            del application.audio_analysis_futures[key]


# --- 4. API 라우트 ---

@application.route('/api/process-youtube', methods=['POST'])
def process_youtube_url_endpoint():
    data = request.get_json()
    if not data or 'youtube_url' not in data:
        return jsonify({'status': 'error', 'message': "'youtube_url' is required"}), 400
    
    youtube_url = data.get('youtube_url')
    force_fresh = data.get('force_fresh', False)
    cache_key = get_cache_key(youtube_url)

    if not force_fresh:
        cached_result = check_cache(cache_key)
        if cached_result:
            return jsonify(cached_result)

    if cache_key in application.audio_analysis_futures and not application.audio_analysis_futures[cache_key].done():
        return jsonify({'status': 'processing', 'message': 'Analysis already in progress.'})

    future = application.audio_executor.submit(background_analysis_task, youtube_url, cache_key, force_fresh)
    application.audio_analysis_futures[cache_key] = future
    
    return jsonify({'status': 'processing', 'message': 'Analysis initiated.', 'cache_key': cache_key})

@application.route('/api/analysis-status', methods=['GET'])
def analysis_status_endpoint():
    youtube_url = request.args.get('youtube_url')
    if not youtube_url:
        return jsonify({'status': 'error', 'message': "'youtube_url' is required"}), 400
    
    cache_key = get_cache_key(youtube_url)
    
    cached_result = check_cache(cache_key)
    if cached_result:
        return jsonify(cached_result)

    if cache_key in application.audio_analysis_futures and not application.audio_analysis_futures[cache_key].done():
        return jsonify({'status': 'processing', 'message': 'Analysis ongoing.'})

    return jsonify({'status': 'not_started', 'message': 'Analysis not initiated or result is missing.'})


# --- 5. Health Check 및 React 앱 서빙 ---

@application.route('/health')
def health_check():
    """ELB Health-Check를 위한 전용 엔드포인트."""
    return jsonify(status="ok"), 200

@application.errorhandler(404)
def not_found(e):
    """
    모든 404 Not Found 에러를 잡아서 index.html로 리디렉션합니다.
    이것이 React Router가 모든 경로를 처리하게 하는 핵심입니다.
    단, /api/ 로 시작하는 경로는 제외합니다.
    """
    if request.path.startswith('/api/'):
        return jsonify(error='Not found'), 404
        
    index_path = os.path.join(application.static_folder, 'index.html')
    if os.path.exists(index_path):
        return send_from_directory(application.static_folder, 'index.html')
    else:
        return jsonify(error=f"Frontend entry point not found. Searched for {index_path}"), 404


# --- 6. 메인 실행 블록 ---
# 로컬 개발 환경에서 `python application.py`로 실행할 때 사용됩니다.
if __name__ == '__main__':
    application.run(debug=True, host='0.0.0.0', port=5000)