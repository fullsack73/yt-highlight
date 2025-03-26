import React, { useContext, useEffect, useRef } from "react";
import { UrlContext, TimestampContext } from "./VideoInput.jsx";

/**
 * YouTube 비디오 플레이어 컴포넌트
 * - YouTube URL을 입력받아 비디오를 재생
 * - 타임스탬프 클릭 시 해당 시점으로 비디오 이동
 */
const VideoPlayer = () => {
  // Context에서 URL과 타임스탬프 정보 가져오기
  const videoUrl = useContext(UrlContext);
  const { currentTimestamp } = useContext(TimestampContext);
  const iframeRef = useRef(null);

  /**
   * YouTube URL에서 비디오 ID 추출
   * @param {string} url - YouTube URL
   * @returns {string|null} 비디오 ID 또는 null
   */
  const getVideoId = (url) => {
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  /**
   * 타임스탬프 문자열을 초 단위로 변환
   * @param {string} timestamp - "MM:SS" 또는 "HH:MM:SS" 형식의 타임스탬프
   * @returns {number} 초 단위 시간
   */
  const timestampToSeconds = (timestamp) => {
    const parts = timestamp.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return 0;
  };

  const videoId = getVideoId(videoUrl);

  /**
   * 타임스탬프가 변경될 때마다 비디오 재생 위치 업데이트
   */
  useEffect(() => {
    if (currentTimestamp && iframeRef.current) {
      const seconds = timestampToSeconds(currentTimestamp);
      const iframe = iframeRef.current;
      // YouTube iframe URL에 시작 시간 파라미터 추가
      iframe.src = `https://www.youtube.com/embed/${videoId}?start=${seconds}`;
    }
  }, [currentTimestamp, videoId]);

  // 유효한 비디오 ID가 없는 경우 에러 메시지 표시
  if (!videoId) {
    return (
      <div style={{ color: 'red', marginTop: '10px' }}>
        Please enter a valid YouTube URL
      </div>
    );
  }

  return (
    <div style={{ marginTop: '20px' }}>
      {/* YouTube 임베드 iframe */}
      <iframe
        ref={iframeRef}
        width="600"
        height="400"
        src={`https://www.youtube.com/embed/${videoId}`}
        title="YouTube video player"
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      ></iframe>
    </div>
  );
};

export default VideoPlayer;
