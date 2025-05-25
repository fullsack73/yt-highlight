// src/App.jsx
import React, { useState, useEffect } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";
import { UrlContext, TimestampContext } from "./VideoInput.jsx";

function App() {
  const [appVideoId, setAppVideoId] = useState("");
  const [videoUrlForContext, setVideoUrlForContext] = useState("");
  const [currentTimestampForContext, setCurrentTimestampForContext] = useState("");

  const [priorityCommentTimestamps, setPriorityCommentTimestamps] = useState([]);
  const [regularCommentTimestamps, setRegularCommentTimestamps] = useState([]);
  const [audioTimestamps, setAudioTimestamps] = useState([]);
  const [combinedTimestamps, setCombinedTimestamps] = useState([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [audioAnalysisStarted, setAudioAnalysisStarted] = useState(false); // 이 상태는 현재 UI에 직접적인 영향을 주는지 확인 필요

  const [mostReplayedData, setMostReplayedData] = useState(null);
  const [isFetchingMostReplayed, setIsFetchingMostReplayed] = useState(false);
  const [mostReplayedError, setMostReplayedError] = useState('');

  const extractVideoIdFromUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  const processAudioAnalysis = async (urlForAnalysis) => {
    if (!urlForAnalysis) {
      console.error('App.js: Empty URL provided to processAudioAnalysis');
      setError('Cannot start audio analysis: No video URL for analysis.');
      return;
    }

    console.log(`App.js: Starting audio analysis for URL: ${urlForAnalysis}`);
    setIsAnalyzing(true);
    setAudioAnalysisStarted(true); // 상태 업데이트
    setError('');
    setAudioTimestamps([]);

    try {
      console.log('Attempting to start background analysis via POST /api/process-youtube');
      const startResponse = await fetch('http://localhost:5000/api/process-youtube', {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          youtube_url: urlForAnalysis,
          force_fresh: true
        }),
      });
      console.log(`POST /api/process-youtube response status: ${startResponse.status}`);

      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({ error: 'Failed to parse error JSON from /api/process-youtube' }));
        throw new Error(errorData.error || errorData.message || `HTTP error from /api/process-youtube! status: ${startResponse.status}`);
      }

      const initialData = await startResponse.json();
      console.log(`Initial response from POST /api/process-youtube: ${JSON.stringify(initialData)}`);

      // 백엔드 응답 키 확인: 'highlights' 대신 'audio_highlights' 사용
      if ((initialData.status === 'success' || initialData.status === 'partial_success') && Array.isArray(initialData.audio_highlights)) {
        console.log(`Found ${initialData.audio_highlights.length} audio_highlights immediately from /api/process-youtube.`);
        const formattedHighlights = initialData.audio_highlights.map(h => typeof h === 'number' ? h : parseFloat(h));
        setAudioTimestamps(formattedHighlights);
        // Most Replayed 데이터도 초기 응답에 포함될 수 있으므로 처리
        if (initialData.heatmap_info) { // Check if heatmap_info key exists
            if (initialData.heatmap_info.status === 'success') {
                console.log("Setting mostReplayedData from initial /api/process-youtube response:", initialData.heatmap_info);
                setMostReplayedData(initialData.heatmap_info); // Set the full {status, data} object
            } else {
                console.log("Heatmap_info in initial response but not 'success'. Will rely on fetchMostReplayedData. Initial heatmap_info:", initialData.heatmap_info);
            }
        }
        setIsAnalyzing(false);
        return;
      } else if (initialData.status !== 'processing') { // 'processing'이 아니면 에러로 간주 (예: 'error' status from initial call)
        throw new Error(initialData.message || initialData.error || 'Failed to start processing or received immediate error.');
      }


      let polling = true;
      let attempts = 0;
      const maxAttempts = 90;
      console.log('Starting polling for results via GET /api/analysis-status');

      while (polling && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
        console.log(`Polling attempt ${attempts}/${maxAttempts}`);

        try {
          const statusUrl = `http://localhost:5000/api/analysis-status?youtube_url=${encodeURIComponent(urlForAnalysis)}`;
          const statusRes = await fetch(statusUrl, { mode: 'cors' });
          console.log(`GET /api/analysis-status response code: ${statusRes.status}`);

          if (!statusRes.ok) {
            const errorData = await statusRes.json().catch(() => ({ error: 'Failed to parse error JSON from /api/analysis-status' }));
            throw new Error(errorData.error || errorData.message || `HTTP error from /api/analysis-status! status: ${statusRes.status}`);
          }

          const statusData = await statusRes.json();
          console.log(`Status data from GET /api/analysis-status: ${JSON.stringify(statusData)}`);

          // 백엔드 응답 키 확인: 'highlights' 대신 'audio_highlights' 사용
          if ((statusData.status === 'success' || statusData.status === 'partial_success') && Array.isArray(statusData.audio_highlights)) {
            console.log(`Received ${statusData.audio_highlights.length} audio_highlights from /api/analysis-status.`);
            const formattedHighlights = statusData.audio_highlights.map(h => typeof h === 'number' ? h : parseFloat(h));
            setAudioTimestamps(formattedHighlights);
            
            // Handle heatmap_info from polling response
            if (statusData.heatmap_info) { // If heatmap_info key exists in the response
                if (statusData.heatmap_info.status === 'success') {
                    console.log("Setting mostReplayedData from successful polling response heatmap_info:", statusData.heatmap_info);
                    setMostReplayedData(statusData.heatmap_info); // Set the full {status, data} object
                } else {
                    // Heatmap_info is present but not 'success' (e.g., an error from heatmap processing within the BG task)
                    // Preserve existing valid mostReplayedData rather than overwriting with an error from polling.
                    console.log("Heatmap_info in polling response but not status:'success'. Preserving existing mostReplayedData. Polled heatmap_info:", statusData.heatmap_info);
                }
            } else {
                // Heatmap_info key is NOT in the response. Preserve existing mostReplayedData.
                console.log("No heatmap_info key in polling response, preserving existing mostReplayedData");
            }
            polling = false;
          } else if (statusData.status === 'error') {
            setError(statusData.error || statusData.message || 'Audio analysis reported an error.');
            polling = false;
          } else if (statusData.status === 'not_started') {
            console.log('Analysis not_started (reported by /api/analysis-status), attempting to re-trigger POST /api/process-youtube');
            // 재시도 로직은 신중해야 함. 무한 루프 방지. 여기서는 일단 로그만 남기고 중단.
            // 또는 특정 횟수만 재시도하도록 수정 가능.
            // setError('Analysis failed to start properly. Please try again.');
            // polling = false; 
            // 아래는 기존 재시도 로직 (필요시 주석 해제)
            try {
              const restartRes = await fetch('http://localhost:5000/api/process-youtube', {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ youtube_url: urlForAnalysis, force_fresh: true }),
              });
              console.log(`Re-trigger POST /api/process-youtube response: ${restartRes.status}`);
              if (!restartRes.ok) {
                  const restartError = await restartRes.json().catch(() => ({error: "Failed to parse re-trigger error"}));
                  console.log(`Failed to re-trigger analysis: ${restartError.error || restartRes.statusText}`);
              }
            } catch (restartErr) {
              console.log(`Re-trigger POST /api/process-youtube network error: ${restartErr.message}`);
            }
          } else if (statusData.status === 'processing') {
            console.log('Current status from /api/analysis-status: processing...');
          } else {
            console.log(`Unknown status from /api/analysis-status: ${statusData.status}. Full data: ${JSON.stringify(statusData)}`);
          }
        } catch (pollErr) {
          setError(`Error polling audio analysis status: ${pollErr.message}`);
          polling = false;
        }
      }

      if (attempts >= maxAttempts && polling) {
        setError('Audio analysis timed out.');
      }
    } catch (err) {
      console.error('App.js: Error in processAudioAnalysis:', err);
      setError(err.message || 'An unexpected error occurred during audio analysis setup.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fetchMostReplayedData = async (youtubeUrl) => {
    if (!youtubeUrl) {
      console.warn("fetchMostReplayedData: No URL provided.");
      return;
    }
    console.log(`App.js: Fetching Most Replayed data for URL: ${youtubeUrl}`);
    setIsFetchingMostReplayed(true);
    setMostReplayedError('');
    setMostReplayedData(null);

    try {
      const response = await fetch(`http://localhost:5000/api/get-most-replayed?url=${encodeURIComponent(youtubeUrl)}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to parse error JSON from /api/get-most-replayed' }));
        if (response.status === 404) {
          console.log(`App.js: Most Replayed data not found for ${youtubeUrl} (404). Message: ${errorData.message}`);
          setMostReplayedData(null); // 404는 사용자에게 에러로 표시하지 않음
          setMostReplayedError(''); // 에러 메시지 상태도 초기화
        } else {
          console.error(`App.js: Error fetching Most Replayed data: ${response.status}`, errorData.message);
          setMostReplayedError(errorData.message || `HTTP error! status: ${response.status}`);
        }
        return;
      }

      const data = await response.json();
      if (data.status === 'success') {
        console.log("App.js: Most Replayed data fetched successfully:", data);
        setMostReplayedData(data);
      } else if (data.status === 'error') {
        console.log(`App.js: Most Replayed data not found (API reported error): ${data.message}`);
        setMostReplayedData(null); // API가 에러를 반환해도 사용자에게는 표시하지 않음
        setMostReplayedError(''); // 에러 메시지 상태도 초기화
      } else {
        console.warn("App.js: Received unexpected status from /api/get-most-replayed", data);
        setMostReplayedData(null);
      }
    } catch (networkError) {
      console.error("App.js: Network error fetching Most Replayed data:", networkError);
      setMostReplayedError(`Network error: ${networkError.message}`);
      setMostReplayedData(null);
    } finally {
      setIsFetchingMostReplayed(false);
    }
  };

  const handleVideoSubmit = async (submittedUrl) => {
    console.log("App.js: Video URL submitted:", submittedUrl);
    const extractedId = extractVideoIdFromUrl(submittedUrl);

    if (extractedId) {
      setAppVideoId(extractedId);
      setVideoUrlForContext(submittedUrl);
      setError('');
      setAudioTimestamps([]);
      setPriorityCommentTimestamps([]);
      setRegularCommentTimestamps([]);
      setMostReplayedData(null);
      setMostReplayedError('');
      setAudioAnalysisStarted(false);

      // 1. Fetch Most Replayed data first
      await fetchMostReplayedData(submittedUrl); // await 추가하여 순차적 실행 유도 가능 (선택 사항)

      // 2. Start full audio analysis (사용자가 버튼을 클릭하거나, 자동으로 시작)
      // 여기서는 Most Replayed 정보 표시 후 사용자가 "전체 분석" 버튼을 누르는 시나리오를 가정하지 않고 바로 시작합니다.
      // 만약 버튼 클릭 후 시작하려면 이 호출을 다른 함수로 옮겨야 합니다.
      processAudioAnalysis(submittedUrl); // 원본 URL을 전달 (백엔드가 ID 추출)
    } else {
      setError('Invalid YouTube URL. Please provide a valid YouTube video link.');
      setAppVideoId("");
      setVideoUrlForContext("");
      setMostReplayedData(null);
      setMostReplayedError('');
    }
  };

  useEffect(() => {
    const formatStamp = (timeInput, type, color, label = null) => {
      const time = typeof timeInput === 'number' ? timeInput : parseFloat(timeInput);
      if (isNaN(time)) return null;
      return { time, type, color, label };
    };

    console.log("App.js combinedTimestamps useEffect: Triggered.");
    console.log("App.js combinedTimestamps useEffect: priorityCommentTimestamps:", priorityCommentTimestamps);
    console.log("App.js combinedTimestamps useEffect: regularCommentTimestamps:", regularCommentTimestamps);
    console.log("App.js combinedTimestamps useEffect: audioTimestamps:", audioTimestamps);
    console.log("App.js combinedTimestamps useEffect: mostReplayedData (at start of effect):", JSON.parse(JSON.stringify(mostReplayedData || {})));

    const formattedPriority = priorityCommentTimestamps.map(t => formatStamp(t, 'priority', '#d47b06'));
    const formattedRegular = regularCommentTimestamps.map(t => formatStamp(t, 'comment', '#065fd4'));
    const formattedAudio = audioTimestamps.map(t => formatStamp(t, 'audio', '#2ca02c'));

    let allTimestamps = [...formattedPriority, ...formattedRegular, ...formattedAudio].filter(stamp => stamp !== null);

    if (mostReplayedData && mostReplayedData.status === 'success' && mostReplayedData.data) {
      console.log("App.js combinedTimestamps useEffect: Processing mostReplayedData.");
      const mrData = mostReplayedData.data.highest_intensity_marker_data;
      const mrLabel = mostReplayedData.data.most_replayed_label;
      
      console.log("App.js combinedTimestamps useEffect: mrData.startMillis:", mrData ? mrData.startMillis : 'mrData is null');

      if (mrData && mrData.startMillis) { // Ensure mrData and startMillis exist
        const startTimeSeconds = parseFloat(mrData.startMillis) / 1000;
        console.log("App.js combinedTimestamps useEffect: Parsed most replayed startTimeSeconds:", startTimeSeconds);

        if (!isNaN(startTimeSeconds)) {
          const mostReplayedStamp = formatStamp(
            startTimeSeconds,
            'mostReplayed',
            '#800080', // Purple color for most replayed
            mrLabel ? mrLabel.label_text : 'Most Replayed' // Add label for tooltip
          );
          console.log("App.js combinedTimestamps useEffect: Formatted mostReplayedStamp:", mostReplayedStamp);
          if (mostReplayedStamp) {
            allTimestamps.push(mostReplayedStamp);
          }
        } else {
          console.warn("App.js combinedTimestamps useEffect: mostReplayed startTimeSeconds is NaN after parsing.");
        }
      } else {
        console.warn("App.js combinedTimestamps useEffect: mrData or mrData.startMillis is missing for mostReplayedData.");
      }
    } else {
      console.log("App.js combinedTimestamps useEffect: Condition for processing mostReplayedData not met. Data:", JSON.parse(JSON.stringify(mostReplayedData || {})));
    }

    console.log("App.js combinedTimestamps useEffect: All timestamps BEFORE sorting & deduplication:", allTimestamps.map(t => ({...t})));

    // 시간순 정렬 및 우선순위 정렬
    const priorityOrder = { 'priority': 0, 'mostReplayed': 1, 'comment': 2, 'audio': 3 };
    allTimestamps.sort((a, b) => {
        const timeDiff = a.time - b.time;
        if (Math.abs(timeDiff) < 0.1) { // Consider times within 0.1s as same for priority sorting
            return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return timeDiff;
    });

    // 중복 제거 (1초 이내 근접 타임스탬프)
    const deduplicated = [];
    const seenTimes = new Set();
    allTimestamps.forEach(stamp => {
        const isCloseToSeen = Array.from(seenTimes).some(
            existingTime => Math.abs(existingTime - stamp.time) < 1 // Keep 1s deduplication window
        );

        if (!isCloseToSeen) {
            deduplicated.push(stamp);
            seenTimes.add(stamp.time);
        } else {
            // Optional: Log deduplicated stamps if needed for debugging
            // console.log(`Deduplicating stamp: ${stamp.type} at ${stamp.time}s due to proximity to a seen time.`);
        }
    });

    console.log("App.js combinedTimestamps useEffect: Final combined timestamps (deduplicated):", deduplicated.map(t => ({...t})));
    setCombinedTimestamps(deduplicated);
  }, [priorityCommentTimestamps, regularCommentTimestamps, audioTimestamps, mostReplayedData]);

  return (
    <UrlContext.Provider value={videoUrlForContext}>
      <TimestampContext.Provider value={{ currentTimestamp: currentTimestampForContext, setCurrentTimestamp: setCurrentTimestampForContext }}>
        <div>
          <div className="container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
            <VideoInput onVideoSubmit={handleVideoSubmit} />
            
            {isAnalyzing && <p>전체 하이라이트 분석 중... (오디오 및 댓글)</p>}
            {error && <p style={{ color: 'red', whiteSpace: 'pre-wrap', border: '1px solid red', padding: '10px', borderRadius: '4px' }}>전체 분석 오류: {error}</p>}
            
            <div className="main-content" style={{ display: 'flex', flexDirection: 'row', marginTop: '20px', gap: '20px' }}>
              <div className="left-column" style={{ flex: '1 1 400px', minWidth: '300px' }}>
                {appVideoId && (
                  <>
                    <VideoComments
                      videoId={appVideoId}
                      setPriorityTimestamps={setPriorityCommentTimestamps}
                      setRegularTimestamps={setRegularCommentTimestamps}
                    />
                    {/* Most Replayed 정보 표시 영역 (예시) */}
                    {isFetchingMostReplayed && <p>가장 많이 다시 본 구간 정보 로딩 중...</p>}
                    {mostReplayedError && <p style={{ color: 'orange' }}>Most Replayed 정보 오류: {mostReplayedError}</p>}
                    {mostReplayedData && mostReplayedData.status === 'success' && (
                      <div style={{ margin: '10px 0', padding: '10px', border: '1px solid #eee', borderRadius: '4px' }}>
                        <h4>가장 많이 다시 본 구간 정보:</h4>
                        {mostReplayedData.most_replayed_label && (
                          <p>
                            레이블: {mostReplayedData.most_replayed_label.label_text} (
                            {mostReplayedData.most_replayed_label.formatted_time || 
                             (mostReplayedData.most_replayed_label.decoration_time_millis ? `${Math.round(parseInt(mostReplayedData.most_replayed_label.decoration_time_millis)/1000)}s` : 'N/A')}
                            )
                          </p>
                        )}
                        {mostReplayedData.highest_intensity_marker_data && (
                          <p>
                            최고 강도 구간 시작: {mostReplayedData.highest_intensity_marker_data.formatted_start_time || 
                                              (mostReplayedData.highest_intensity_marker_data.startMillis ? `${Math.round(parseInt(mostReplayedData.highest_intensity_marker_data.startMillis)/1000)}s` : 'N/A')}
                          </p>
                        )}
                        {!mostReplayedData.most_replayed_label && !mostReplayedData.highest_intensity_marker_data && (
                            <p>세부적인 "Most Replayed" 정보가 없습니다.</p>
                        )}
                      </div>
                    )}
                    {/* Most Replayed 데이터가 있지만 success가 아닌 경우 (예: API가 error를 반환했으나 UI에 표시하지 않기로 한 경우) */}
                    {/* 또는 아예 데이터가 없는 경우 (fetchMostReplayedData에서 null로 설정된 경우) */}
                    {/* 이 부분은 사용자의 요구사항에 따라 메시지를 다르게 표시할 수 있습니다. */}
                    {!isFetchingMostReplayed && !mostReplayedError && (!mostReplayedData || mostReplayedData.status !== 'success') && appVideoId && (
                         <p style={{ margin: '10px 0', padding: '10px', border: '1px solid #eee', borderRadius: '4px' }}>
                            "가장 많이 다시 본 구간" 정보를 찾을 수 없거나 가져오는 데 실패했습니다.
                         </p>
                    )}
                  </>
                )}
              </div>

              <div className="right-column" style={{ flex: '2 1 600px', minWidth: '400px' }}>
                <VideoPlayer
                  timestampSeconds={combinedTimestamps}
                  mostReplayedRawData={mostReplayedData}
                />
              </div>
            </div>
          </div>
        </div>
      </TimestampContext.Provider>
    </UrlContext.Provider>
  );
}

export default App;