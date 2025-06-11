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
  const [progressMessage, setProgressMessage] = useState('');
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
    console.log('[DEBUG] processAudioAnalysis: Triggered for URL:', urlForAnalysis);
    if (!urlForAnalysis) {
      console.error('[DEBUG] processAudioAnalysis: Aborted, no URL provided.');
      setError('Cannot start audio analysis: No video URL for analysis.');
      return;
    }

    console.log(`[DEBUG] processAudioAnalysis: Setting initial state for analysis.`);
    setIsAnalyzing(true);
    setAudioAnalysisStarted(true);
    setError('');
    setProgressMessage('Initiating analysis... This may take a moment.');
    setAudioTimestamps([]);

    try {
      console.log('[DEBUG] processAudioAnalysis: Sending POST to /api/process-youtube to start analysis.');
      const startResponse = await fetch('/api/process-youtube', {
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
      console.log(`[DEBUG] processAudioAnalysis: Initial response status: ${startResponse.status}`);

      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({ error: 'Failed to parse error JSON' }));
        throw new Error(errorData.error || errorData.message || `HTTP error! status: ${startResponse.status}`);
      }

      const initialData = await startResponse.json();
      console.log('[DEBUG] processAudioAnalysis: Parsed initial data:', JSON.parse(JSON.stringify(initialData)));

      if ((initialData.status === 'success' || initialData.status === 'partial_success') && Array.isArray(initialData.audio_highlights)) {
        console.log('[DEBUG] processAudioAnalysis: Analysis complete in initial response. Setting data.');
        const formattedHighlights = initialData.audio_highlights.map(h => typeof h === 'number' ? h : parseFloat(h));
        setAudioTimestamps(formattedHighlights);
        if (initialData.heatmap_info && initialData.heatmap_info.status === 'success') {
            setMostReplayedData(initialData.heatmap_info);
        }
        setIsAnalyzing(false);
        return;
      } else if (initialData.status !== 'processing') {
        throw new Error(initialData.message || initialData.error || 'Failed to start processing.');
      }

      console.log('[DEBUG] processAudioAnalysis: Starting polling loop.');
      let polling = true;
      let attempts = 0;
      const maxAttempts = 90;

      while (polling && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;
        console.log(`[DEBUG] processAudioAnalysis: Polling attempt ${attempts}/${maxAttempts}...`);

        try {
          const statusUrl = `/api/analysis-status?youtube_url=${encodeURIComponent(urlForAnalysis)}`;
          const statusRes = await fetch(statusUrl, { mode: 'cors' });
          console.log(`[DEBUG] processAudioAnalysis: Polling response status: ${statusRes.status}`);

          if (!statusRes.ok) {
            const errorData = await statusRes.json().catch(() => ({ error: 'Failed to parse polling error JSON' }));
            throw new Error(errorData.error || errorData.message || `Polling HTTP error! status: ${statusRes.status}`);
          }

          const statusData = await statusRes.json();
          console.log('[DEBUG] processAudioAnalysis: Polling response data:', JSON.parse(JSON.stringify(statusData)));

          if (statusData.status === 'processing' && statusData.message) {
            setProgressMessage(statusData.message);
          } else if ((statusData.status === 'success' || statusData.status === 'partial_success') && Array.isArray(statusData.audio_highlights)) {
            console.log('[DEBUG] processAudioAnalysis: Polling successful. Setting data.');
            const formattedHighlights = statusData.audio_highlights.map(h => typeof h === 'number' ? h : parseFloat(h));
            setAudioTimestamps(formattedHighlights);
            if (statusData.heatmap_info && statusData.heatmap_info.status === 'success') {
                setMostReplayedData(statusData.heatmap_info);
            }
            polling = false;
            setProgressMessage('');
          } else if (statusData.status === 'error') {
            console.error('[DEBUG] processAudioAnalysis: Polling returned an error status:', statusData.message);
            setError(statusData.message || 'An error occurred during analysis.');
            polling = false;
            setProgressMessage('');
          } else if (statusData.status === 'processing') {
            // Keep polling, message will be updated if available.
            console.log('[DEBUG] processAudioAnalysis: Status is still processing, continuing poll.');
          } else {
            console.warn('[DEBUG] processAudioAnalysis: Unknown status from polling:', statusData.status);
          }
        } catch (pollErr) {
          console.error('[DEBUG] processAudioAnalysis: Error during polling attempt:', pollErr);
          setError(`Error polling analysis status: ${pollErr.message}`);
          polling = false; // Stop polling on error
        }
      }

      if (attempts >= maxAttempts && polling) {
        console.error('[DEBUG] processAudioAnalysis: Polling timed out.');
        setError('Audio analysis timed out.');
        polling = false;
      }
    } catch (err) {
      console.error('[DEBUG] processAudioAnalysis: A critical error occurred:', err);
      setError(err.message);
    } finally {
        setIsAnalyzing(false);
        setProgressMessage('');
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
      const response = await fetch(`/api/get-most-replayed?url=${encodeURIComponent(youtubeUrl)}`, {
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
        console.log("[Debug] Most Replayed Data Received:", data);
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
    console.log('[DEBUG] handleVideoSubmit: Function triggered.');
        console.log('[DEBUG] handleVideoSubmit: URL submitted:', submittedUrl);
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
          console.log('[DEBUG] handleVideoSubmit: Calling processAudioAnalysis.');
    processAudioAnalysis(submittedUrl);
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

    if (mostReplayedData && mostReplayedData.status === 'success' && (mostReplayedData.highest_intensity_marker_data || mostReplayedData.most_replayed_label_marker_data)) {
      console.log("App.js combinedTimestamps useEffect: Processing mostReplayedData.");
      const highestIntensityMarker = mostReplayedData.highest_intensity_marker_data;
      const mrLabel = mostReplayedData.most_replayed_label;
      const mostReplayedLabelMarker = mostReplayedData.most_replayed_label_marker_data;
      
      // Process highest intensity marker
      if (highestIntensityMarker && highestIntensityMarker.startMillis) {
        const highestIntensitySeconds = parseFloat(highestIntensityMarker.startMillis) / 1000;
        console.log("App.js combinedTimestamps useEffect: Parsed highest intensity startTimeSeconds:", highestIntensitySeconds);

        if (!isNaN(highestIntensitySeconds)) {
          const highestIntensityStamp = formatStamp(
            highestIntensitySeconds,
            'mostReplayed',
            '#800080', // Purple color for most replayed
            'Highest Intensity' // Label for tooltip
          );
          console.log("App.js combinedTimestamps useEffect: Formatted highestIntensityStamp:", highestIntensityStamp);
          if (highestIntensityStamp) {
            allTimestamps.push(highestIntensityStamp);
          }
        }
      }
      
      // Process most replayed label marker (the point YouTube actually labels as "Most Replayed")
      if (mostReplayedLabelMarker && mostReplayedLabelMarker.startMillis) {
        const labelMarkerSeconds = parseFloat(mostReplayedLabelMarker.startMillis) / 1000;
        console.log("App.js combinedTimestamps useEffect: Parsed most replayed label startTimeSeconds:", labelMarkerSeconds);

        if (!isNaN(labelMarkerSeconds)) {
          const labelMarkerStamp = formatStamp(
            labelMarkerSeconds,
            'mostReplayed',
            '#800080', // Purple color for most replayed
            mrLabel ? mrLabel.label_text : 'Most Replayed' // Add label for tooltip
          );
          console.log("App.js combinedTimestamps useEffect: Formatted labelMarkerStamp:", labelMarkerStamp);
          if (labelMarkerStamp) {
            allTimestamps.push(labelMarkerStamp);
          }
        }
      }
      
      // Log if neither marker is available
      if ((!highestIntensityMarker || !highestIntensityMarker.startMillis) && 
          (!mostReplayedLabelMarker || !mostReplayedLabelMarker.startMillis)) {
        console.warn("App.js combinedTimestamps useEffect: Both marker types are missing or invalid in mostReplayedData.");
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
            
            {isAnalyzing && <p>히트맵 및 오디오 분석 중...</p>}
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