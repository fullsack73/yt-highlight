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
from concurrent.futures import ThreadPoolExecutor, as_completed

import librosa
import numpy as np
import yt_dlp
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException

import requests # For Most Replayed feature

# Initialize Flask app
app = Flask(__name__, static_folder='../frontend/build', static_url_path='/yt-highlight') # Adjusted static_folder if needed
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads') # Relative path
app.config['CACHE_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache') # Relative path

# Manually handle CORS to ensure proper preflight request handling
@app.after_request
def after_request_func(response):
    origin = request.headers.get('Origin')
    if origin:
        response.headers.add('Access-Control-Allow-Origin', origin)
    else:
        response.headers.add('Access-Control-Allow-Origin', '*') # Fallback for non-browser/missing Origin

    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept') # Added Accept
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS') # Added PUT, DELETE for completeness
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

# Handle OPTIONS requests explicitly for CORS preflight
@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    response = app.make_response(jsonify(success=True))
    return response

# Initialize thread pool for background analysis
app.audio_executor = ThreadPoolExecutor(max_workers=2) # Limit workers
app.audio_analysis_futures = {} # Stores Future objects keyed by cache_key (video_id)

# Set up error handling and debugging
@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
    print(f"\n[ERROR HANDLER] Exception Type: {type(e).__name__}, Message: {str(e)}")
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

    if app.debug and not isinstance(e, HTTPException): # Add more debug info if debug mode and not HTTP standard exception
        response_data['debug_detail'] = repr(e)
        response_data['traceback'] = traceback.format_exc().splitlines()

    response = jsonify(response_data)
    response.status_code = status_code
    return response

# Ensure upload and cache directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['CACHE_FOLDER'], exist_ok=True)

def get_cache_key(youtube_url):
    """Extracts video ID to use as a cache key. Returns MD5 hash of URL if ID extraction fails."""
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
        print(f"[CacheKey] Could not extract video ID from URL: {youtube_url}. Using hash.")
        return hashlib.md5(youtube_url.encode()).hexdigest()
    return video_id

def clear_cache_for_url(youtube_url):
    cache_key = get_cache_key(youtube_url)
    cache_path = os.path.join(app.config['CACHE_FOLDER'], f"{cache_key}.json")
    if os.path.exists(cache_path):
        try:
            os.remove(cache_path)
            print(f"[CACHE] Cleared cache for URL: {youtube_url} (key: {cache_key})")
            return True
        except Exception as e:
            print(f"[CACHE] Error clearing cache for {youtube_url} (key: {cache_key}): {str(e)}")
    else:
        print(f"[CACHE] No cache found for URL: {youtube_url} (key: {cache_key})")
    return False

def check_cache(cache_key):
    cache_file = os.path.join(app.config['CACHE_FOLDER'], f"{cache_key}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
            return cache_data
        except Exception as e:
            print(f"[CACHE] Error reading cache file {cache_file}: {str(e)}")
    return None

def save_to_cache(cache_key, data):
    cache_file = os.path.join(app.config['CACHE_FOLDER'], f"{cache_key}.json")
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"[CACHE] Saved data to cache for key {cache_key}")
        return True
    except Exception as e:
        print(f"[CACHE] Error saving to cache file {cache_file}: {str(e)}")
    return False

