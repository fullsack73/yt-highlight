import requests
import json
import re

def get_youtube_most_replayed_heatmap_data(video_id: str):
    """
    지정된 YouTube 비디오 ID에서 'Most Replayed' 관련 히트맵 데이터를 추출합니다.

    Args:
        video_id: 분석할 YouTube 비디오의 ID입니다.

    Returns:
        가장 많이 다시 본 구간 정보 (레이블 시간, 최고 강도 구간 시간 및 강도)를 포함하는
        딕셔너리 또는 오류 메시지 문자열.
    """
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
        }
        response = requests.get(video_url, headers=headers)
        response.raise_for_status()
        html_content = response.text

        match = re.search(r"var ytInitialData\s*=\s*({.*?});</script>", html_content)
        if not match:
            match = re.search(r"var ytInitialData\s*=\s*({.*?});", html_content)
            if not match:
                return "Error: Could not find ytInitialData in the page."

        data_str = match.group(1)
        initial_data = json.loads(data_str)

        heatmap_markers_list = None
        most_replayed_label_info = None

        if 'frameworkUpdates' in initial_data and \
           initial_data['frameworkUpdates'].get('entityBatchUpdate') and \
           'mutations' in initial_data['frameworkUpdates']['entityBatchUpdate']:
            mutations = initial_data['frameworkUpdates']['entityBatchUpdate']['mutations']
            for mutation in mutations:
                if isinstance(mutation, dict) and \
                   mutation.get('payload') and \
                   'macroMarkersListEntity' in mutation['payload'] and \
                   isinstance(mutation['payload']['macroMarkersListEntity'], dict) and \
                   mutation['payload']['macroMarkersListEntity'].get('markersList') and \
                   mutation['payload']['macroMarkersListEntity']['markersList'].get('markerType') == 'MARKER_TYPE_HEATMAP':

                    heatmap_data_container = mutation['payload']['macroMarkersListEntity']['markersList']
                    heatmap_markers_list = heatmap_data_container.get('markers', [])

                    decorations = heatmap_data_container.get('markersDecoration', {}).get('timedMarkerDecorations', [])
                    if decorations and isinstance(decorations, list) and len(decorations) > 0:
                        first_decoration = decorations[0]
                        if isinstance(first_decoration, dict) and \
                           first_decoration.get('label', {}).get('runs') and \
                           len(first_decoration['label']['runs']) > 0:
                            most_replayed_label_info = {
                                "label_text": first_decoration['label']['runs'][0].get('text', "Unknown Label"),
                                "decoration_time_millis": first_decoration.get('decorationTimeMillis')
                            }
                    break

        if heatmap_markers_list:
            # 가장 높은 강도를 가진 마커 찾기
            highest_intensity_marker = None
            if heatmap_markers_list: # 마커 리스트가 비어있지 않은지 확인
                highest_intensity_marker = max(heatmap_markers_list, key=lambda x: float(x.get('intensityScoreNormalized', 0)))

            return {
                "video_id": video_id,
                "most_replayed_label": most_replayed_label_info,
                "highest_intensity_marker_data": highest_intensity_marker
            }
        else:
            return "Error: Heatmap data not found in the expected structure."

    except requests.exceptions.RequestException as e:
        return f"Error: Request failed: {e}"
    except json.JSONDecodeError:
        return "Error: Failed to parse JSON data from the page."
    except Exception as e:
        return f"Error: An unexpected error occurred: {e}"

def format_ms_to_time_string(ms_string: str):
    """밀리초 문자열을 분:초 형식으로 변환합니다."""
    if not ms_string or not ms_string.isdigit():
        return "N/A"
    ms = int(ms_string)
    seconds_total = ms // 1000
    minutes = seconds_total // 60
    seconds = seconds_total % 60
    return f"{minutes:02d}:{seconds:02d}"

# --- 메인 실행 부분 ---
if __name__ == "__main__":
    video_id_to_analyze = "OaawMTGADpc" # 분석할 유튜브 비디오 ID
    
    result = get_youtube_most_replayed_heatmap_data(video_id_to_analyze)

    if isinstance(result, str): # 오류 메시지가 반환된 경우
        print(result)
    else:
        print(f"--- Most Replayed Info for Video ID: {result['video_id']} ---")
        
        label_info = result.get('most_replayed_label')
        if label_info and label_info.get('decoration_time_millis') is not None:
            label_time_ms = str(label_info['decoration_time_millis'])
            label_time_str = format_ms_to_time_string(label_time_ms)
            print(f"  Label \"{label_info.get('label_text', 'N/A')}\" appears around: {label_time_str} ({label_time_ms}ms)")
        else:
            print("  Most Replayed Label info not found or decoration time is missing.")

        marker_data = result.get('highest_intensity_marker_data')
        if marker_data:
            start_ms = marker_data.get('startMillis', 'N/A')
            start_time_str = format_ms_to_time_string(start_ms)
            intensity = marker_data.get('intensityScoreNormalized', 'N/A')
            duration_ms = marker_data.get('durationMillis', 'N/A')
            duration_str = format_ms_to_time_string(duration_ms)

            print(f"  Highest Intensity Segment:")
            print(f"    - Starts at: {start_time_str} ({start_ms}ms)")
            print(f"    - Duration: {duration_str} ({duration_ms}ms)")
            print(f"    - Normalized Intensity: {intensity}")
        else:
            print("  Highest intensity marker data not found.")