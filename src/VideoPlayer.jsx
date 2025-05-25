// src/components/VideoPlayer.jsx
import React, { useContext, useEffect, useRef, useState } from "react";
import { UrlContext, TimestampContext } from "./VideoInput.jsx"; // VideoInput.jsx에서 export 했다면
import "./index.css"; // VideoPlayer 관련 CSS가 있다면

/**
 * YouTube 비디오 플레이어 컴포넌트
 */
const VideoPlayer = ({ timestampSeconds = [] }) => {
  // Context에서 URL 및 타임스탬프 관련 값 가져오기
  const videoUrlFromContext = useContext(UrlContext) || "";
  
  const timestampContextValue = useContext(TimestampContext);
  const currentTimestampFromContext = timestampContextValue ? timestampContextValue.currentTimestamp : "";
  const setCurrentTimestampInContext = timestampContextValue ? timestampContextValue.setCurrentTimestamp : () => console.warn('setCurrentTimestamp not available in VideoPlayer');
  
  const playerRef = useRef(null); // YouTube 플레이어 인스턴스를 참조
  const [player, setPlayer] = useState(null); // YouTube 플레이어 API 객체
  const [duration, setDuration] = useState(0); // 비디오 총 길이 (초)
  const [currentTime, setCurrentTime] = useState(0); // 현재 재생 시간 (초)
  const [isDragging, setIsDragging] = useState(false); // 타임라인 드래그 상태
  const [internalVideoId, setInternalVideoId] = useState(null); // 컴포넌트 내부에서 사용할 videoId

  /**
   * YouTube URL에서 비디오 ID 추출
   */
  const getVideoId = (url) => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  // videoUrlFromContext가 변경될 때마다 internalVideoId 업데이트
  useEffect(() => {
    const newVideoId = getVideoId(videoUrlFromContext);
    console.log("VideoPlayer: videoUrlFromContext changed to:", videoUrlFromContext, "Parsed ID:", newVideoId);
    setInternalVideoId(newVideoId);
  }, [videoUrlFromContext]);


  /**
   * 초를 "MM:SS" 또는 "HH:MM:SS" 형식으로 변환
   */
  const secondsToTimestampString = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  /**
   * "MM:SS" 또는 "HH:MM:SS" 형식의 타임스탬프 문자열을 초로 변환
   */
  const timestampStringToSeconds = (timestamp) => {
    if (!timestamp || typeof timestamp !== 'string') return 0;
    const parts = timestamp.split(":").map(Number);
    if (parts.some(isNaN)) return 0; // 유효하지 않은 숫자 포함 시

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  // YouTube IFrame API 로드 및 플레이어 초기화
  useEffect(() => {
    let ytPlayerInstance; // 이 useEffect 스코프 내의 플레이어 인스턴스
    let isMounted = true; // 컴포넌트 마운트 상태 추적

    function initializePlayer() {
      if (playerRef.current && internalVideoId && window.YT && window.YT.Player) {
        // 기존 플레이어가 있다면 파괴
        if (player) {
          player.destroy();
          setPlayer(null);
        }
        // playerRef.current를 비워서 새 플레이어 공간 확보
        playerRef.current.innerHTML = ''; 
        const newPlayerDiv = document.createElement('div');
        playerRef.current.appendChild(newPlayerDiv);

        console.log("VideoPlayer: Initializing YouTube player with videoId:", internalVideoId);
        ytPlayerInstance = new window.YT.Player(newPlayerDiv, {
          videoId: internalVideoId,
          playerVars: {
            autoplay: 0, // 자동 재생 비활성화
            controls: 1, // 기본 컨트롤 표시 (타임라인 직접 구현하므로 0으로 할 수도 있음)
            modestbranding: 1, // YouTube 로고 최소화
            rel: 0, // 관련 동영상 표시 안함
          },
          events: {
            onReady: (event) => {
              if (!isMounted) return;
              console.log("VideoPlayer: Player ready. Duration:", event.target.getDuration());
              setDuration(event.target.getDuration());
              setCurrentTime(event.target.getCurrentTime());
              setPlayer(event.target); // 실제 플레이어 객체를 상태에 저장
            },
            onStateChange: (event) => {
              if (!isMounted) return;
              // 필요시 플레이어 상태 변경에 따른 로직 추가
              if (event.data === window.YT.PlayerState.PLAYING) {
                setDuration(event.target.getDuration()); // 재생 시작 시에도 duration 업데이트
              }
            }
          }
        });
      } else if (!internalVideoId) {
        console.log("VideoPlayer: No internalVideoId, clearing player.");
         if (player) {
          player.destroy();
          setPlayer(null);
        }
        if(playerRef.current) playerRef.current.innerHTML = ""; // 플레이어 공간 비우기
      }
    }

    if (internalVideoId) { // 유효한 videoId가 있을 때만 API 로드 시도
      if (window.YT && window.YT.Player) {
        initializePlayer();
      } else {
        console.log("VideoPlayer: YouTube IFrame API not loaded. Loading now...");
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        
        window.onYouTubeIframeAPIReady = () => {
          console.log("VideoPlayer: YouTube IFrame API ready.");
          if (isMounted) { // API 로드 후 컴포넌트가 여전히 마운트 상태인지 확인
            initializePlayer();
          }
        };
      }
    } else {
       // internalVideoId가 없으면 기존 플레이어 정리
      if (player) {
        player.destroy();
        setPlayer(null);
      }
      if(playerRef.current) playerRef.current.innerHTML = "";
    }

    return () => {
      isMounted = false;
      console.log("VideoPlayer: Unmounting. Cleaning up player.");
      // ytPlayerInstance는 이 useEffect 스코프의 변수이므로 직접 접근하여 destroy 호출
      if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
        ytPlayerInstance.destroy();
      }
      // 전역 콜백 정리 (필요한 경우)
      // window.onYouTubeIframeAPIReady = null; // 다른 컴포넌트도 이 API를 사용할 수 있으므로 주의
    };
  }, [internalVideoId]); // internalVideoId가 변경될 때마다 플레이어 재설정

  // 재생 시간 주기적 업데이트
  useEffect(() => {
    let intervalId;
    if (player && player.getPlayerState && (player.getPlayerState() === window.YT.PlayerState.PLAYING || player.getPlayerState() === window.YT.PlayerState.PAUSED)) {
      intervalId = setInterval(() => {
        if (player && typeof player.getCurrentTime === 'function') {
          const newCurrentTime = player.getCurrentTime();
          setCurrentTime(newCurrentTime);
          if (typeof player.getDuration === 'function') {
             setDuration(player.getDuration());
          }
        }
      }, 500); // 0.5초마다 업데이트
    }
    return () => clearInterval(intervalId);
  }, [player]);

  // Context의 currentTimestamp 변경 시 비디오 탐색 (seek)
  useEffect(() => {
    if (player && typeof player.seekTo === 'function' && currentTimestampFromContext) {
      const secondsToSeek = timestampStringToSeconds(currentTimestampFromContext);
      if (!isNaN(secondsToSeek) && secondsToSeek >= 0 && secondsToSeek <= duration) {
        console.log(`VideoPlayer: Seeking to ${secondsToSeek}s based on context timestamp ${currentTimestampFromContext}`);
        player.seekTo(secondsToSeek, true);
      }
    }
  }, [currentTimestampFromContext, player, duration]); // duration도 의존성에 추가

  /**
   * 타임라인 클릭 또는 드래그 시 비디오 탐색
   */
  const handleTimelineInteraction = (e) => {
    if (!player || !duration || typeof player.seekTo !== 'function') return;
    
    const timeline = e.currentTarget; // 이벤트가 발생한 .timeline div
    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left; // 타임라인 내 클릭 X 좌표
    const timelineWidth = rect.width;
    
    let newTimeFraction = clickX / timelineWidth;
    newTimeFraction = Math.max(0, Math.min(1, newTimeFraction)); // 0과 1 사이로 제한
    
    const newPlayerTime = newTimeFraction * duration;
    
    setCurrentTime(newPlayerTime); // UI 즉시 업데이트
    player.seekTo(newPlayerTime, true); // 플레이어 실제 탐색
    // Context의 타임스탬프도 업데이트하여 다른 컴포넌트와 동기화
    if (setCurrentTimestampInContext) {
      setCurrentTimestampInContext(secondsToTimestampString(newPlayerTime));
    }
  };

  // 유효한 internalVideoId가 없는 경우 메시지 표시
  if (!internalVideoId && videoUrlFromContext) { // URL은 있는데 ID 파싱 실패
    return (
      <div style={{ color: 'red', marginTop: '20px', padding: '10px', border: '1px solid red' }}>
        Please enter a valid YouTube URL. Could not extract Video ID from: "{videoUrlFromContext}"
      </div>
    );
  }

  return (
    <div className="video-player-wrapper"> {/* 전체를 감싸는 div */}
      <div className="video-container">
        {/* YouTube 플레이어가 삽입될 div */}
        <div ref={playerRef} />
      </div>
      
      {duration > 0 && ( // 비디오 로드 후 (duration > 0) 타임라인 표시
        <div className="timeline-controls-container">
          <div 
            className="timeline"
            onClick={handleTimelineInteraction} // 클릭 시
            onMouseDown={(e) => { // 드래그 시작
              setIsDragging(true);
              handleTimelineInteraction(e); // 마우스 다운 시점에서도 시간 변경 적용
            }}
            onMouseUp={() => setIsDragging(false)} // 드래그 종료
            onMouseLeave={() => setIsDragging(false)} // 마우스 벗어나면 드래그 종료
            onMouseMove={(e) => { // 드래그 중
              if (isDragging) {
                handleTimelineInteraction(e);
              }
            }}
            style={{ cursor: 'pointer' }} // 마우스 커서 변경
          >
            <div 
              className="timeline-progress"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            {/* 타임스탬프 마커들 */}
            {timestampSeconds.map((stamp, idx) => {
              const isObjectFormat = typeof stamp === 'object' && stamp !== null && typeof stamp.time === 'number';
              const timeValue = isObjectFormat ? stamp.time : (typeof stamp === 'number' ? stamp : 0);
              const markerColor = isObjectFormat ? stamp.color : '#065fd4'; // 기본 파란색
              const markerType = isObjectFormat ? stamp.type : 'comment'; // 기본 타입
              
              if (timeValue > duration) return null; // 비디오 길이 초과하는 마커는 표시 안 함

              return (
                <div
                  key={`${markerType}-${idx}-${timeValue}`} // 더 고유한 키
                  className={`timeline-marker timeline-marker-${markerType}`}
                  style={{
                    left: `${(timeValue / duration) * 100}%`,
                    backgroundColor: markerColor,
                  }}
                  title={`${markerType.charAt(0).toUpperCase() + markerType.slice(1)} at ${secondsToTimestampString(timeValue)}`}
                />
              );
            })}
          </div>
          <div className="timeline-time-display">
            {secondsToTimestampString(currentTime)} / {secondsToTimestampString(duration)}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;