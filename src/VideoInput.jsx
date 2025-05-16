import React, { useState, createContext, useEffect, useRef } from "react";
import "./index.css";

// 전역 상태 관리를 위한 Context 생성
export let UrlContext = createContext();
export let TimestampContext = createContext();

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
        onVideoSubmit(videoId);
      } else {
        setError("Invalid YouTube URL. Please enter a valid video link.");
      }
    }, 500); // 500ms debounce
    return () => clearTimeout(debounceTimeout.current);
  }, [videoUrl]);

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
