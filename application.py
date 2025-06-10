# application.py

import os
import sys
import time
import traceback
import hashlib
import json
import re
import shutil
import tempfile
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

def download_audio(youtube_url, output_path='.'):
    # EB-FIX: Use a temporary directory for each download to prevent race conditions
    # in multi-worker environments like Elastic Beanstalk.
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            # Set yt-dlp to download to the temporary directory
            output_template = os.path.join(tmpdir, '%(id)s.%(ext)s')
            
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
                info_dict = ydl.extract_info(youtube_url, download=True)
                
                temp_filepath = None
                # After postprocessing, yt-dlp provides the final path in 'requested_downloads'
                if 'requested_downloads' in info_dict and info_dict['requested_downloads']:
                    temp_filepath = info_dict['requested_downloads'][0].get('filepath')
                
                if not temp_filepath or not os.path.exists(temp_filepath):
                    # Fallback: construct the path if yt-dlp doesn't provide it directly
                    video_id = info_dict.get('id')
                    if video_id:
                        # The file should have been converted to mp3
                        expected_filename = f"{video_id}.mp3"
                        temp_filepath = os.path.join(tmpdir, expected_filename)

                if temp_filepath and os.path.exists(temp_filepath):
                    # Move the final MP3 from temp dir to the persistent UPLOAD_FOLDER
                    final_filename = os.path.basename(temp_filepath)
                    final_destination = os.path.join(output_path, final_filename)
                    
                    # Ensure the destination directory exists
                    os.makedirs(output_path, exist_ok=True)
                    
                    # Move the file
                    shutil.move(temp_filepath, final_destination)
                    
                    print(f"[DOWNLOAD] Success. Final file moved to: {final_destination}")
                    return final_destination
                else:
                    print(f"[DOWNLOAD_ERROR] Post-processed file not found in temp directory. Files: {os.listdir(tmpdir)}")
                    return None

        except yt_dlp.utils.DownloadError as e:
            print(f"[DOWNLOAD_ERROR] yt-dlp download error: {e}")
            if "HTTP Error 429" in str(e):
                print("[DOWNLOAD_ERROR] Received HTTP 429: Too Many Requests. The server is being rate-limited.")
            return None
        except Exception as e:
            print(f"[DOWNLOAD_ERROR] Critical failure in download_audio: {e}")
            traceback.print_exc()
            return None

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

def format_ms_to_time_string(ms_string: str):
    if ms_string is None or not isinstance(ms_string, (str, int)) or (isinstance(ms_string, str) and not ms_string.isdigit()): return "N/A"
    ms = int(ms_string)
    seconds_total = ms // 1000
    return f"{seconds_total // 60:02d}:{seconds_total % 60:02d}"

