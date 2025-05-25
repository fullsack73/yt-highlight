// src/App.jsx
import React, { useState, useEffect } from "react";
import VideoComments from "./VideoComments.jsx"; // 실제 경로로 수정하세요.
import VideoInput from "./VideoInput.jsx";     // 실제 경로로 수정하세요.
import VideoPlayer from "./VideoPlayer.jsx";   // 실제 경로로 수정하세요.
import { UrlContext, TimestampContext } from "./VideoInput.jsx"; // 실제 경로로 수정하세요.
// import "./App.css"; // App.js 관련 CSS가 있다면

function App() {
  // App.js 자체에서 사용하는 videoId (주로 processAudioAnalysis 등에 사용)
  const [appVideoId, setAppVideoId] = useState(""); 
  
  // UrlContext Provider를 통해 VideoPlayer에 전달될 원본 YouTube URL
  const [videoUrlForContext, setVideoUrlForContext] = useState("");

  // TimestampContext Provider를 통해 VideoPlayer 및 다른 컴포넌트에 전달될 타임스탬프
  const [currentTimestampForContext, setCurrentTimestampForContext] = useState("");

  // 댓글 및 오디오 분석에서 추출된 타임스탬프들
  const [priorityCommentTimestamps, setPriorityCommentTimestamps] = useState([]);
  const [regularCommentTimestamps, setRegularCommentTimestamps] = useState([]);
  const [audioTimestamps, setAudioTimestamps] = useState([]);
  const [combinedTimestamps, setCombinedTimestamps] = useState([]); // 최종 결합된 타임스탬프 (VideoPlayer prop용)

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [audioAnalysisStarted, setAudioAnalysisStarted] = useState(false);

  // App.js 내부에서 YouTube URL로부터 비디오 ID를 추출하는 함수
  const extractVideoIdFromUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  // 오디오 분석을 처리하는 함수
  const processAudioAnalysis = async (urlForAnalysis) => { // videoId 기반 URL (예: https://www.youtube.com/watch?v=VIDEO_ID)
    if (!urlForAnalysis) {
      console.error('App.js: Empty URL provided to processAudioAnalysis');
      setError('Cannot start audio analysis: No video URL for analysis.');
      return;
    }
    
    console.log(`App.js: Starting audio analysis for URL: ${urlForAnalysis}`);
    setIsAnalyzing(true);
    setAudioAnalysisStarted(true);
    setError(''); // 이전 에러 메시지 초기화
    setAudioTimestamps([]); // 이전 오디오 타임스탬프 초기화

    try {
      console.log('Attempting to start background analysis via POST /api/process-youtube');
      let startResponse;
      try {
        startResponse = await fetch('http://localhost:5000/api/process-youtube', {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ 
            youtube_url: urlForAnalysis, // 분석할 원본 YouTube URL
            force_fresh: true // 항상 새로운 분석 시도
          }),
        });
        console.log(`POST /api/process-youtube response status: ${startResponse.status}`);
      } catch (fetchError) {
        console.log(`Network error during POST /api/process-youtube: ${fetchError.message}`);
        throw new Error(`Network error connecting to audio server: ${fetchError.message}`);
      }
      
      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({ error: 'Failed to parse error JSON from /api/process-youtube' }));
        console.log(`Error response from POST /api/process-youtube: ${startResponse.status} - ${errorData.error || errorData.message}`);
        throw new Error(errorData.error || errorData.message || `HTTP error from /api/process-youtube! status: ${startResponse.status}`);
      }
      
      const initialData = await startResponse.json();
      console.log(`Initial response from POST /api/process-youtube: ${JSON.stringify(initialData)}`);
      
      if (initialData.status === 'success' && Array.isArray(initialData.highlights)) {
        console.log(`Found ${initialData.highlights.length} highlights immediately from /api/process-youtube (cache on server?).`);
        const formattedHighlights = initialData.highlights.map(h => typeof h === 'number' ? h : parseFloat(h));
        setAudioTimestamps(formattedHighlights);
        setIsAnalyzing(false); // 분석 완료
        return; // 즉시 반환
      }

      // 상태 폴링 시작
      let polling = true;
      let attempts = 0;
      const maxAttempts = 90; // 약 3분 (90 * 2초)
      console.log('Starting polling for results via GET /api/audio-status');
      
      while (polling && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2초 대기
        attempts++;
        console.log(`Polling attempt ${attempts}/${maxAttempts}`);
        
        try {
          const statusUrl = `http://localhost:5000/api/audio-status?youtube_url=${encodeURIComponent(urlForAnalysis)}`;
          console.log(`Polling URL: ${statusUrl}`);
          
          const statusRes = await fetch(statusUrl, { mode: 'cors' });
          console.log(`GET /api/audio-status response code: ${statusRes.status}`);
          
          if (!statusRes.ok) {
            const errorData = await statusRes.json().catch(() => ({ error: 'Failed to parse error JSON from /api/audio-status' }));
            console.log(`Error status from GET /api/audio-status: ${statusRes.status} - ${errorData.error || errorData.message}`);
            throw new Error(errorData.error || errorData.message || `HTTP error from /api/audio-status! status: ${statusRes.status}`);
          }
          
          const statusData = await statusRes.json();
          console.log(`Status data from GET /api/audio-status: ${JSON.stringify(statusData)}`);
          
          if (statusData.status === 'success' && Array.isArray(statusData.highlights)) {
            console.log(`Received ${statusData.highlights.length} highlights from /api/audio-status.`);
            const formattedHighlights = statusData.highlights.map(h => typeof h === 'number' ? h : parseFloat(h));
            setAudioTimestamps(formattedHighlights);
            polling = false; // 폴링 중단
          } else if (statusData.status === 'error') {
            console.log(`Analysis error from /api/audio-status: ${statusData.error || statusData.message}`);
            setError(statusData.error || statusData.message || 'Audio analysis reported an error.');
            polling = false; // 폴링 중단
          } else if (statusData.status === 'not_started') {
            console.log('Analysis not_started (reported by /api/audio-status), attempting to re-trigger POST /api/process-youtube');
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
            console.log('Current status from /api/audio-status: processing...');
          } else {
            console.log(`Unknown status from /api/audio-status: ${statusData.status}. Full data: ${JSON.stringify(statusData)}`);
          }
        } catch (pollErr) {
          console.log(`Polling error for /api/audio-status: ${pollErr.message}`);
          setError(`Error polling audio analysis status: ${pollErr.message}`);
          polling = false; // 폴링 중단
        }
      }
      
      if (attempts >= maxAttempts && polling) {
        console.log('Audio analysis timed out after maximum attempts.');
        setError('Audio analysis timed out.');
      }
    } catch (err) {
      console.log(`Error in main processAudioAnalysis try-catch: ${err.message}`);
      console.error('App.js: Error in processAudioAnalysis:', err);
      setError(err.message || 'An unexpected error occurred during audio analysis setup.');
    } finally {
      console.log('Audio analysis process (frontend perspective) completed or stopped.');
      setIsAnalyzing(false); // 최종적으로 isAnalyzing 상태 해제
    }
  };

  // VideoInput에서 URL 제출 시 호출될 함수
  const handleVideoSubmit = (submittedUrl) => {
    console.log("App.js: Video submitted:", submittedUrl);
    // 모든 관련 상태 초기화
    setAppVideoId("");
    setVideoUrlForContext(""); // Context URL도 초기화
    setPriorityCommentTimestamps([]);
    setRegularCommentTimestamps([]);
    setAudioTimestamps([]);
    setCombinedTimestamps([]);
    setAudioAnalysisStarted(false);
    setIsAnalyzing(false);
    setError('');
    setCurrentTimestampForContext(""); // 현재 타임스탬프 컨텍스트도 초기화

    const extractedId = extractVideoIdFromUrl(submittedUrl);
    if (extractedId) {
      console.log("App.js: Extracted ID:", extractedId);
      setAppVideoId(extractedId);
      setVideoUrlForContext(submittedUrl); // Context에 원본 URL 전달
      
      // 오디오 분석 시작 (videoId 기반 URL 사용)
      processAudioAnalysis(`https://www.youtube.com/watch?v=${extractedId}`);
    } else {
      console.error("App.js: Invalid YouTube URL submitted.");
      setError('Invalid YouTube URL. Please provide a valid YouTube video link.');
    }
  };

  // 댓글 또는 오디오 타임스탬프 변경 시 combinedTimestamps 업데이트
  useEffect(() => {
    const formatStamp = (timeInput, type, color) => {
      const time = typeof timeInput === 'number' ? timeInput : parseFloat(timeInput);
      return { time: !isNaN(time) ? time : 0, type, color };
    };

    // 디버깅: App.jsx가 VideoComments로부터 받은 타임스탬프 확인
    console.log("App.js useEffect: priorityCommentTimestamps received:", priorityCommentTimestamps);
    console.log("App.js useEffect: regularCommentTimestamps received:", regularCommentTimestamps);
    console.log("App.js useEffect: audioTimestamps received:", audioTimestamps);

    const formattedPriority = priorityCommentTimestamps.map(t => formatStamp(t, 'priority', '#d47b06'));
    const formattedRegular = regularCommentTimestamps.map(t => formatStamp(t, 'comment', '#065fd4'));
    const formattedAudio = audioTimestamps.map(t => formatStamp(t, 'audio', '#34a853'));

    let allTimestamps = [...formattedPriority, ...formattedRegular, ...formattedAudio];
    
    allTimestamps.sort((a, b) => a.time - b.time);

    const deduplicated = [];
    const seenTimes = new Set();
    const priorityOrder = { 'priority': 0, 'comment': 1, 'audio': 2 };

    allTimestamps.sort((a, b) => {
        const timeDiff = a.time - b.time;
        if (timeDiff === 0) {
            return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return timeDiff;
    });

    allTimestamps.forEach(stamp => {
        const isCloseToSeen = Array.from(seenTimes).some(
            existingTime => Math.abs(existingTime - stamp.time) < 1
        );

        if (!isCloseToSeen) {
            deduplicated.push(stamp);
            seenTimes.add(stamp.time);
        }
    });
    
    console.log("App.js: Combined timestamps updated:", deduplicated);
    setCombinedTimestamps(deduplicated);
  }, [priorityCommentTimestamps, regularCommentTimestamps, audioTimestamps]);

  return (
    <UrlContext.Provider value={videoUrlForContext}>
      <TimestampContext.Provider value={{ currentTimestamp: currentTimestampForContext, setCurrentTimestamp: setCurrentTimestampForContext }}>
        <div> {/* 최상위 div */}
          <div className="container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
            <VideoInput onVideoSubmit={handleVideoSubmit} />
            
            <div className="main-content" style={{ display: 'flex', flexDirection: 'row', marginTop: '20px', gap: '20px' }}>
              <div className="left-column" style={{ flex: '1 1 400px', minWidth: '300px' }}>
                {appVideoId && (
                  <>
                    {error && <p style={{ color: 'red', whiteSpace: 'pre-wrap', border: '1px solid red', padding: '10px', borderRadius: '4px' }}>Error: {error}</p>}
                    
                    <VideoComments 
                      videoId={appVideoId} 
                      setPriorityTimestamps={setPriorityCommentTimestamps}
                      setRegularTimestamps={setRegularCommentTimestamps}
                      // onCommentsLoaded prop은 VideoComments에서 사용하지 않는다면 제거해도 됩니다.
                      // onCommentsLoaded={(loadedVideoId) => console.log(`Comments loaded for ${loadedVideoId}`)} 
                    />
                  </>
                )}
              </div>

              <div className="right-column" style={{ flex: '2 1 600px', minWidth: '400px' }}>
                <VideoPlayer timestampSeconds={combinedTimestamps} />
              </div>
            </div>
          </div>
        </div>
      </TimestampContext.Provider>
    </UrlContext.Provider>
  );
}

export default App;