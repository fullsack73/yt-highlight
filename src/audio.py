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
# import resampy # Not directly used in the provided snippet, can be removed if not needed by get_highlights

import librosa
import numpy as np
import yt_dlp
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException # Import HTTPException

# Initialize Flask app
app = Flask(__name__, static_folder='../frontend/build', static_url_path='/yt-highlight') # Adjusted static_folder if needed
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads') # Relative path
app.config['CACHE_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache') # Relative path

# Manually handle CORS to ensure proper preflight request handling
@app.after_request
def after_request_func(response):
    # Allow requests from any origin (be more specific in production)
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
    # Construct a response that Flask can properly send
    response = app.make_response(jsonify(success=True))
    # The after_request_func will add the necessary CORS headers
    return response

# Initialize thread pool for background audio analysis
app.audio_executor = ThreadPoolExecutor(max_workers=2) # Limit workers
app.audio_analysis_futures = {} # Stores Future objects keyed by cache_key

# Set up error handling and debugging
@app.errorhandler(Exception)
def handle_exception(e):
    # Log the exception with full traceback
    app.logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
    # Also print to console for immediate visibility during development
    print(f"\n[ERROR HANDLER] Exception Type: {type(e).__name__}, Message: {str(e)}")
    traceback.print_exc() # Prints the full traceback to stderr

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
        'error': error_message,    # e.g., "Method Not Allowed"
        'message': detail_message, # More specific description or original error string
        'timestamp': time.time()
    }

    if app.debug and not isinstance(e, HTTPException):
        response_data['debug_detail'] = repr(e)
        response_data['traceback'] = traceback.format_exc().splitlines()


    response = jsonify(response_data)
    response.status_code = status_code
    return response

# Ensure upload and cache directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['CACHE_FOLDER'], exist_ok=True)

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

def clear_cache_for_url(youtube_url):
    cache_key = get_cache_key(youtube_url)
    cache_path = os.path.join(app.config['CACHE_FOLDER'], f"{cache_key}.json")
    if os.path.exists(cache_path):
        try:
            os.remove(cache_path)
            print(f"[CACHE] Cleared cache for URL: {youtube_url} (key: {cache_key})")
            return True
        except Exception as e:
            print(f"[CACHE] Error clearing cache for {youtube_url}: {str(e)}")
    else:
        print(f"[CACHE] No cache found for URL: {youtube_url} (key: {cache_key})")
    return False

def check_cache(cache_key): # Removed cache_folder param, uses app.config
    cache_file = os.path.join(app.config['CACHE_FOLDER'], f"{cache_key}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
            return cache_data
        except Exception as e:
            print(f"[CACHE] Error reading cache file {cache_file}: {str(e)}")
    return None

def save_to_cache(cache_key, data): # Removed cache_folder param
    cache_file = os.path.join(app.config['CACHE_FOLDER'], f"{cache_key}.json")
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f, indent=2) # Added indent for readability
        print(f"[CACHE] Saved data to cache for key {cache_key}")
        return True
    except Exception as e:
        print(f"[CACHE] Error saving to cache file {cache_file}: {str(e)}")
    return False