def get_youtube_most_replayed_heatmap_data(video_id: str):
    print(f"[Heatmap] Fetching Most Replayed data for video_id: {video_id}")
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        headers = {"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9,ko-KR;q=0.8,ko;q=0.7"}
        response = requests.get(video_url, headers=headers, timeout=20)
        response.raise_for_status()
        html_content = response.text
        match = (re.search(r"var\s+ytInitialData\s*=\s*({.*?});\s*</script>", html_content) or
                 re.search(r"window\[\"ytInitialData\"\]\s*=\s*({.*?});", html_content) or
                 re.search(r"var ytInitialData\s*=\s*({.*?});", html_content))
        if not match:
            print(f"[Heatmap] Detailed Error: Could not find ytInitialData in the page for video_id: {video_id}")
            return "Error: Could not find ytInitialData in the page."
        initial_data = json.loads(match.group(1))

        heatmap_markers_list = None
        most_replayed_label_info = None
        
        # Primary parsing attempt (playerOverlays)
        try:
            print(f"[Heatmap Primary] Parsing ytInitialData (playerOverlays) for heatmap data for video_id: {video_id}")
            markers_map_list = initial_data.get('playerOverlays', {}).get('playerOverlayRenderer', {}).get('decoratedPlayerBarRenderer', {}).get('decoratedPlayerBarRenderer', {}).get('playerBar', {}).get('multiMarkersPlayerBarRenderer', {}).get('markersMap', [])
            print(f"[Heatmap Primary] Found markersMap with {len(markers_map_list)} items for video_id: {video_id}")
            for item in markers_map_list:
                heatmap_renderer = item.get('value', {}).get('heatmap', {}).get('heatmapRenderer')
                if heatmap_renderer:
                    current_markers = heatmap_renderer.get('heatMarkers', [])
                    if current_markers: # Only assign if non-empty
                        heatmap_markers_list = current_markers
                        print(f"[Heatmap Primary] Found heatMarkers with {len(heatmap_markers_list)} markers for video_id: {video_id}")
                    if heatmap_renderer.get('heatMarkersDecorations'):
                        print(f"[Heatmap Primary] Found heatMarkersDecorations for video_id: {video_id}")
                        for deco_container in heatmap_renderer['heatMarkersDecorations']:
                            deco_renderer = deco_container.get('heatMarkerDecorationRenderer', {})
                            timed_deco = deco_renderer.get('timedMarkerDecorationRenderer', {})
                            label_runs = timed_deco.get('label', {}).get('label', {}).get('runs')
                            label_text = label_runs[0].get('text') if label_runs else None
                            deco_time_ms = (deco_renderer.get('visibleOnLoadMarkerDecorationRenderer', {}).get('markerTiming', {}).get('startOffsetMillis') or
                                            timed_deco.get('decorationTimeMillis'))
                            if label_text and deco_time_ms is not None:
                                most_replayed_label_info = {"label_text": label_text, "decoration_time_millis": str(deco_time_ms)}
                                print(f"[Heatmap Primary] Found most_replayed_label_info: {label_text} at {deco_time_ms}ms for video_id: {video_id}")
                                break # Found label, break from decorations loop
                    if heatmap_markers_list: break # Found markers, break from markersMap loop
        except Exception as e: 
            print(f"[Heatmap Primary] Error navigating primary ytInitialData (playerOverlays): {e} for video_id: {video_id}")
            traceback.print_exc()

        # Fallback parsing attempt (frameworkUpdates) if primary failed
        if not heatmap_markers_list and 'frameworkUpdates' in initial_data:
            print(f"[Heatmap Fallback] Primary path failed. Trying fallback path in frameworkUpdates for video_id: {video_id}")
            try:
                mutations = initial_data['frameworkUpdates'].get('entityBatchUpdate', {}).get('mutations', [])
                if not mutations:
                    print(f"[Heatmap Fallback] 'mutations' not found or empty in frameworkUpdates for video_id: {video_id}")
                
                for mutation_idx, mutation in enumerate(mutations):
                    print(f"[Heatmap Fallback] Inspecting mutation {mutation_idx} for video_id: {video_id}")
                    payload = mutation.get('payload', {})
                    macro_markers_entity = payload.get('macroMarkersListEntity', {})
                    markers_list_data = macro_markers_entity.get('markersList', {})

                    if markers_list_data.get('markerType') == 'MARKER_TYPE_HEATMAP':
                        print(f"[Heatmap Fallback] Found 'macroMarkersListEntity' with 'MARKER_TYPE_HEATMAP' in mutation {mutation_idx} for video_id: {video_id}")
                        
                        current_fallback_markers = markers_list_data.get('markers', [])
                        if current_fallback_markers:
                            heatmap_markers_list = current_fallback_markers
                            print(f"[Heatmap Fallback] Extracted {len(heatmap_markers_list)} markers from frameworkUpdates for video_id: {video_id}")

                        decorations_container = markers_list_data.get('markersDecoration', {}).get('timedMarkerDecorations', [])
                        if decorations_container and isinstance(decorations_container, list) and len(decorations_container) > 0:
                            first_decoration = decorations_container[0]
                            if isinstance(first_decoration, dict):
                                label_runs = first_decoration.get('label', {}).get('runs', [])
                                if label_runs and len(label_runs) > 0:
                                    label_text = label_runs[0].get('text', 'Unknown Label')
                                    decoration_time = first_decoration.get('decorationTimeMillis')
                                    if label_text and decoration_time is not None:
                                        most_replayed_label_info = {
                                            "label_text": label_text,
                                            "decoration_time_millis": str(decoration_time)
                                        }
                                        print(f"[Heatmap Fallback] Extracted most_replayed_label_info from frameworkUpdates: {label_text} for video_id: {video_id}")
                        
                        if heatmap_markers_list: # If we found markers from this mutation, we can stop
                            print(f"[Heatmap Fallback] Successfully extracted data from frameworkUpdates mutation {mutation_idx}. Breaking loop.")
                            break 
                if not heatmap_markers_list:
                    print(f"[Heatmap Fallback] Did not find heatmap markers after checking all mutations in frameworkUpdates for video_id: {video_id}")
            except Exception as e:
                print(f"[Heatmap Fallback] Error during frameworkUpdates parsing: {e} for video_id: {video_id}")
                traceback.print_exc()

        # Process whatever was found (either from primary or fallback)
        if heatmap_markers_list:
            valid_markers = [m for m in heatmap_markers_list if isinstance(m, dict) and all(k in m for k in ['intensityScoreNormalized', 'startMillis', 'durationMillis'])]
            print(f"[Heatmap] Found {len(valid_markers)}/{len(heatmap_markers_list) if heatmap_markers_list else 0} valid markers for video_id: {video_id}")
            highest_intensity_marker = None
            if valid_markers: # Ensure valid_markers is not empty
                highest_intensity_marker = max(valid_markers, key=lambda x: float(x['intensityScoreNormalized']), default=None)
            
            if highest_intensity_marker:
                print(f"[Heatmap] Found highest_intensity_marker with score {highest_intensity_marker.get('intensityScoreNormalized')} for video_id: {video_id}")
                for k in ['startMillis', 'durationMillis']: # Ensure these are strings
                    if k in highest_intensity_marker and highest_intensity_marker[k] is not None:
                        highest_intensity_marker[k] = str(highest_intensity_marker[k])
                        
            # Create a separate marker for the labeled Most Replayed point if it exists
            most_replayed_label_marker = None
            if most_replayed_label_info and 'decoration_time_millis' in most_replayed_label_info:
                most_replayed_label_marker = {
                    'startMillis': most_replayed_label_info['decoration_time_millis'],
                    'durationMillis': '5000',  # Default 5 seconds duration
                    'intensityScoreNormalized': '0.9'  # High but might not be the highest
                }
                print(f"[Heatmap] Created most_replayed_label_marker at {most_replayed_label_marker['startMillis']}ms for video_id: {video_id}")
            
            # It's possible to have heatmap_markers_list but not highest_intensity_marker (if all markers are invalid)
            # or not most_replayed_label_info. The original check was: if not highest_intensity_marker and not most_replayed_label_info:
            # This means if EITHER is missing, it's not an error. An error is only if BOTH are missing AND we had markers to begin with.
            # However, the frontend might expect at least one. Let's adjust the logic slightly: if we have markers, but extracted nothing useful, it's an issue.
            if not valid_markers and not most_replayed_label_info: # If we had markers but none were valid, and no label
                print(f"[Heatmap] Detailed Error: Heatmap markers were found, but no valid marker details or label info could be extracted for video_id: {video_id}")
                return "Error: Heatmap data found, but key details are missing."

            result = {"video_id": video_id, "most_replayed_label": most_replayed_label_info, "most_replayed_label_marker_data": most_replayed_label_marker, "highest_intensity_marker_data": highest_intensity_marker}
            if most_replayed_label_info and 'decoration_time_millis' in most_replayed_label_info:
                 result['most_replayed_label']['formatted_time'] = format_ms_to_time_string(most_replayed_label_info['decoration_time_millis'])
            if highest_intensity_marker and 'startMillis' in highest_intensity_marker and 'durationMillis' in highest_intensity_marker:
                result['highest_intensity_marker_data']['formatted_start_time'] = format_ms_to_time_string(highest_intensity_marker['startMillis'])
                result['highest_intensity_marker_data']['formatted_duration'] = format_ms_to_time_string(highest_intensity_marker['durationMillis'])
            
            print(f"[Heatmap] Successfully extracted heatmap data (possibly partial) for {video_id}.")
            return result
            
        print(f"[Heatmap] Detailed Error: Heatmap data not found in any expected structure (primary or fallback) for video_id: {video_id}")
        return "Error: Heatmap data not found in any expected structure."
    except requests.exceptions.Timeout: 
        print(f"[Heatmap] Detailed Error: Request timed out for {video_url}")
        return f"Error: Request timed out for {video_url}"
    except requests.exceptions.RequestException as e: 
        print(f"[Heatmap] Detailed Error: Request failed for {video_url}: {e}")
        return f"Error: Request failed for {video_url}: {e}"
    except json.JSONDecodeError: 
        print(f"[Heatmap] Detailed Error: Failed to parse JSON from page for {video_url}")
        return f"Error: Failed to parse JSON from page for {video_url}."
    except Exception as e: 
        print(f"[Heatmap] Unexpected error for {video_url}: {e}") 
        traceback.print_exc()
        return f"Error: Unexpected: {e}"

