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
application.audio_executor = ThreadPoolExecutor(max_workers=1) # Reduced for stability
application.audio_analysis_futures = {}
application.analysis_status_store = {} # New: To store detailed progress

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

def cleanup_on_startup():
    """Cleans up orphaned files from previous runs."""
    application.logger.info("Running startup cleanup...")
    download_dir = application.config['UPLOAD_FOLDER']
    cache_dir = application.config['CACHE_FOLDER']
    
    if not os.path.exists(download_dir) or not os.path.exists(cache_dir):
        application.logger.info("Download or cache directory does not exist, skipping cleanup.")
        return

    # Get sets of keys from filenames
    try:
        download_keys = {os.path.splitext(f)[0] for f in os.listdir(download_dir) if f.endswith('.mp3')}
        cache_keys = {os.path.splitext(f)[0] for f in os.listdir(cache_dir) if f.endswith('.json')}
    except Exception as e:
        application.logger.error(f"Error reading directories during cleanup: {e}")
        return

    # Find orphaned files
    orphaned_downloads = download_keys - cache_keys
    orphaned_caches = cache_keys - download_keys

    # Remove orphaned downloads
    for key in orphaned_downloads:
        try:
            os.remove(os.path.join(download_dir, f"{key}.mp3"))
            application.logger.info(f"Removed orphaned download: {key}.mp3")
        except Exception as e:
            application.logger.error(f"Error removing orphaned download {key}.mp3: {e}")

    # Remove orphaned cache files
    for key in orphaned_caches:
        try:
            os.remove(os.path.join(cache_dir, f"{key}.json"))
            application.logger.info(f"Removed orphaned cache file: {key}.json")
        except Exception as e:
            application.logger.error(f"Error removing orphaned cache {key}.json: {e}")
            
    # Validate remaining cache files
    for key in cache_keys - orphaned_caches:
        cache_file = os.path.join(cache_dir, f"{key}.json")
        try:
            with open(cache_file, 'r') as f:
                json.load(f)
        except json.JSONDecodeError:
            application.logger.warning(f"Removing corrupt cache file: {key}.json")
            try:
                os.remove(cache_file)
                # Also remove the corresponding mp3, as we can't trust the cached data
                mp3_file = os.path.join(download_dir, f"{key}.mp3")
                if os.path.exists(mp3_file):
                    os.remove(mp3_file)
                    application.logger.info(f"Also removed corresponding mp3 for corrupt cache: {key}.mp3")
            except Exception as e:
                application.logger.error(f"Error removing corrupt cache file {key}.json: {e}")

    application.logger.info("Startup cleanup finished.")


# Call cleanup at startup
cleanup_on_startup()

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