def download_audio(youtube_url, output_path='.', retry_count=3):
    try:
        print(f"\n[Download] Initializing for URL: {youtube_url}")
        match = re.search(r'(?:youtube\.com/(?:[^/]+/.+/|(?:v|e(?:mbed)?)/|.*[?&]v=)|youtu\.be/)([^"&?/ ]{11})', youtube_url)
        video_id_for_filename = match.group(1) if match else hashlib.md5(youtube_url.encode()).hexdigest()
        if not match: print(f"[Download] Could not extract video ID for filename, using hash: {video_id_for_filename}")
        else: print(f"[Download] Using video ID for filename: {video_id_for_filename}")

        output_file = os.path.join(output_path, f"{video_id_for_filename}.mp3")
        os.makedirs(output_path, exist_ok=True)
        output_template = os.path.join(output_path, '%(id)s.%(ext)s')

        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/worstaudio/worst', 'outtmpl': output_template,
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '64'}],
            'quiet': False, 'noplaylist': True, 'socket_timeout': 60, 'retries': 10,
            'nocheckcertificate': True, 'ignoreerrors': False,
        }
        attempts = 0
        last_error = None
        while attempts < retry_count:
            attempts += 1
            print(f"[Download] Attempt {attempts}/{retry_count} for {video_id_for_filename}")
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info_dict = ydl.extract_info(youtube_url, download=True)
                    if not info_dict: raise Exception("yt-dlp extract_info returned no data")
                    if os.path.exists(output_file):
                        file_size = os.path.getsize(output_file)
                        print(f"[Download] Successfully processed. Output: {output_file} (size: {file_size} bytes)")
                        if file_size < 1000:
                            os.remove(output_file)
                            raise Exception(f"Downloaded file is too small: {file_size} bytes.")
                        return output_file
                    else:
                        downloaded_id = info_dict.get('id', video_id_for_filename)
                        expected_file_if_id_differs = os.path.join(output_path, f"{downloaded_id}.mp3")
                        if os.path.exists(expected_file_if_id_differs):
                            print(f"[Download] Found file with ID from info_dict: {expected_file_if_id_differs}.")
                            return expected_file_if_id_differs
                        raise Exception(f"Output file {output_file} (or {expected_file_if_id_differs}) not found.")
            except yt_dlp.utils.DownloadError as de:
                last_error = de
                print(f"[Download] yt-dlp DownloadError on attempt {attempts}: {str(de)}")
                if "private video" in str(de).lower() or "video unavailable" in str(de).lower():
                    raise Exception(f"Video is private or unavailable: {str(de)}") from de
                if attempts >= retry_count: break
                time.sleep(5 * attempts)
            except Exception as e:
                last_error = e
                print(f"[Download] General error on attempt {attempts}: {str(e)}"); traceback.print_exc()
                if attempts >= retry_count: break
                time.sleep(3 * attempts)
        raise Exception(f"[Download] Failed after {retry_count} attempts for {youtube_url}. Last error: {str(last_error)}")
    except Exception as e:
        final_error_msg = f"[Download] Critical failure in download_audio for {youtube_url}: {str(e)}"
        print(final_error_msg); traceback.print_exc()
        raise Exception(final_error_msg) from e

def calculate_energy(y, frame_length, hop_length):
    if len(y) < frame_length: return np.array([])
    n_frames = 1 + (len(y) - frame_length) // hop_length
    energy = np.zeros(n_frames)
    for i in range(n_frames):
        start = i * hop_length; end = start + frame_length
        energy[i] = np.sum(np.abs(y[start:end]) ** 2)
    return energy