### EB-FIX: RESTORED THE MISSING API ENDPOINT ###
@application.route('/api/get-most-replayed', methods=['GET'])
def get_most_replayed_endpoint():
    print(f"\n[API GET /api/get-most-replayed] Called at {time.ctime()}")
    youtube_url = request.args.get('url')
    if not youtube_url:
        return jsonify({'status': 'error', 'message': 'YouTube URL is required.'}), 400

    video_id_for_heatmap = None
    patterns = [r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)', r'youtube\.com/shorts/([\w-]+)']
    for pattern in patterns:
        match = re.search(pattern, youtube_url)
        if match:
            video_id_for_heatmap = match.group(1)
            break
    
    if not video_id_for_heatmap:
        return jsonify({'status': 'error', 'message': 'Could not extract a valid video ID from the URL for Most Replayed data.'}), 400

    try:
        heatmap_result = get_youtube_most_replayed_heatmap_data(video_id_for_heatmap)
        if isinstance(heatmap_result, str): 
            if "Heatmap data not found" in heatmap_result:
                return jsonify({'status': 'error', 'message': heatmap_result}), 404
            return jsonify({'status': 'error', 'message': heatmap_result}), 500
        
        if heatmap_result: 
            return jsonify({
                "status": "success",
                "video_id": heatmap_result.get("video_id", video_id_for_heatmap), 
                "most_replayed_label": heatmap_result.get("most_replayed_label"),
                "most_replayed_label_marker_data": heatmap_result.get("most_replayed_label_marker_data"),
                "highest_intensity_marker_data": heatmap_result.get("highest_intensity_marker_data")
            })
        else: 
            return jsonify({'status': 'error', 'message': 'Heatmap data not found or is empty.'}), 404
    except Exception as e:
        print(f"[API GET /api/get-most-replayed] Error for {video_id_for_heatmap}: {e}"); traceback.print_exc()
        return jsonify({'status': 'error', 'message': f'An unexpected error occurred: {str(e)}'}), 500

