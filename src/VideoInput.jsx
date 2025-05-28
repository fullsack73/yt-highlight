import React, { useState, createContext, useEffect, useRef } from "react";
import "./index.css";

// 전역 상태 관리를 위한 Context 생성
export const UrlContext = React.createContext("");
export const TimestampContext = React.createContext({
  currentTimestamp: "", // "MM:SS" 또는 "HH:MM:SS" 형식의 문자열
  setCurrentTimestamp: () => console.warn('TimestampContext.setCurrentTimestamp not yet initialized')
});

/**
 * 비디오 URL 입력 컴포넌트
 * - YouTube URL 입력 폼 제공
 * - URL 유효성 검사
 * - 자식 컴포넌트들에게 URL과 타임스탬프 정보 제공
 */
const VideoInput = ({ onVideoSubmit, children }) => {
  // 상태 관리
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const [currentTimestamp, setCurrentTimestamp] = useState("");
  const [lastError, setLastError] = useState(null);
  const debounceTimeout = useRef(null);

  // 첫 번째 코드에서 추가된 부분: URL 파라미터에서 초기 URL 설정
  const [initialUrl, setInitialUrl] = useState("");

  // 1. 초기 URL만 세팅 (컴포넌트 마운트 시 한 번만 실행)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const videoUrlParam = urlParams.get("videoUrl");
    if (videoUrlParam) {
      const decodedUrl = decodeURIComponent(videoUrlParam);
      console.log("URL 파라미터에서 비디오 URL 발견:", decodedUrl);
      setInitialUrl(decodedUrl);
    }
  }, []); // 빈 배열: 컴포넌트가 처음 마운트될 때만 실행

  // 2. 초기 URL을 videoUrl 상태로 반영 (initialUrl이 존재하고 videoUrl이 비어있을 때 단 1회만)
  useEffect(() => {
    if (initialUrl && !videoUrl) {
      setVideoUrl(initialUrl);
    }
  }, [initialUrl, videoUrl]); // initialUrl 또는 videoUrl이 변경될 때 실행

  /**
   * YouTube URL에서 비디오 ID 추출
   * @param {string} url - YouTube URL
   * @returns {string|null} 비디오 ID 또는 null
   */
  const extractVideoId = (url) => {
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  // Automatically submit when a valid URL is entered (debounced)
  useEffect(() => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    if (!videoUrl) return;
    debounceTimeout.current = setTimeout(() => {
      const videoId = extractVideoId(videoUrl);
      if (videoId) {
        setError("");

        // IMPORTANT: Call onVideoSubmit immediately to show player and comments
        // This allows the UI to load without waiting for the backend
        onVideoSubmit(videoUrl);

        // Start background processing with the backend
        console.log('Starting background processing for:', videoUrl);

        // Use the simplified API URL without /yt-highlight prefix
        const apiUrl = 'http://localhost:5000/api/process-youtube';
        console.log('Full API URL:', apiUrl);

        // Make the API call in the background without blocking UI
        fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ youtube_url: videoUrl }),
          // Simpler CORS settings
          credentials: 'omit',
          mode: 'cors',
        })
          .then(async (response) => {
            console.log('Response status:', response.status);
            console.log('Response headers:', [...response.headers.entries()]);

            // Try to get the response regardless of content type
            const text = await response.text();
            console.log('Response text:', text);

            if (!text || text.trim() === '') {
              throw new Error('Empty response from server');
            }

            try {
              // Try to parse as JSON
              return JSON.parse(text);
            } catch (parseError) {
              console.error('JSON parse error:', parseError);
              throw new Error(`Invalid JSON response: ${text}`);
            }
          })
          .then(data => {
            console.log('API response:', data);
            if (data.status === 'success') {
              console.log('Highlights:', data.highlights);
            } else if (data.status === 'processing') {
              // Start polling for results
              const statusInterval = setInterval(() => {
                checkStatus(videoUrl, statusInterval);
              }, 2000);
            } else if (data.status === 'error') {
              console.error('Processing error:', data.error);
              const errorMessage = data.error || 'Failed to process video';

              // Store the last error to enable retry functionality
              setLastError({
                url: videoUrl,
                message: errorMessage,
                timestamp: new Date().getTime()
              });

              // Just show error message - video is still playing
              if (errorMessage.includes('Broken pipe')) {
                setError(
                  <div className="error-message">
                    <p>⚠️ 오디오 분석 오류: {errorMessage}</p>
                    <p>비디오가 재생되지만, 하이라이트는 제한될 수 있습니다.</p>
                    <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                      Retry Analysis
                    </button>
                  </div>
                );
              } else if (errorMessage.includes('Download failed')) {
                setError(
                  <div>
                    <p>다운로드 오류: {errorMessage}</p>
                    <p>유튜브 URL을 확인하고 다시 시도해 보세요.</p>
                    <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                      Retry Download
                    </button>
                  </div>
                );
              } else if (errorMessage.includes('Failed to generate highlights')) {
                setError(
                  <div>
                    <p>하이라이트 탐지 오류: {errorMessage}</p>
                    <p>기본적인 하이라이트를 만들어드리겠습니다.</p>
                    <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                      Generate Basic Highlights
                    </button>
                  </div>
                );
              } else if (errorMessage.includes('Processing failed')) {
                setError(
                  <div>
                    <p>처리 오류: {errorMessage}</p>
                    <p>다시 시도하거나, 다른 동영상을 사용하세요.</p>
                    <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                      Retry Processing
                    </button>
                  </div>
                );
              } else {
                setError(
                  <div>
                    <p>{errorMessage}</p>
                    <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                      Retry
                    </button>
                  </div>
                );
              }
            } else {
              setError(data.error || '비디오 처리 실패');
            }
          })
          .catch((error) => {
            console.error('Error:', error);
            setError(error.message || 'An error occurred while processing the video.');
          });
      } else {
        setError("Invalid YouTube URL. Please enter a valid video link.");
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(debounceTimeout.current);
  }, [videoUrl]);

  // Function to retry analysis with force_fresh flag
  const retryWithFallback = (url) => {
    if (!url) return;

    setError("Retrying analysis with fallback options...");

    // Make API call with force_fresh=true to bypass cache
    fetch('http://localhost:5000/api/process-youtube', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
      mode: 'cors',
      body: JSON.stringify({
        youtube_url: url,
        force_fresh: true
      }),
    })
      .then(async (response) => {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Invalid response: ${text}`);
        }
        return response.json();
      })
      .then(data => {
        if (data.status === 'success') {
          console.log('Highlights (retry success):', data.highlights);
          onVideoSubmit(url);
        } else if (data.status === 'processing') {
          setError("Reprocessing started. Please wait...");
          // Check status every 2 seconds
          const statusInterval = setInterval(() => {
            checkStatus(url, statusInterval);
          }, 2000);
        } else {
          setError(`Retry failed: ${data.error || 'Unknown error'}`);
        }
      })
      .catch((error) => {
        console.error('Retry error:', error);
        setError(`Retry failed: ${error.message}`);
      });
  };

  // Function to check processing status
  const checkStatus = (url, interval) => {
    fetch(`http://localhost:5000/api/analysis-status?youtube_url=${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: {
        // 'Content-Type': 'application/json', // Not needed for GET with query params
      },
      credentials: 'omit', // Keep as is, or review if CORS issues arise
      mode: 'cors',
      // body: JSON.stringify({ youtube_url: url }), // Data sent via query parameter
    })
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          clearInterval(interval);
          // Don't call onVideoSubmit again - the player is already showing
          // Just update the status message
          setError(
            <div className="success-message">
              <p>✅ 오디오 분석 완료! {data.highlights?.length || 0} 타임라인에 추가된 하이라이트</p>
            </div>
          );

          // Dispatch an event to notify other components that highlights are ready
          const event = new CustomEvent('highlightsReady', { detail: data.highlights });
          window.dispatchEvent(event);

          // Auto-hide success message after 5 seconds
          setTimeout(() => setError(null), 5000);
        } else if (data.status === 'error') {
          clearInterval(interval);
          setError(
            <div className="error-message">
              <p>⚠️ 오디오 분석 오류: {data.error}</p>
              <p>비디오가 재생되지만, 하이라이트는 제한될 수 있습니다.</p>
              <button onClick={() => retryWithFallback(url)} className="retry-button">
                Retry Analysis
              </button>
            </div>
          );
        } else if (data.status === 'processing') {
          // Update the processing message with more details
        }
      })
      .catch(error => {
        clearInterval(interval);
        setError(
          <div className="error-message">
            <p>⚠️ 상태 확인 실패: {error.message}</p>
            <button onClick={() => retryWithFallback(url)} className="retry-button">
              Retry Analysis
            </button>
          </div>
        );
      });
  };

  return (
    // Context Provider로 자식 컴포넌트들에게 상태 제공
    <UrlContext.Provider value={videoUrl}>
      <TimestampContext.Provider value={{ currentTimestamp, setCurrentTimestamp }}>
        <div className="input-container">
          <h2>유튜브 하이라이터</h2>
          {/* URL 입력 폼 */}
          <form onSubmit={e => e.preventDefault()}>
            <input
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="유튜브 영상 주소를 입력하세요:"
            />
          </form>
          {/* 에러 메시지 표시 */}
          {error && <p className="error-message">{error}</p>}
          {/* 자식 컴포넌트 렌더링 */}
          {children}
        </div>
      </TimestampContext.Provider>
    </UrlContext.Provider>
  );
};

export default VideoInput;
