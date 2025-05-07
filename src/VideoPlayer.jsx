import React, { useContext, useEffect, useRef, useState } from "react";
import { UrlContext, TimestampContext } from "./VideoInput.jsx";
import "./index.css";

/**
 * YouTube 비디오 플레이어 컴포넌트
 * - YouTube URL을 입력받아 비디오를 재생
 * - 타임스탬프 클릭 시 해당 시점으로 비디오 이동
 * - 인터랙티브 타임라인 바 제공
 */
const VideoPlayer = () => {
  const videoUrl = useContext(UrlContext);
  const { currentTimestamp, setCurrentTimestamp } = useContext(TimestampContext);
  const playerRef = useRef(null);
  const [player, setPlayer] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  /**
   * YouTube URL에서 비디오 ID 추출
   * @param {string} url - YouTube URL
   * @returns {string|null} 비디오 ID 또는 null
   */
  const getVideoId = (url) => {
    const match = url && url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  const videoId = getVideoId(videoUrl);

  /**
   * 초를 "MM:SS" 또는 "HH:MM:SS" 형식으로 변환
   */
  const secondsToTimestamp = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Load YouTube IFrame API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
    // YT API ready callback
    window.onYouTubeIframeAPIReady = () => {
      if (playerRef.current && videoId) {
        const ytPlayer = new window.YT.Player(playerRef.current, {
          videoId: videoId,
          events: {
            onReady: (event) => {
              setDuration(event.target.getDuration());
              setCurrentTime(event.target.getCurrentTime());
              setPlayer(event.target);
            },
            onStateChange: (event) => {
              if (event.data === window.YT.PlayerState.PLAYING) {
                setDuration(event.target.getDuration());
              }
            }
          }
        });
      }
    };
  }, [videoId]);

  // Poll current time while playing
  useEffect(() => {
    let interval;
    if (player) {
      interval = setInterval(() => {
        setCurrentTime(player.getCurrentTime());
        setDuration(player.getDuration());
      }, 500);
    }
    return () => clearInterval(interval);
  }, [player]);

  /**
   * 타임라인 클릭/드래그 처리
   */
  const handleTimelineClick = (e) => {
    if (!player) return;
    const timeline = e.currentTarget;
    const rect = timeline.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    const newTime = clickPosition * duration;
    setCurrentTime(newTime);
    player.seekTo(newTime, true);
    setCurrentTimestamp(secondsToTimestamp(newTime));
  };

  // 유효한 비디오 ID가 없는 경우 에러 메시지 표시
  if (!videoId) {
    return (
      <div style={{ color: 'red', marginTop: '10px' }}>
        Please enter a valid YouTube URL
      </div>
    );
  }

  return (
    <div className="video-container">
      {/* YouTube Player */}
      <div id="yt-player-container">
        <div ref={playerRef} id="yt-player" />
      </div>
      
      {/* Interactive Timeline */}
      <div className="timeline-container">
        <div 
          className="timeline"
          onClick={handleTimelineClick}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onMouseMove={(e) => {
            if (isDragging) {
              handleTimelineClick(e);
            }
          }}
        >
          <div 
            className="timeline-progress"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>
        <div className="timeline-time">
          {secondsToTimestamp(currentTime)} / {secondsToTimestamp(duration)}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
