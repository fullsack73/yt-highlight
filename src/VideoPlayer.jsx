import React, { useContext, useEffect, useRef, useState } from "react";
import { UrlContext, TimestampContext } from "./VideoInput.jsx";
import "./index.css";

/**
 * YouTube 비디오 플레이어 컴포넌트
 * - YouTube URL을 입력받아 비디오를 재생
 * - 타임스탬프 클릭 시 해당 시점으로 비디오 이동
 * - 인터랙티브 타임라인 바 제공
 */
const VideoPlayer = ({ timestampSeconds = [] }) => {
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

  // Helper: Convert timestamp string to seconds (copied from VideoComments)
  const timestampToSeconds = (timestamp) => {
    const parts = timestamp.split(":").map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  // Load and initialize YouTube IFrame API and player
  useEffect(() => {
    let ytPlayer;
    let isMounted = true;

    function createPlayer() {
      if (playerRef.current && videoId) {
        ytPlayer = new window.YT.Player(playerRef.current, {
          videoId: videoId,
          events: {
            onReady: (event) => {
              if (!isMounted) return;
              setDuration(event.target.getDuration());
              setCurrentTime(event.target.getCurrentTime());
              setPlayer(event.target);
            },
            onStateChange: (event) => {
              if (!isMounted) return;
              if (event.data === window.YT.PlayerState.PLAYING) {
                setDuration(event.target.getDuration());
              }
            }
          }
        });
      }
    }

    // Clean up previous player instance
    setPlayer(null);
    if (playerRef.current) {
      playerRef.current.innerHTML = "";
    }

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      // Load the API if not already loaded
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => {
        createPlayer();
      };
    }

    return () => {
      isMounted = false;
      if (ytPlayer && ytPlayer.destroy) {
        ytPlayer.destroy();
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

  // Seek video when currentTimestamp changes
  useEffect(() => {
    if (player && currentTimestamp) {
      const seconds = timestampToSeconds(currentTimestamp);
      if (!isNaN(seconds) && seconds > 0) {
        player.seekTo(seconds, true);
      }
    }
  }, [currentTimestamp, player]);

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
          style={{ position: 'relative' }}
        >
          <div 
            className="timeline-progress"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
          {/* Timestamp markers */}
          {duration && timestampSeconds.map((sec, idx) => (
            <div
              key={idx}
              className="timeline-marker"
              style={{
                left: `${(sec / duration) * 100}%`,
                position: 'absolute',
                top: 0,
                height: '100%',
                width: '2px',
                background: '#065fd4',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
        <div className="timeline-time">
          {secondsToTimestamp(currentTime)} / {secondsToTimestamp(duration)}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