def download_audio(youtube_url, output_path='.', progress_hook=None):
    # EB-FIX: Use a temporary directory for each download to prevent race conditions
    # in multi-worker environments like Elastic Beanstalk.
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            output_template = os.path.join(tmpdir, '%(id)s.%(ext)s')
            ydl_opts = {
                'format': 'worstaudio/worst',
                'outtmpl': output_template,
                'progress_hooks': [progress_hook] if progress_hook else [],
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'outtmpl': os.path.join(output_path, '%(id)s.%(ext)s'),
                'quiet': True, # Suppress verbose output
                'no_warnings': True,
                'nocheckcertificate': True, 'ignoreerrors': False, 'throttledratelimit': 1024*1024,
                'sleep_interval_requests': 2, 'max_sleep_interval': 5,
                'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            }
            
            if COOKIE_FILE_PATH and os.path.exists(COOKIE_FILE_PATH):
                ydl_opts['cookiefile'] = COOKIE_FILE_PATH
                application.logger.info(f"[DOWNLOAD] Using cookie file from: {COOKIE_FILE_PATH}")
            else:
                application.logger.warning(f"[DOWNLOAD] Cookie file not found at {COOKIE_FILE_PATH}. Proceeding without cookies.")

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info_dict = ydl.extract_info(youtube_url, download=True)
                temp_filepath = None
                if 'requested_downloads' in info_dict and info_dict['requested_downloads']:
                    temp_filepath = info_dict['requested_downloads'][0].get('filepath')
                
                if not temp_filepath or not os.path.exists(temp_filepath):
                    video_id = info_dict.get('id')
                    if video_id:
                        expected_filename = f"{video_id}.mp3"
                        temp_filepath = os.path.join(tmpdir, expected_filename)

                if temp_filepath and os.path.exists(temp_filepath):
                    final_filename = os.path.basename(temp_filepath)
                    final_destination = os.path.join(output_path, final_filename)
                    os.makedirs(output_path, exist_ok=True)
                    shutil.move(temp_filepath, final_destination)
                    application.logger.info(f"[DOWNLOAD] Success. Final file moved to: {final_destination}")
                    return final_destination
                else:
                    error_message = f"Post-processed file not found in temp directory. Files: {os.listdir(tmpdir)}"
                    application.logger.error(f"[DOWNLOAD_ERROR] {error_message}")
                    raise DownloadError(error_message)

        except yt_dlp.utils.DownloadError as e:
            error_message = f"yt-dlp download error: {e}"
            application.logger.error(f"[DOWNLOAD_ERROR] {error_message}")
            if "HTTP Error 429" in str(e):
                raise DownloadError("Too Many Requests (429). The server is being rate-limited.")
            elif "confirm your age" in str(e).lower():
                raise DownloadError("This video is age-restricted and requires a valid login cookie.")
            raise DownloadError(str(e))
        except Exception as e:
            application.logger.error(f"[DOWNLOAD_ERROR] Critical failure in download_audio: {e}", exc_info=True)
            raise DownloadError(f"A critical error occurred during download: {e}")

def calculate_energy(y, frame_length, hop_length):
    if len(y) < frame_length: return np.array([])
    return np.array([np.sum(np.abs(y[i:i+frame_length])**2) for i in range(0, len(y) - frame_length, hop_length)])

def get_highlights(audio_path, max_highlights=15, target_sr=16000):
    application.logger.info(f"[GET_HIGHLIGHTS] Starting analysis for: {audio_path}")
    try:
        if not audio_path or not os.path.exists(audio_path):
            application.logger.error(f"[GET_HIGHLIGHTS] Audio file does not exist or path is null: {audio_path}")
            return []
        if os.path.getsize(audio_path) == 0:
            application.logger.error(f"[GET_HIGHLIGHTS] Audio file is empty: {audio_path}")
            return []

        application.logger.info(f"[GET_HIGHLIGHTS] Attempting to load audio: {audio_path}")
        y, sr = librosa.load(audio_path, sr=target_sr, res_type='kaiser_fast', mono=True)
        application.logger.info(f"[GET_HIGHLIGHTS] Successfully loaded audio: {audio_path}")

        duration = librosa.get_duration(y=y, sr=sr)
        application.logger.info(f"[GET_HIGHLIGHTS] Audio duration: {duration}s for {audio_path}")
        if duration < 5: 
            application.logger.info(f"[GET_HIGHLIGHTS] Audio duration < 5s, returning empty list for {audio_path}")
            return []

        frame_length, hop_length = int(sr * 0.1), int(sr * 0.05)
        energy = calculate_energy(y, frame_length, hop_length)
        if len(energy) < 10: 
            application.logger.info(f"[GET_HIGHLIGHTS] Not enough energy frames, returning empty list for {audio_path}")
            return []

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
        
        processed_highlights = sorted([round(t, 2) for t in highlight_times])[:max_highlights]
        application.logger.info(f"[GET_HIGHLIGHTS] Found {len(processed_highlights)} highlights for {audio_path}")
        return processed_highlights
    except Exception as e:
        application.logger.error(f"[GET_HIGHLIGHTS_ERROR] Error processing {audio_path}: {e}", exc_info=True)
        # traceback.print_exc() # Already logged with exc_info=True
        return []

def background_analysis_task(url, key, force_processing_flag):
    application.logger.info(f"[{key}] Background task started for {url}")
    status_store = application.analysis_status_store

    def progress_hook(d):
        if d['status'] == 'downloading':
            # Extract percentage and total size
            percent_str = d.get('_percent_str', '0.0%').strip()
            total_bytes_str = d.get('_total_bytes_str', 'N/A').strip()
            speed_str = d.get('_speed_str', 'N/A').strip()
            status_store[key] = {
                'status': 'processing',
                'stage': 'downloading',
                'message': f"Downloading: {percent_str} of {total_bytes_str} at {speed_str}"
            }
        elif d['status'] == 'finished':
            status_store[key] = {
                'status': 'processing',
                'stage': 'download_complete',
                'message': 'Download finished, preparing for analysis...'
            }

    try:
        # 1. Download audio
        status_store[key] = {'status': 'processing', 'stage': 'download_start', 'message': 'Starting audio download...'}
        audio_file_path = download_audio(url, DOWNLOAD_DIRECTORY, progress_hook=progress_hook)
        if not audio_file_path:
            raise Exception("Audio download failed to return a file path.")

        # 2. Analyze audio
        status_store[key] = {'status': 'processing', 'stage': 'analysis_start', 'message': 'Analyzing audio for highlights...'}
        highlights = get_highlights(audio_file_path)
        result = {'status': 'success', 'audio_highlights': highlights}

        # 3. Save to cache and clean up status
        save_to_cache(key, result)
        status_store[key] = result # Store final result
        application.logger.info(f"[{key}] Analysis successful and cached.")
        return result

    except Exception as e:
        application.logger.error(f"[{key}] Error in background task: {e}", exc_info=True)
        error_result = {'status': 'error', 'error': 'Analysis failed', 'message': str(e)}
        save_to_cache(key, error_result) # Cache the error to prevent retries
        status_store[key] = error_result # Store final error
        return error_result

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
    cache_key = request.args.get('key')
    if not cache_key:
        return jsonify({'status': 'error', 'message': 'Missing key'}), 400

    # Check our new detailed status store first
    if cache_key in application.analysis_status_store:
        status_data = application.analysis_status_store[cache_key]
        # If the task is finished, remove from futures dict to clean up
        if status_data.get('status') in ['success', 'error']:
            application.audio_analysis_futures.pop(cache_key, None)
        return jsonify(status_data)

    # Fallback for tasks that might not have hit the new store logic yet
    if cache_key in application.audio_analysis_futures:
        future = application.audio_analysis_futures[cache_key]
        if future.done():
            result = future.result()
            application.analysis_status_store[cache_key] = result # Populate store
            return jsonify(result)
        else:
            # Task is running but hasn't reported detailed status yet
            return jsonify({'status': 'processing', 'stage': 'initializing', 'message': 'Task is initializing...'})

    # Final fallback to cache for completed jobs from previous server runs
    cached_result = check_cache(cache_key)
    if cached_result:
        return jsonify(cached_result)

    return jsonify({'status': 'error', 'message': 'Unknown or expired analysis key.'}), 404

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
    
    # --- 1. Clear JSON cache file ---
    cache_file_path = os.path.join(application.config['CACHE_FOLDER'], f"{video_id_cache_key}.json")
    cleared_json_from_disk = False
    if os.path.exists(cache_file_path):
        try: 
            os.remove(cache_file_path)
            cleared_json_from_disk = True
            print(f"[API POST /api/clear-cache] Successfully deleted JSON cache: {cache_file_path}")
        except Exception as e_clear_disk: 
            print(f"[API POST /api/clear-cache] Error removing JSON cache {cache_file_path}: {e_clear_disk}")

    # --- 2. Clear downloaded MP3 file ---
    mp3_file_path = os.path.join(DOWNLOAD_DIRECTORY, f"{video_id_cache_key}.mp3")
    cleared_mp3_from_disk = False
    if os.path.exists(mp3_file_path):
        try: 
            os.remove(mp3_file_path)
            cleared_mp3_from_disk = True
            print(f"[API POST /api/clear-cache] Successfully deleted MP3 file: {mp3_file_path}")
        except Exception as e_clear_mp3: 
            print(f"[API POST /api/clear-cache] Error removing MP3 file {mp3_file_path}: {e_clear_mp3}")

    # --- 3. Cancel any running analysis task ---
    task_cancelled_or_removed = False
    if video_id_cache_key in application.audio_analysis_futures:
        future = application.audio_analysis_futures.pop(video_id_cache_key) # Atomically remove the future
        if not future.done():
            if future.cancel():
                task_cancelled_or_removed = True
                print(f"[API POST /api/clear-cache] Actively cancelled background task for {video_id_cache_key}.")
        else:
            task_cancelled_or_removed = True # Task was already done but is now removed
            print(f"[API POST /api/clear-cache] Removed completed/failed task for {video_id_cache_key}.")

    # --- 4. Final response ---
    if cleared_json_from_disk or cleared_mp3_from_disk or task_cancelled_or_removed:
        messages = []
        if cleared_json_from_disk: messages.append("JSON cache cleared.")
        if cleared_mp3_from_disk: messages.append("MP3 file deleted.")
        if task_cancelled_or_removed: messages.append("Analysis task handled.")
        return jsonify({'status': 'success', 'message': ' '.join(messages), 'details': {'key': video_id_cache_key}})
    
    return jsonify({'status': 'warning', 'message': f'No cache, MP3 file, or running task found for this URL.', 'details': {'key': video_id_cache_key}})

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