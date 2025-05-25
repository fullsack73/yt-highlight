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
    if (newVideoId !== internalVideoId) { // ID가 실제로 변경되었을 때만 업데이트
        setInternalVideoId(newVideoId);
        // ID 변경 시 플레이어 관련 상태 초기화
        setPlayer(null);
        setDuration(0);
        setCurrentTime(0);
        if (playerRef.current) {
            playerRef.current.innerHTML = ""; // 이전 플레이어 DOM 제거
        }
    }
  }, [videoUrlFromContext, internalVideoId]);


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
    let ytPlayerInstance; 
    let isMounted = true; 

    function initializePlayer() {
      if (playerRef.current && internalVideoId && window.YT && window.YT.Player) {
        // 기존 플레이어가 있다면 파괴 (setPlayer(null)이 useEffect 의존성으로 재실행 유발 가능성 있으므로 주의)
        // 이 로직은 internalVideoId 변경 시 이미 처리됨.
        // if (player) {
        //   player.destroy();
        //   setPlayer(null); // 상태 변경으로 재렌더링 및 이 useEffect 재실행 가능성
        // }

        // playerRef.current를 비워서 새 플레이어 공간 확보 (internalVideoId 변경 시 이미 처리)
        // playerRef.current.innerHTML = ''; 
        const newPlayerDiv = document.createElement('div');
        playerRef.current.appendChild(newPlayerDiv);

        console.log("VideoPlayer: Initializing YouTube player with videoId:", internalVideoId);
        ytPlayerInstance = new window.YT.Player(newPlayerDiv, {
          videoId: internalVideoId,
          playerVars: {
            autoplay: 0, 
            controls: 1, 
            modestbranding: 1, 
            rel: 0, 
          },
          events: {
            onReady: (event) => {
              if (!isMounted) return;
              console.log("VideoPlayer: Player ready. Duration:", event.target.getDuration());
              setPlayer(event.target); // 실제 플레이어 객체를 상태에 저장
              setDuration(event.target.getDuration());
              setCurrentTime(event.target.getCurrentTime());
            },
            onStateChange: (event) => {
              if (!isMounted) return;
              if (event.data === window.YT.PlayerState.PLAYING) {
                if (event.target && typeof event.target.getDuration === 'function') {
                    setDuration(event.target.getDuration()); 
                }
              }
            }
          }
        });
      } else if (!internalVideoId) {
        console.log("VideoPlayer: No internalVideoId, clearing player.");
         if (player && typeof player.destroy === 'function') { // player가 null이 아니고 destroy 함수가 있을 때만 호출
          player.destroy();
          setPlayer(null);
        }
        if(playerRef.current) playerRef.current.innerHTML = ""; 
      }
    }

    if (internalVideoId) { 
      if (window.YT && window.YT.Player) {
        initializePlayer();
      } else {
        console.log("VideoPlayer: YouTube IFrame API not loaded. Loading now...");
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
            document.head.appendChild(tag); // fallback
        }
        
        window.onYouTubeIframeAPIReady = () => {
          console.log("VideoPlayer: YouTube IFrame API ready.");
          if (isMounted) { 
            initializePlayer();
          }
        };
      }
    } else {
      if (player && typeof player.destroy === 'function') {
        player.destroy();
        setPlayer(null);
      }
      if(playerRef.current) playerRef.current.innerHTML = "";
    }

    return () => {
      isMounted = false;
      console.log("VideoPlayer: Unmounting or internalVideoId changed. Cleaning up player instance.");
      if (ytPlayerInstance && typeof ytPlayerInstance.destroy === 'function') {
        ytPlayerInstance.destroy();
      }
      // window.onYouTubeIframeAPIReady = null; // 전역 콜백은 신중히 제거
    };
  }, [internalVideoId]); // internalVideoId가 변경될 때마다 플레이어 재설정

  // 재생 시간 주기적 업데이트
  useEffect(() => {
    let intervalId;
    if (player && player.getPlayerState && typeof player.getCurrentTime === 'function' && typeof player.getDuration === 'function') {
      // 재생 중이거나 일시 중지 상태일 때만 인터벌 실행
      const playerState = player.getPlayerState();
      if (playerState === window.YT.PlayerState.PLAYING || playerState === window.YT.PlayerState.PAUSED) {
        intervalId = setInterval(() => {
          if (player && typeof player.getCurrentTime === 'function') { // player 객체 유효성 재확인
            const newCurrentTime = player.getCurrentTime();
            setCurrentTime(newCurrentTime);
            const currentDuration = player.getDuration();
            if (duration !== currentDuration) { // duration이 변경된 경우 업데이트
                setDuration(currentDuration);
            }
          }
        }, 500); 
      }
    }
    return () => clearInterval(intervalId);
  }, [player, duration]); // player 상태가 바뀔 때마다 (새 플레이어 인스턴스) 또는 duration이 바뀔 때마다 재설정

  // Context의 currentTimestamp 변경 시 비디오 탐색 (seek)
  useEffect(() => {
    if (player && typeof player.seekTo === 'function' && currentTimestampFromContext) {
      const secondsToSeek = timestampStringToSeconds(currentTimestampFromContext);
      if (!isNaN(secondsToSeek) && secondsToSeek >= 0 && (duration === 0 || secondsToSeek <= duration)) { // duration이 0일 때도 seek 시도 (초기 로드)
        console.log(`VideoPlayer: Seeking to ${secondsToSeek}s based on context timestamp ${currentTimestampFromContext}`);
        player.seekTo(secondsToSeek, true);
        // seek 후 context의 타임스탬프를 초기화하여 반복적인 seek 방지 (선택적)
        // setCurrentTimestampInContext(""); 
      }
    }
  }, [currentTimestampFromContext, player, duration, setCurrentTimestampInContext]);

  /**
   * 타임라인 클릭 또는 드래그 시 비디오 탐색
   */
  const handleTimelineInteraction = (e) => {
    if (!player || !duration || typeof player.seekTo !== 'function') return;
    
    const timeline = e.currentTarget; 
    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left; 
    const timelineWidth = rect.width;
    
    let newTimeFraction = clickX / timelineWidth;
    newTimeFraction = Math.max(0, Math.min(1, newTimeFraction)); 
    
    const newPlayerTime = newTimeFraction * duration;
    
    setCurrentTime(newPlayerTime); 
    player.seekTo(newPlayerTime, true); 
    if (setCurrentTimestampInContext) {
      setCurrentTimestampInContext(secondsToTimestampString(newPlayerTime));
    }
  };

  if (!internalVideoId && videoUrlFromContext) { 
    return (
      <div style={{ color: 'red', marginTop: '20px', padding: '10px', border: '1px solid red' }}>
        Please enter a valid YouTube URL. Could not extract Video ID from: "{videoUrlFromContext}"
      </div>
    );
  }


  return (
    <div className="video-player-wrapper"> 
      <div className="video-container">
        <div ref={playerRef} id={`youtube-player-${internalVideoId}`} /> {/* 플레이어 div에 고유 ID 부여 (선택적) */}
      </div>
      
      {duration > 0 && player && ( // player 객체가 존재하고 duration > 0일 때 타임라인 표시
        <div className="timeline-controls-container">
          <div 
            className="timeline"
            onClick={handleTimelineInteraction} 
            onMouseDown={(e) => { 
              if (e.button !== 0) return; // 왼쪽 클릭만
              setIsDragging(true);
              handleTimelineInteraction(e); 
            }}
            onMouseUp={() => setIsDragging(false)} 
            onMouseLeave={() => setIsDragging(false)} 
            onMouseMove={(e) => { 
              if (isDragging) {
                handleTimelineInteraction(e);
              }
            }}
            style={{ cursor: 'pointer' }} 
          >
            <div 
              className="timeline-progress"
              style={{ width: `${(currentTime / duration) * 100}%` }}
            />
            {timestampSeconds.map((stamp, idx) => {
              const isObjectFormat = typeof stamp === 'object' && stamp !== null && typeof stamp.time === 'number';
              const timeValue = isObjectFormat ? stamp.time : (typeof stamp === 'number' ? stamp : 0);
              const markerColor = isObjectFormat ? stamp.color : '#065fd4'; 
              const markerType = isObjectFormat ? stamp.type : 'comment'; 
              
              if (timeValue > duration) return null; 

              return (
                <div
                  key={`${markerType}-${idx}-${timeValue.toFixed(2)}`} // toFixed로 소수점 문제 방지
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