def download_audio(youtube_url, output_path='.', retry_count=3):
    try:
        print(f"\n[Download] Initializing for URL: {youtube_url}")
        
        match = re.search(r'(?:youtube\.com/(?:[^/]+/.+/|(?:v|e(?:mbed)?)/|.*[?&]v=)|youtu\.be/)([^"&?/ ]{11})', youtube_url)
        if not match:
            raise ValueError(f"Could not extract video ID from URL: {youtube_url}")
        video_id = match.group(1)
        print(f"[Download] Extracted video ID: {video_id}")
        
        output_file = os.path.join(output_path, f"{video_id}.mp3")
        # If file already exists, and force_fresh is not set, we might skip download
        # However, this function is usually called when force_fresh is true or no cache exists.
        # So, we'll usually proceed with download or re-download.
        # For simplicity, let's assume we always try to download if called.
        # If a previous attempt left a file, yt-dlp might handle it.

        os.makedirs(output_path, exist_ok=True)
        output_template = os.path.join(output_path, '%(id)s.%(ext)s')

        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/worstaudio/worst', # Prioritize m4a for better compatibility with ffmpeg/librosa
            'outtmpl': output_template,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '64', # Slightly better quality, still small
            }],
            'quiet': False,
            'noplaylist': True,
            'socket_timeout': 60,
            'retries': 10, # yt-dlp internal retries
            'nocheckcertificate': True,
            'ignoreerrors': False, # Let errors propagate
            # 'progress_hooks': [lambda d: print(f"[Download Progress] {d}")], # For more detailed progress
        }

        attempts = 0
        last_error = None
        while attempts < retry_count:
            attempts += 1
            print(f"[Download] Attempt {attempts}/{retry_count} for {video_id}")
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info_dict = ydl.extract_info(youtube_url, download=True)
                    if not info_dict: # Should not happen if download=True and no error
                        raise Exception("yt-dlp extract_info returned no data")
                    
                    # ydl.prepare_filename(info_dict) should give the expected final filename
                    # but we construct it based on video_id and .mp3 extension
                    if os.path.exists(output_file):
                        file_size = os.path.getsize(output_file)
                        print(f"[Download] Successfully processed. Output: {output_file} (size: {file_size} bytes)")
                        if file_size < 1000: # Arbitrary small size check
                             # This check is a bit redundant if yt-dlp doesn't error,
                             # but good as a safeguard.
                            os.remove(output_file) # Clean up tiny file
                            raise Exception(f"Downloaded file is too small: {file_size} bytes. Likely an error.")
                        return output_file
                    else:
                        # This case implies postprocessing failed to create the .mp3
                        # or the naming convention is different than expected.
                        # Check for other possible audio extensions if mp3 failed.
                        base_name = os.path.join(output_path, video_id)
                        for ext in ['.m4a', '.webm', '.ogg', '.aac']:
                            potential_file = base_name + ext
                            if os.path.exists(potential_file):
                                print(f"[Download] Warning: MP3 not found, but found {potential_file}. Renaming/converting might be needed or ydl_opts adjusted.")
                                # For now, we expect .mp3 due to postprocessor.
                                # If this happens, it's an issue with ffmpeg or ydl_opts.
                        raise Exception(f"Output file {output_file} not found after download attempt.")
            except yt_dlp.utils.DownloadError as de:
                last_error = de
                print(f"[Download] yt-dlp DownloadError on attempt {attempts}: {str(de)}")
                # Check for specific errors if needed
                if "private video" in str(de).lower() or "video unavailable" in str(de).lower():
                    raise Exception(f"Video is private or unavailable: {str(de)}") from de # Non-retryable by us
                # yt-dlp already retries internally, so our loop is for catastrophic failures.
                if attempts >= retry_count:
                    break
                print(f"[Download] Waiting before next attempt...")
                time.sleep(5 * attempts) # Exponential backoff for our retries
            except Exception as e:
                last_error = e
                print(f"[Download] General error on attempt {attempts}: {str(e)}")
                traceback.print_exc()
                if attempts >= retry_count:
                    break
                time.sleep(3 * attempts)
        
        # All attempts failed
        error_msg = f"[Download] Failed after {retry_count} attempts. Last error: {str(last_error)}"
        print(error_msg)
        raise Exception(error_msg)

    except Exception as e: # Outer catch for setup issues or if retry loop finishes
        final_error_msg = f"[Download] Critical failure in download_audio for {youtube_url}: {str(e)}"
        print(final_error_msg)
        traceback.print_exc()
        raise Exception(final_error_msg) from e


def calculate_energy(y, frame_length, hop_length):
    # Pre-allocate energy array
    if len(y) < frame_length: # Ensure audio is long enough for at least one frame
        return np.array([])
    n_frames = 1 + (len(y) - frame_length) // hop_length
    energy = np.zeros(n_frames)
    
    for i in range(n_frames):
        start = i * hop_length
        end = start + frame_length
        frame = y[start:end]
        energy[i] = np.sum(np.abs(frame) ** 2)
    return energy

