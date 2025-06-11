// src/App.jsx
import React, { useState, useEffect, useRef } from "react";
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
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [error, setError] = useState('');
  const [audioAnalysisStarted, setAudioAnalysisStarted] = useState(false); // 이 상태는 현재 UI에 직접적인 영향을 주는지 확인 필요

  const [mostReplayedData, setMostReplayedData] = useState(null);
  const [isFetchingMostReplayed, setIsFetchingMostReplayed] = useState(false);
  const [mostReplayedError, setMostReplayedError] = useState('');

  const pollingIntervalRef = useRef(null);

  const extractVideoIdFromUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const processAudioAnalysis = async (urlForAnalysis) => {
    console.log('[DEBUG] processAudioAnalysis: Triggered for URL:', urlForAnalysis);
    if (!urlForAnalysis) {
      console.error('App.js: Empty URL provided to processAudioAnalysis');
      setError('Cannot start audio analysis: No video URL for analysis.');
      return;
    }

    console.log(`App.js: Starting audio analysis for URL: ${urlForAnalysis}`);
    setIsAnalyzing(true);
    setAudioAnalysisStarted(true); // 상태 업데이트
    setError('');
    setProgressMessage('Initiating analysis... This may take a moment.');
    setAudioTimestamps([]);

    try {
      console.log('Attempting to start background analysis via POST /api/process-youtube');
      const startResponse = await fetch('/api/process-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: urlForAnalysis, force_fresh: true }),
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
      } else if (initialData.status === 'processing' && initialData.cache_key) {
        setAnalysisProgress('Task submitted. Waiting for progress updates...');
        pollAnalysisStatus(initialData.cache_key);
      } else if (initialData.status !== 'processing') { // 'processing'이 아니면 에러로 간주 (예: 'error' status from initial call)
        throw new Error(initialData.message || initialData.error || 'Failed to start processing or received immediate error.');
>>>>>>> c82e141 (fixed 405 ad 400)
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
          const statusUrl = `/api/analysis-status?youtube_url=${encodeURIComponent(urlForAnalysis)}`;
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
              const restartRes = await fetch('/api/process-youtube', {
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
      setMostReplayedError("No URL provided for heatmap data.");
      return;
    }
    setIsFetchingMostReplayed(true);
    setMostReplayedError('');
    setMostReplayedData(null);

    try {
      const response = await fetch(`/api/get-most-replayed?url=${encodeURIComponent(youtubeUrl)}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Server responded with status: ${response.status}`);
      }

      const data = await response.json();
      if (data.status === 'success') {
        setMostReplayedData(data);
      } else {
        throw new Error(data.message || 'Failed to get most replayed data.');
      }
    } catch (e) {
      setError(`Analysis request failed: ${e.message}`);
      setIsAnalyzing(false);
      setAnalysisProgress('');
      setProgressMessage('');
    } finally {
      setIsFetchingMostReplayed(false);
    }
  };

  return (
    <UrlContext.Provider value={{ videoUrlForContext, setVideoUrlForContext }}>
      <TimestampContext.Provider value={{ currentTimestampForContext, setCurrentTimestampForContext }}>
        <div className="App">
          <header className="App-header">
            <h1>YT-Highlight-Analyzer</h1>
          </header>
          <main>
            <VideoInput onVideoSubmit={handleVideoSubmit} isAnalyzing={isAnalyzing} />
            
            {isAnalyzing && progressMessage && (
              <div className="analysis-status-container">
                <p className="progress-message">{progressMessage}</p>
                <div className="spinner"></div>
              </div>
            )}

            {error && (
              <div className="analysis-status-container">
                <p className="error-message">Error: {error}</p>
              </div>
            )}

            <div className="video-and-comments-container">
              {appVideoId && <VideoPlayer videoId={appVideoId} timestamps={combinedTimestamps} mostReplayed={mostReplayedData} />}
              {appVideoId && <VideoComments videoId={appVideoId} priorityTimestamps={priorityCommentTimestamps} regularTimestamps={regularCommentTimestamps} audioHighlights={audioTimestamps} onTimestampsUpdate={setCombinedTimestamps} />}
            </div>
          </main>
        </div>
      </TimestampContext.Provider>
    </UrlContext.Provider>
  );


  const handleVideoSubmit = async (submittedUrl) => {
    console.log("App.js: Video URL submitted:", submittedUrl);
    const extractedId = extractVideoIdFromUrl(submittedUrl);

    if (newVideoId) {
      setAppVideoId(newVideoId);
      setVideoUrlForContext(submittedUrl);
      
      // Reset all data for the new video
      stopPolling();
      setPriorityCommentTimestamps([]);
      setRegularCommentTimestamps([]);
      setAudioTimestamps([]);
      setCombinedTimestamps([]);
      setError('');
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
      setAnalysisProgress('');

      // Start both analyses
      processAudioAnalysis(submittedUrl);
      fetchMostReplayedData(submittedUrl);
    } else {
      setError("Invalid YouTube URL. Please check and try again.");
    }
  };

  const formatStamp = (timeInput, type, color, label = null) => {
    const time = parseFloat(timeInput);
    if (isNaN(time) || time < 0) return null;
    return { time, type, color, label };
  };

  useEffect(() => {
    const formattedPriority = priorityCommentTimestamps.map(t => formatStamp(t, 'priority', '#ff7f0e'));
    const formattedRegular = regularCommentTimestamps.map(t => formatStamp(t, 'comment', '#1f77b4'));
    const formattedAudio = audioTimestamps.map(t => formatStamp(t, 'audio', '#2ca02c'));

    let allTimestamps = [...formattedPriority, ...formattedRegular, ...formattedAudio].filter(stamp => stamp !== null);

    if (mostReplayedData && mostReplayedData.status === 'success' && (mostReplayedData.highest_intensity_marker_data || mostReplayedData.most_replayed_label_marker_data)) {
      const { highest_intensity_marker_data: highestIntensityMarker, most_replayed_label_marker_data: mostReplayedLabelMarker } = mostReplayedData;
      
      if (highestIntensityMarker && highestIntensityMarker.startMillis) {
        const intensitySeconds = parseFloat(highestIntensityMarker.startMillis) / 1000;
        if (!isNaN(intensitySeconds)) {
          allTimestamps.push(formatStamp(intensitySeconds, 'mostReplayed', '#d62728', 'Highest Intensity'));
        }
      }
      
      if (mostReplayedLabelMarker && mostReplayedLabelMarker.startMillis) {
        const labelMarkerSeconds = parseFloat(mostReplayedLabelMarker.startMillis) / 1000;
        const mrLabel = mostReplayedData.data.find(d => d.startMillis === mostReplayedLabelMarker.startMillis);
        if (!isNaN(labelMarkerSeconds)) {
          allTimestamps.push(formatStamp(labelMarkerSeconds, 'mostReplayed', '#800080', mrLabel ? mrLabel.label_text : 'Most Replayed'));
        }
      }
    }

    allTimestamps = allTimestamps.filter(Boolean);

    const priorityOrder = { 'priority': 0, 'mostReplayed': 1, 'comment': 2, 'audio': 3 };
    allTimestamps.sort((a, b) => {
        const timeDiff = a.time - b.time;
        if (Math.abs(timeDiff) < 1) { // Group nearby timestamps
            return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return timeDiff;
    });

    const deduplicated = [];
    if (allTimestamps.length > 0) {
      deduplicated.push(allTimestamps[0]);
      for (let i = 1; i < allTimestamps.length; i++) {
        if (Math.abs(allTimestamps[i].time - deduplicated[deduplicated.length - 1].time) >= 1) {
          deduplicated.push(allTimestamps[i]);
        }
      }
    }

    setCombinedTimestamps(deduplicated);

    // Cleanup polling on component unmount
    return () => stopPolling();
  }, [priorityCommentTimestamps, regularCommentTimestamps, audioTimestamps, mostReplayedData]);

  return (
    <UrlContext.Provider value={videoUrlForContext}>
      <TimestampContext.Provider value={{ currentTimestamp: currentTimestampForContext, setCurrentTimestamp: setCurrentTimestampForContext }}>
        <div>
          <div className="container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
            <VideoInput onVideoSubmit={handleVideoSubmit} />
            
            {isAnalyzing && <p style={{ color: '#007bff', fontWeight: 'bold' }}>Analysis Status: {analysisProgress}</p>}
            {error && <p style={{ color: 'red', whiteSpace: 'pre-wrap', border: '1px solid red', padding: '10px', borderRadius: '4px' }}>Error: {error}</p>}
            
            <div className="main-content" style={{ display: 'flex', flexDirection: 'row', marginTop: '20px', gap: '20px' }}>
              <div className="left-column" style={{ flex: '1 1 400px', minWidth: '300px' }}>
                {appVideoId && (
                  <>
                    <VideoComments
                      videoId={appVideoId}
                      setPriorityTimestamps={setPriorityCommentTimestamps}
                      setRegularTimestamps={setRegularCommentTimestamps}
                    />
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