@application.route('/api/clear-cache', methods=['POST'])
def clear_cache_endpoint():
    print(f"\n[API POST /api/clear-cache] Called at {time.ctime()}")
    try: data = request.get_json(); assert data, "No JSON data"
    except Exception as e: return jsonify({'status': 'error', 'error': 'Invalid JSON payload', 'message': str(e)}), 400
    
    youtube_url = data.get('youtube_url')
    if not youtube_url: return jsonify({'status': 'error', 'error': 'youtube_url is required'}), 400
    
    print(f"[API POST /api/clear-cache] Clearing cache for URL: {youtube_url}")
    video_id_cache_key = get_cache_key(youtube_url)
    
    cache_file_path = os.path.join(application.config['CACHE_FOLDER'], f"{video_id_cache_key}.json")
    cleared_from_disk = False
    if os.path.exists(cache_file_path):
        try: os.remove(cache_file_path); cleared_from_disk = True
        except Exception as e_clear_disk: print(f"[API POST /api/clear-cache] Error removing {cache_file_path}: {e_clear_disk}")
    
    task_cancelled_or_removed = False
    if video_id_cache_key in application.audio_analysis_futures:
        future = application.audio_analysis_futures[video_id_cache_key]
        if not future.done():
            if future.cancel(): task_cancelled_or_removed = True
        del application.audio_analysis_futures[video_id_cache_key]
        if not task_cancelled_or_removed: task_cancelled_or_removed = True 
        print(f"[API POST /api/clear-cache] Task for {video_id_cache_key} cancelled/removed: {task_cancelled_or_removed}")

    if cleared_from_disk or task_cancelled_or_removed:
        return jsonify({'status': 'success', 'message': f'Cache/task for {youtube_url} (key: {video_id_cache_key}) handled.'})
    return jsonify({'status': 'warning', 'message': f'No cache/task found for {youtube_url} (key: {video_id_cache_key}).'})

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