def get_highlights(audio_path, max_highlights=15, target_sr=16000):
    print(f"\n[Analysis] Starting analysis for: {audio_path}")
    
    if not os.path.exists(audio_path):
        print(f"[Analysis ERROR] File does not exist: {audio_path}")
        return []
        
    try:
        file_size = os.path.getsize(audio_path)
        print(f"[Analysis] File size: {file_size} bytes")
        if file_size < 10000: # Less than 10KB, likely invalid
            print(f"[Analysis WARNING] Audio file too small: {file_size} bytes. Skipping analysis.")
            return []
    except Exception as e:
        print(f"[Analysis ERROR] Failed to get file size for {audio_path}: {str(e)}")
        return []
    
    y, sr = None, target_sr
    try:
        print(f"[Analysis] Loading audio with librosa, target_sr={target_sr}Hz...")
        # Try with soundfile (default), then audioread if it fails.
        y, sr = librosa.load(audio_path, sr=target_sr, res_type='kaiser_fast', mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        print(f"[Analysis] Audio loaded: {duration:.1f} seconds at {sr} Hz")
        
        if duration < 5:  # Too short to reliably analyze
            print(f"[Analysis WARNING] Audio too short ({duration:.1f}s) for meaningful analysis.")
            return []
        
        frame_length = int(sr * 0.1)  # 100ms frames
        hop_length = int(frame_length / 2)  # 50% overlap
        
        print("[Analysis] Calculating audio energy...")
        energy = calculate_energy(y, frame_length, hop_length)
        
        if len(energy) < 10: # Too few frames for robust percentile calculation
            print(f"[Analysis WARNING] Too few energy frames ({len(energy)}) calculated.")
            return []
        print(f"[Analysis] Energy calculated for {len(energy)} frames")
            
        highlight_times = []
        percentiles_to_try = [98, 95, 90, 85, 80] # Try higher energy thresholds first
        
        for p in percentiles_to_try:
            threshold = np.percentile(energy, p)
            potential_highlight_frames = np.where(energy > threshold)[0]
            
            if len(potential_highlight_frames) > 0 and len(potential_highlight_frames) < len(energy) * 0.5: # Avoid selecting too many frames
                highlight_times_sec = (potential_highlight_frames * hop_length / sr).tolist()
                
                # Deduplicate and select distinct moments
                highlight_times_sec.sort()
                filtered_highlights = []
                if highlight_times_sec:
                    filtered_highlights.append(highlight_times_sec[0])
                    for t_sec in highlight_times_sec[1:]:
                        if t_sec - filtered_highlights[-1] >= 2.0: # Min 2 seconds apart
                            filtered_highlights.append(t_sec)
                
                if len(filtered_highlights) >= 3 or p == percentiles_to_try[-1]: # Got enough, or last attempt
                    highlight_times = filtered_highlights
                    print(f"[Analysis] Found {len(highlight_times)} highlights using {p}th percentile.")
                    break 
            if p == percentiles_to_try[-1] and not highlight_times:
                 print(f"[Analysis] No suitable highlights found even at {p}th percentile.")


        if not highlight_times and len(energy) > 20: # Fallback to peak detection if percentile method failed
            print("[Analysis] Percentile method yielded no highlights. Trying SciPy peak detection...")
            from scipy.signal import find_peaks
            # Adjust peak finding parameters as needed
            peaks, _ = find_peaks(energy, height=np.mean(energy) + np.std(energy), distance=int(2 * sr / hop_length)) # peaks 2s apart
            if len(peaks) > 0:
                highlight_times_sec = (peaks * hop_length / sr).tolist()
                highlight_times_sec.sort() # Ensure sorted
                highlight_times = highlight_times_sec
                print(f"[Analysis] Found {len(highlight_times)} highlights using SciPy peak detection.")


        return sorted(list(set(highlight_times)))[:max_highlights] # Ensure uniqueness and limit
        
    except Exception as e:
        print(f"[Analysis ERROR] Unexpected error during audio analysis for {audio_path}: {str(e)}")
        traceback.print_exc()
        return [] # Return empty list on any analysis error


@app.route('/api/ping', methods=['GET'])
def ping():
    return jsonify({'message': 'pong', 'timestamp': time.time()})

@app.route('/api/process-youtube', methods=['POST'])
def process_youtube_url_endpoint():
    print(f"\n[API POST /api/process-youtube] Called at {time.ctime()}")
    
    try:
        data = request.get_json()
        if not data: raise ValueError("No JSON data received")
        print(f"[API POST /api/process-youtube] Received data: {data}")
    except Exception as e:
        print(f"[API POST /api/process-youtube] Error parsing JSON: {str(e)}")
        return jsonify({'status': 'error', 'error': 'Invalid JSON payload', 'message': str(e), 'timestamp': time.time()}), 400
        
    youtube_url = data.get('youtube_url')
    if not youtube_url:
        print(f"[API POST /api/process-youtube] 'youtube_url' not provided.")
        return jsonify({'status': 'error', 'error': "'youtube_url' is required", 'timestamp': time.time()}), 400
        
    force_fresh = data.get('force_fresh', False)
    cache_key = get_cache_key(youtube_url)
    print(f"[API POST /api/process-youtube] URL: {youtube_url}, CacheKey: {cache_key}, ForceFresh: {force_fresh}")

    if not force_fresh:
        cached_result = check_cache(cache_key)
        if cached_result:
            print(f"[API POST /api/process-youtube] Cache hit for {cache_key}. Returning cached data.")
            # Check if cached result is an error that should be retried if force_fresh was false
            if cached_result.get('status') == 'error' and cached_result.get('retryable', False):
                 print(f"[API POST /api/process-youtube] Cached result is a retryable error. Will proceed with fresh analysis despite force_fresh=false.")
                 clear_cache_for_url(youtube_url) # Clear the retryable error cache
            else:
                return jsonify(cached_result)

    if cache_key in app.audio_analysis_futures:
        future = app.audio_analysis_futures[cache_key]
        if not future.done():
            print(f"[API POST /api/process-youtube] Analysis for {cache_key} is already in progress.")
            return jsonify({'status': 'processing', 'message': 'Analysis already in progress.'})
        else: # Future is done, but previous call didn't get the result or wants to force fresh
            print(f"[API POST /api/process-youtube] Previous analysis for {cache_key} is done. Starting new one due to request (force_fresh or re-init).")
            if force_fresh: clear_cache_for_url(youtube_url)


    def background_audio_analysis_task(url, key, force_processing):
        print(f"\n[BG TASK {key}] Starting for URL: {url}")
        task_start_time = time.time()
        audio_filepath = None
        
        try:
            if force_processing: # 'force_processing' implies we must re-download and re-analyze
                clear_cache_for_url(url) # Clear any previous cache for this URL
            
            download_start_time = time.time()
            audio_filepath = download_audio(url, app.config['UPLOAD_FOLDER'])
            download_duration = time.time() - download_start_time
            print(f"[BG TASK {key}] Audio downloaded to {audio_filepath} in {download_duration:.2f}s")

            analysis_start_time = time.time()
            highlights = get_highlights(audio_filepath)
            analysis_duration = time.time() - analysis_start_time
            print(f"[BG TASK {key}] Analysis complete, found {len(highlights)} highlights in {analysis_duration:.2f}s")

            if not highlights: # No highlights from primary analysis
                print(f"[BG TASK {key}] No highlights from primary analysis. Attempting fallback generation.")
                try:
                    # Fallback: generate some evenly spaced highlights if primary fails
                    duration_fallback = librosa.get_duration(path=audio_filepath)
                    if duration_fallback > 30: # Only if video is reasonably long
                        num_fallbacks = 5
                        # Start after 10%, end before 90%
                        start_offset = duration_fallback * 0.10
                        end_offset = duration_fallback * 0.90
                        usable_duration = end_offset - start_offset
                        if usable_duration > 0 and num_fallbacks > 0 :
                            step = usable_duration / (num_fallbacks +1) # +1 to space them out within usable_duration
                            highlights = [round(start_offset + step * (i + 1), 2) for i in range(num_fallbacks)]
                            print(f"[BG TASK {key}] Generated {len(highlights)} fallback highlights: {highlights}")
                        else:
                             print(f"[BG TASK {key}] Fallback usable duration too short or num_fallbacks is zero.")
                    else:
                        print(f"[BG TASK {key}] Video duration ({duration_fallback}s) too short for fallback highlights.")
                except Exception as fallback_err:
                    print(f"[BG TASK {key}] Error during fallback highlight generation: {fallback_err}")


            result_data = {
                'status': 'success' if highlights else 'error', # If fallbacks failed too, it's an error
                'highlights': highlights if highlights else [],
                'error': None if highlights else "No highlights found after primary and fallback analysis.",
                'message': f"Processed in {time.time() - task_start_time:.2f}s. Highlights found: {len(highlights)}." if highlights else "Failed to find highlights.",
                'processing_time': time.time() - task_start_time,
                'download_time': download_duration,
                'analysis_time': analysis_duration,
                'timestamp': time.time(),
                'source': 'audio_analysis' if highlights else 'processing_error', # More specific source
                'highlight_source': 'primary_analysis' if highlights and not ('fallback' in str(highlights)) else ('fallback_generation' if highlights else 'none'),
                'retryable': False if highlights else True # Errors from this task (no highlights) are retryable
            }
            save_to_cache(key, result_data)
            print(f"[BG TASK {key}] Saved result to cache. Status: {result_data['status']}")

        except Exception as e:
            print(f"[BG TASK {key}] CRITICAL ERROR: {str(e)}")
            traceback.print_exc()
            error_data = {
                'status': 'error',
                'error': f'Background processing failed: {str(e)}',
                'message': 'An unrecoverable error occurred during audio processing.',
                'timestamp': time.time(),
                'retryable': True # Assume most background errors might be transient
            }
            save_to_cache(key, error_data)
            print(f"[BG TASK {key}] Saved error state to cache.")
        finally:
            if audio_filepath and os.path.exists(audio_filepath):
                try:
                    os.remove(audio_filepath)
                    print(f"[BG TASK {key}] Cleaned up temp file: {audio_filepath}")
                except Exception as cleanup_error:
                    print(f"[BG TASK {key}] Error cleaning up temp file {audio_filepath}: {str(cleanup_error)}")
            print(f"[BG TASK {key}] Finished in {time.time() - task_start_time:.2f}s.")
            # Remove future from tracking once done to allow re-submission if needed
            if key in app.audio_analysis_futures:
                del app.audio_analysis_futures[key]


    # Submit the task to the executor
    # `force_fresh` from the request is used as `force_processing` for the task
    future = app.audio_executor.submit(background_audio_analysis_task, youtube_url, cache_key, force_fresh)
    app.audio_analysis_futures[cache_key] = future
    print(f"[API POST /api/process-youtube] Submitted background task for {cache_key}. ForceFresh was {force_fresh}.")
    
    return jsonify({'status': 'processing', 'message': 'Audio analysis has been initiated.', 'cache_key': cache_key})


@app.route('/api/audio-status', methods=['GET'])
def audio_status_endpoint_get():
    print(f"\n[API GET /api/audio-status] Called at {time.ctime()}")
    youtube_url = request.args.get('youtube_url')
    
    if not youtube_url:
        print(f"[API GET /api/audio-status] 'youtube_url' query parameter not provided.")
        return jsonify({'status': 'error', 'error': "'youtube_url' query parameter is required", 'timestamp': time.time()}), 400
        
    cache_key = get_cache_key(youtube_url)
    print(f"[API GET /api/audio-status] Checking status for URL: {youtube_url} (CacheKey: {cache_key})")

    cached_result = check_cache(cache_key)
    if cached_result:
        print(f"[API GET /api/audio-status] Cache hit for {cache_key}. Status: {cached_result.get('status')}")
        return jsonify(cached_result)

    if cache_key in app.audio_analysis_futures:
        future = app.audio_analysis_futures[cache_key]
        if not future.done():
            print(f"[API GET /api/audio-status] Task for {cache_key} is still processing.")
            return jsonify({'status': 'processing', 'message': 'Analysis is ongoing.'})
        else:
            # Future is done, but result not in cache (or cache check failed). This is unusual.
            # Could mean the task failed to save its state before completing or an error occurred during saving.
            print(f"[API GET /api/audio-status] Task for {cache_key} is done, but no cache entry. This might indicate an issue in the task's final caching step.")
            # Attempt to get result or exception from future to understand what happened.
            try:
                future.result(timeout=0.1) # Check for exceptions within the future itself
                 # If no exception, it means the task finished but didn't cache.
                error_msg = "Analysis task completed, but its result was not found in cache. The task may have failed to save its state."
                print(f"[API GET /api/audio-status] {error_msg}")
                # We can't return 'success' as we don't have the data.
                # Return an error or 'not_started' to potentially trigger a re-process by frontend.
                return jsonify({
                    'status': 'error', 
                    'error': error_msg,
                    'message': "The final results of the analysis are missing.",
                    'timestamp': time.time(),
                    'retryable': True # Allow frontend to retry
                })
            except Exception as e: # Exception from future.result()
                error_msg = f"Analysis task for {cache_key} itself failed with an unhandled exception: {str(e)}"
                print(f"[API GET /api/audio-status] {error_msg}")
                return jsonify({
                    'status': 'error', 
                    'error': "Internal analysis task error.",
                    'message': error_msg,
                    'timestamp': time.time(),
                    'retryable': True
                })
    
    # No cache and no active/recent task.
    print(f"[API GET /api/audio-status] No cache and no active task for {cache_key}. Reporting 'not_started'.")
    return jsonify({
        'status': 'not_started',
        'message': 'Analysis has not been initiated for this URL, or the task is no longer tracked and no cached result exists.',
        'timestamp': time.time()
    })


# This endpoint might be redundant if /api/audio-status (GET) serves the same purpose.
# Kept for now if there's a specific reason for a POST version.
@app.route('/api/check-status', methods=['POST'])
def check_status_endpoint_post():
    print(f"\n[API POST /api/check-status] Called at {time.ctime()}")
    try:
        data = request.get_json()
        if not data: raise ValueError("No JSON data")
        youtube_url = data.get('youtube_url')
        if not youtube_url:
            return jsonify({'status': 'error', 'error': 'youtube_url is required in POST body'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'error': 'Invalid JSON payload', 'message': str(e)}), 400

    print(f"[API POST /api/check-status] Checking status for URL: {youtube_url}")
    cache_key = get_cache_key(youtube_url)
    
    # Logic is similar to GET /api/audio-status
    cached_result = check_cache(cache_key)
    if cached_result:
        return jsonify(cached_result)

    if cache_key in app.audio_analysis_futures and not app.audio_analysis_futures[cache_key].done():
        return jsonify({'status': 'processing', 'message': 'Analysis is ongoing.'})
    
    # If here, no cache and no active task (or task is done but didn't cache)
    return jsonify({
        'status': 'not_started', # Or 'error' if we consider this state an error
        'message': 'No processing found or completed for this URL, or result not cached.',
        'timestamp': time.time()
    })


@app.route('/api/clear-cache', methods=['POST'])
def clear_cache_endpoint():
    print(f"\n[API POST /api/clear-cache] Called at {time.ctime()}")
    try:
        data = request.get_json()
        if not data: raise ValueError("No JSON data")
        youtube_url = data.get('youtube_url')
        if not youtube_url:
            return jsonify({'status': 'error', 'error': 'youtube_url is required'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'error': 'Invalid JSON payload', 'message': str(e)}), 400
    
    print(f"[API POST /api/clear-cache] Clearing cache for URL: {youtube_url}")
    success = clear_cache_for_url(youtube_url)
    cache_key = get_cache_key(youtube_url)
    
    # Also cancel and remove any ongoing future for this key
    if cache_key in app.audio_analysis_futures:
        future = app.audio_analysis_futures[cache_key]
        if not future.done():
            # Attempt to cancel. This may not always succeed if the task is already running.
            if future.cancel():
                print(f"[API POST /api/clear-cache] Cancelled ongoing task for {cache_key}.")
            else:
                print(f"[API POST /api/clear-cache] Could not cancel ongoing task for {cache_key} (may be running or already completed).")
        del app.audio_analysis_futures[cache_key] # Remove from tracking
        print(f"[API POST /api/clear-cache] Removed task tracking for {cache_key}.")

    if success:
        return jsonify({'status': 'success', 'message': f'Cache cleared for {youtube_url}. Any ongoing task was cancelled/removed.'})
    else:
        return jsonify({'status': 'warning', 'message': f'No cache found for {youtube_url} or error during clearing. Task tracking removed if present.'})

# Serve React App (adjust static_folder path if your build output is elsewhere)
@app.route('/', defaults={'path': ''}) # Serve index.html for root
@app.route('/<path:path>') # Serve other static files or index.html for client-side routing
def serve_react_app(path):
    static_folder_path = app.static_folder # Should be frontend/build
    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        # print(f"Serving static file: {path}")
        return send_from_directory(static_folder_path, path)
    else:
        # print(f"Serving index.html for path: {path} (or root)")
        return send_from_directory(static_folder_path, 'index.html')


if __name__ == '__main__':
    # For development, Flask's built-in server is fine.
    # For production, use a WSGI server like Gunicorn or Waitress.
    # Example: gunicorn -w 4 -b 0.0.0.0:5000 audio:app
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True) # threaded=True is important for background tasks