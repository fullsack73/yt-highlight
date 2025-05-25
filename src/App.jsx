// src/App.jsx
import React, { useState, useEffect } from "react";
import VideoComments from "./VideoComments.jsx"; // 경로 예시, 실제 경로로 수정하세요.
import VideoInput from "./VideoInput.jsx";     // 경로 예시, 실제 경로로 수정하세요.
import VideoPlayer from "./VideoPlayer.jsx";   // 경로 예시, 실제 경로로 수정하세요.
import { UrlContext, TimestampContext } from "./VideoInput.jsx"; // 경로 예시, 실제 경로로 수정하세요.
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
            // 재시작 시도 (이 부분은 서버 상태에 따라 반복될 수 있으므로 주의)
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
            // 알 수 없는 상태는 에러로 간주하거나, 계속 폴링할 수 있음. 여기서는 일단 로그만 남김.
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
      // videoUrlForContext는 ""로 유지되어 VideoPlayer에 빈 URL이 전달되도록 함
    }
  };

  // 댓글 또는 오디오 타임스탬프 변경 시 combinedTimestamps 업데이트
  useEffect(() => {
    const formatStamp = (timeInput, type, color) => {
      // 시간 값이 숫자인지 확인하고, 아니면 0으로 변환
      const time = typeof timeInput === 'number' ? timeInput : parseFloat(timeInput);
      return { time: !isNaN(time) ? time : 0, type, color };
    };

    const formattedPriority = priorityCommentTimestamps.map(t => formatStamp(t, 'priority', '#d47b06'));
    const formattedRegular = regularCommentTimestamps.map(t => formatStamp(t, 'comment', '#065fd4'));
    const formattedAudio = audioTimestamps.map(t => formatStamp(t, 'audio', '#34a853'));

    let allTimestamps = [...formattedPriority, ...formattedRegular, ...formattedAudio];
    
    // 1. 시간 순으로 정렬
    allTimestamps.sort((a, b) => a.time - b.time);

    // 2. 중복 제거 (타입 우선순위 고려)
    const deduplicated = [];
    const seenTimes = new Set(); // 이미 추가된 시간 기록 (근사치 비교용)
    
    // 우선순위 정의: priority > comment > audio
    const priorityOrder = { 'priority': 0, 'comment': 1, 'audio': 2 };

    // 중복 제거 전, 동일 시간대 마커들의 우선순위를 위해 다시 정렬 (시간 -> 타입 우선순위)
    allTimestamps.sort((a, b) => {
        const timeDiff = a.time - b.time;
        if (timeDiff === 0) {
            return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return timeDiff;
    });

    allTimestamps.forEach(stamp => {
        // 1초 이내의 타임스탬프는 중복으로 간주하고, 우선순위가 높은 것만 유지
        let isConsideredDuplicate = false;
        for (const existingStamp of deduplicated) {
            if (Math.abs(existingStamp.time - stamp.time) < 1) { // 1초 이내
                // 이미 추가된 것이 현재 것보다 우선순위가 높거나 같으면 현재 것은 중복
                if (priorityOrder[existingStamp.type] <= priorityOrder[stamp.type]) {
                    isConsideredDuplicate = true;
                    break;
                } else {
                    // 현재 것이 우선순위가 더 높으면, 기존 것을 제거하고 현재 것을 추가해야 함
                    // (이 로직은 복잡해지므로, 여기서는 단순히 우선순위 높은 것만 남도록 정렬 후 Set으로 필터링)
                    // Set으로 처리하는게 더 간단. 아래 로직 수정.
                }
            }
        }
        // 위 로직보다 아래가 더 간단: 이미 정렬된 상태이므로, Set에 기록된 시간과 비교
        const isCloseToSeen = Array.from(seenTimes).some(
            existingTime => Math.abs(existingTime - stamp.time) < 1
        );

        if (!isCloseToSeen) {
            deduplicated.push(stamp);
            seenTimes.add(stamp.time); // 현재 시간을 "본 시간"으로 기록
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
                {appVideoId && ( // appVideoId는 댓글 로딩 및 오디오 분석 상태 표시에 사용
                  <>
                    {error && <p style={{ color: 'red', whiteSpace: 'pre-wrap', border: '1px solid red', padding: '10px', borderRadius: '4px' }}>Error: {error}</p>}
                    
                    <VideoComments 
                      videoId={appVideoId} 
                      setPriorityTimestamps={setPriorityCommentTimestamps}
                      setRegularTimestamps={setRegularCommentTimestamps}
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