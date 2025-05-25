import React, { useState, createContext, useEffect, useRef } from "react";
import "./index.css";

console.log("✅ VideoInput.jsx 변경 반영됨");

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
            // UI is already loaded, so we can just show a success message
          } else if (data.status === 'processing') {
            // Show that processing is happening in the background
            setError(
              <div className="processing-message">
                <p>🔄 Audio analysis running in background...</p>
              </div>
            );
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
                  <p>⚠️ Audio analysis error: {errorMessage}</p>
                  <p>Video will play, but highlights may be limited.</p>
                  <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                    Retry Analysis
                  </button>
                </div>
              );
            } else if (errorMessage.includes('Download failed')) {
              setError(
                <div>
                  <p>Download error: {errorMessage}</p>
                  <p>Check the YouTube URL and try again.</p>
                  <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                    Retry Download
                  </button>
                </div>
              );
            } else if (errorMessage.includes('Failed to generate highlights')) {
              setError(
                <div>
                  <p>Highlight detection error: {errorMessage}</p>
                  <p>We'll try to generate basic highlights for you.</p>
                  <button onClick={() => retryWithFallback(videoUrl)} className="retry-button">
                    Generate Basic Highlights
                  </button>
                </div>
              );
            } else if (errorMessage.includes('Processing failed')) {
              setError(
                <div>
                  <p>Processing error: {errorMessage}</p>
                  <p>Try again or use a different video.</p>
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
            setError(data.error || 'Failed to process video');
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