def get_highlights(audio_path, max_highlights=15, target_sr=16000):
    print(f"\n[Analysis] Starting audio analysis for: {audio_path}")
    if not os.path.exists(audio_path): print(f"[Analysis ERROR] Audio file does not exist: {audio_path}"); return []
    try:
        file_size = os.path.getsize(audio_path)
        print(f"[Analysis] File size: {file_size} bytes")
        if file_size < 10000: print(f"[Analysis WARNING] Audio file too small: {file_size} bytes."); return []
    except Exception as e: print(f"[Analysis ERROR] Failed to get file size for {audio_path}: {str(e)}"); return []

    try:
        print(f"[Analysis] Loading audio with librosa, target_sr={target_sr}Hz...")
        y, sr = librosa.load(audio_path, sr=target_sr, res_type='kaiser_fast', mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        print(f"[Analysis] Audio loaded: {duration:.1f} seconds at {sr} Hz")
        if duration < 5: print(f"[Analysis WARNING] Audio too short ({duration:.1f}s)."); return []

        frame_length = int(sr * 0.1); hop_length = int(frame_length / 2)
        print("[Analysis] Calculating audio energy...")
        energy = calculate_energy(y, frame_length, hop_length)
        if len(energy) < 10: print(f"[Analysis WARNING] Too few energy frames ({len(energy)})."); return []
        print(f"[Analysis] Energy calculated for {len(energy)} frames")

        highlight_times = []
        percentiles_to_try = [98, 95, 90, 85, 80]
        for p in percentiles_to_try:
            threshold = np.percentile(energy, p)
            potential_highlight_frames = np.where(energy > threshold)[0]
            if 0 < len(potential_highlight_frames) < len(energy) * 0.5:
                highlight_times_sec = (potential_highlight_frames * hop_length / sr).tolist()
                highlight_times_sec.sort()
                filtered_highlights = []
                if highlight_times_sec:
                    filtered_highlights.append(highlight_times_sec[0])
                    for t_sec in highlight_times_sec[1:]:
                        if t_sec - filtered_highlights[-1] >= 2.0: filtered_highlights.append(t_sec)
                if len(filtered_highlights) >= 3 or p == percentiles_to_try[-1]:
                    highlight_times = [round(t, 2) for t in filtered_highlights]
                    print(f"[Analysis] Found {len(highlight_times)} highlights using {p}th percentile.")
                    break
            if p == percentiles_to_try[-1] and not highlight_times:
                 print(f"[Analysis] No suitable highlights found with percentile method.")

        if not highlight_times and len(energy) > 20:
            print("[Analysis] Percentile method yielded no highlights. Trying SciPy peak detection...")
            try:
                from scipy.signal import find_peaks
                peaks, _ = find_peaks(energy, height=np.mean(energy) + np.std(energy), distance=int(2 * sr / hop_length))
                if len(peaks) > 0:
                    highlight_times = [round(t, 2) for t in (peaks * hop_length / sr).tolist()]
                    highlight_times.sort()
                    print(f"[Analysis] Found {len(highlight_times)} highlights using SciPy peak detection.")
            except ImportError: print("[Analysis WARNING] SciPy not installed.")
            except Exception as peak_err: print(f"[Analysis ERROR] SciPy peak detection: {str(peak_err)}")
        return sorted(list(set(highlight_times)))[:max_highlights]
    except Exception as e:
        print(f"[Analysis ERROR] Unexpected error during audio analysis for {audio_path}: {str(e)}"); traceback.print_exc()
        return []

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

@app.route('/api/process-youtube', methods=['POST'])
def process_youtube_url_endpoint():
    print(f"\n[API POST /api/process-youtube] Called at {time.ctime()}")
    try: data = request.get_json(); assert data, "No JSON data"
    except Exception as e: return jsonify({'status': 'error', 'error': 'Invalid JSON', 'message': str(e)}), 400
    youtube_url = data.get('youtube_url')
    if not youtube_url: return jsonify({'status': 'error', 'error': "'youtube_url' is required"}), 400
    force_fresh = data.get('force_fresh', False)
    video_id_cache_key = get_cache_key(youtube_url)
    print(f"[API POST /api/process-youtube] URL: {youtube_url}, Key: {video_id_cache_key}, ForceFresh: {force_fresh}")

    if not force_fresh:
        cached_result = check_cache(video_id_cache_key)
        if cached_result:
            print(f"[API POST /api/process-youtube] Cache hit for {video_id_cache_key}.")
            if cached_result.get('status') == 'error' and cached_result.get('retryable', False):
                 print(f"[API POST /api/process-youtube] Cached error is retryable. Processing fresh.")
                 try: os.remove(os.path.join(app.config['CACHE_FOLDER'], f"{video_id_cache_key}.json"))
                 except: pass
            else: return jsonify(cached_result)

    if video_id_cache_key in app.audio_analysis_futures and not app.audio_analysis_futures[video_id_cache_key].done():
        return jsonify({'status': 'processing', 'message': 'Analysis already in progress.'})
    if force_fresh and video_id_cache_key in app.audio_analysis_futures: # Clear done future if forcing fresh
        del app.audio_analysis_futures[video_id_cache_key]
        try: os.remove(os.path.join(app.config['CACHE_FOLDER'], f"{video_id_cache_key}.json"))
        except: pass

    future = app.audio_executor.submit(background_analysis_task, youtube_url, video_id_cache_key, force_fresh)
    app.audio_analysis_futures[video_id_cache_key] = future
    return jsonify({'status': 'processing', 'message': 'Analysis initiated.', 'cache_key': video_id_cache_key})

def background_analysis_task(url, key, force_processing_flag):
    print(f"\n[BG TASK {key}] Starting for URL: {url}")
    task_start_time = time.time()
    audio_filepath = None; audio_highlights_list = []; heatmap_data_dict = {'status': 'not_processed', 'data': None, 'error': None}
    dl_duration, audio_analysis_proc_duration, heatmap_proc_duration = 0, 0, 0
    audio_fallback_used = False

    try:
        if force_processing_flag:
            cache_file_bg = os.path.join(app.config['CACHE_FOLDER'], f"{key}.json")
            if os.path.exists(cache_file_bg):
                try: os.remove(cache_file_bg); print(f"[BG TASK {key}] Cleared cache for key: {key}.")
                except Exception as e_clear: print(f"[BG TASK {key}] Error clearing cache for {key}: {e_clear}")
        # Audio Processing
        audio_proc_start_time = time.time()
        try:
            dl_start_time = time.time()
            audio_filepath = download_audio(url, app.config['UPLOAD_FOLDER'])
            dl_duration = time.time() - dl_start_time
            analysis_start_time_audio = time.time()
            audio_highlights_list = get_highlights(audio_filepath)
            audio_analysis_proc_duration = time.time() - analysis_start_time_audio
            if not audio_highlights_list and audio_filepath:
                audio_fallback_used = True; duration_fallback = librosa.get_duration(path=audio_filepath)
                if duration_fallback > 30:
                    num_fallbacks = 5; start_offset = duration_fallback * 0.10; end_offset = duration_fallback * 0.90
                    usable_duration = end_offset - start_offset
                    if usable_duration > 20 and num_fallbacks > 0:
                        step = usable_duration / (num_fallbacks + 1)
                        audio_highlights_list = [round(start_offset + step * (i + 1), 2) for i in range(num_fallbacks)]
        except Exception as audio_err: print(f"[BG TASK {key}] Error in audio stage: {audio_err}"); traceback.print_exc()
        print(f"[BG TASK {key}] Audio processing took {time.time() - audio_proc_start_time:.2f}s")

        # Most Replayed Processing
        video_id_for_heatmap = get_cache_key(url) # Use get_cache_key to ensure it's a video_id
        if len(video_id_for_heatmap) == 32 and hashlib.md5(url.encode()).hexdigest() == video_id_for_heatmap: # It's a hash
            video_id_for_heatmap = None # Don't use hash for heatmap
            
        if video_id_for_heatmap:
            heatmap_start_time = time.time()
            try:
                raw_heatmap_result = get_youtube_most_replayed_heatmap_data(video_id_for_heatmap)
                if isinstance(raw_heatmap_result, str): heatmap_data_dict.update({'status': 'error', 'error': raw_heatmap_result})
                else: heatmap_data_dict.update({'status': 'success', 'data': raw_heatmap_result})
            except Exception as he: heatmap_data_dict.update({'status': 'error', 'error': f"Exception: {he}"}); traceback.print_exc()
            heatmap_proc_duration = time.time() - heatmap_start_time
            print(f"[BG TASK {key}] Heatmap analysis took {heatmap_proc_duration:.2f}s. Status: {heatmap_data_dict['status']}")
        else: heatmap_data_dict.update({'status': 'skipped', 'error': 'No valid video_id for heatmap.'})

        # Consolidate Results
        task_total_duration = time.time() - task_start_time
        current_status = 'error'; message_parts = []; error_log_details = []
        if audio_highlights_list: current_status = 'success'; message_parts.append(f"Audio highlights ({len(audio_highlights_list)})" + (" (fallback)" if audio_fallback_used else ""))
        else: error_log_details.append("No audio highlights.")
        if heatmap_data_dict['status'] == 'success': message_parts.append("Most Replayed data retrieved."); current_status = 'success' if current_status == 'success' else 'partial_success'
        elif heatmap_data_dict['status'] == 'error': message_parts.append(f"Most Replayed failed: {heatmap_data_dict['error']}"); error_log_details.append(f"Heatmap: {heatmap_data_dict['error']}"); current_status = 'partial_success' if current_status == 'success' else 'error'
        elif heatmap_data_dict['status'] == 'skipped': message_parts.append("Most Replayed skipped.")

        final_message = ". ".join(message_parts) or "Processing finished."
        if current_status == 'error' and not error_log_details: final_message = "Failed to find any highlights or data."

        result_data = {
            'status': current_status, 'message': f"{final_message} Total: {task_total_duration:.2f}s.",
            'audio_highlights': audio_highlights_list,
            'audio_highlight_source': 'primary' if audio_highlights_list and not audio_fallback_used else ('fallback' if audio_fallback_used else 'none'),
            'heatmap_info': heatmap_data_dict, 'error_details': "; ".join(error_log_details) or None,
            'processing_times': {'total': round(task_total_duration,2), 'download': round(dl_duration,2), 'audio_analysis': round(audio_analysis_proc_duration,2), 'heatmap': round(heatmap_proc_duration,2)},
            'timestamp': time.time(), 'retryable': current_status == 'error'
        }
        save_to_cache(key, result_data)
        print(f"[BG TASK {key}] Saved to cache. Status: {result_data['status']}")
    except Exception as e_bg_task:
        print(f"[BG TASK {key}] CRITICAL UNHANDLED ERROR: {e_bg_task}"); traceback.print_exc()
        save_to_cache(key, {'status': 'error', 'error': f'Critical failure: {e_bg_task}', 'message': 'Unrecoverable error.', 'timestamp': time.time(), 'retryable': True})
    finally:
        if audio_filepath and os.path.exists(audio_filepath):
            try: os.remove(audio_filepath); print(f"[BG TASK {key}] Cleaned up: {audio_filepath}")
            except Exception as e_clean: print(f"[BG TASK {key}] Error cleaning {audio_filepath}: {e_clean}")
        print(f"[BG TASK {key}] Finished in {time.time() - task_start_time:.2f}s.")
        if key in app.audio_analysis_futures: del app.audio_analysis_futures[key]

@app.route('/api/analysis-status', methods=['GET'])
def analysis_status_endpoint_get():
    print(f"\n[API GET /api/analysis-status] Called at {time.ctime()}")
    youtube_url = request.args.get('youtube_url')
    if not youtube_url: return jsonify({'status': 'error', 'error': "'youtube_url' is required"}), 400
    video_id_cache_key = get_cache_key(youtube_url)
    print(f"[API GET /api/analysis-status] Checking for URL: {youtube_url} (Key: {video_id_cache_key})")

    cached_result = check_cache(video_id_cache_key)
    if cached_result: return jsonify(cached_result)

    if video_id_cache_key in app.audio_analysis_futures:
        future = app.audio_analysis_futures[video_id_cache_key]
        if not future.done(): return jsonify({'status': 'processing', 'message': 'Analysis ongoing.'})
        else:
            print(f"[API GET /api/analysis-status] Task for {video_id_cache_key} done, but no cache. May indicate task error.")
            try: future.result(timeout=0.1) # Check for exceptions
            except Exception as e:
                return jsonify({'status': 'error', 'error': "Internal Task Error", 'message': str(e), 'retryable': True})
            return jsonify({'status': 'error', 'error': "Result Missing", 'message': "Task completed but result not cached.", 'retryable': True})
    return jsonify({'status': 'not_started', 'message': 'Analysis not initiated or no longer tracked.'})

@app.route('/api/get-most-replayed', methods=['GET'])
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

@app.route('/api/clear-cache', methods=['POST'])
def clear_cache_endpoint():
    print(f"\n[API POST /api/clear-cache] Called at {time.ctime()}")
    try: data = request.get_json(); assert data, "No JSON data"
    except Exception as e: return jsonify({'status': 'error', 'error': 'Invalid JSON payload', 'message': str(e)}), 400
    
    youtube_url = data.get('youtube_url')
    if not youtube_url: return jsonify({'status': 'error', 'error': 'youtube_url is required'}), 400
    
    print(f"[API POST /api/clear-cache] Clearing cache for URL: {youtube_url}")
    video_id_cache_key = get_cache_key(youtube_url)
    
    cache_file_path = os.path.join(app.config['CACHE_FOLDER'], f"{video_id_cache_key}.json")
    cleared_from_disk = False
    if os.path.exists(cache_file_path):
        try: os.remove(cache_file_path); cleared_from_disk = True
        except Exception as e_clear_disk: print(f"[API POST /api/clear-cache] Error removing {cache_file_path}: {e_clear_disk}")
    
    task_cancelled_or_removed = False
    if video_id_cache_key in app.audio_analysis_futures:
        future = app.audio_analysis_futures[video_id_cache_key]
        if not future.done():
            if future.cancel(): task_cancelled_or_removed = True
        del app.audio_analysis_futures[video_id_cache_key]
        if not task_cancelled_or_removed: task_cancelled_or_removed = True 
        print(f"[API POST /api/clear-cache] Task for {video_id_cache_key} cancelled/removed: {task_cancelled_or_removed}")

    if cleared_from_disk or task_cancelled_or_removed:
        return jsonify({'status': 'success', 'message': f'Cache/task for {youtube_url} (key: {video_id_cache_key}) handled.'})
    return jsonify({'status': 'warning', 'message': f'No cache/task found for {youtube_url} (key: {video_id_cache_key}).'})

@app.route('/', defaults={'path': ''}) 
@app.route('/<path:path>') 
def serve_react_app(path):
    static_folder_path = app.static_folder 
    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    return send_from_directory(static_folder_path, 'index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)