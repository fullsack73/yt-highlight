import React, { useContext, useEffect, useRef } from "react";
import { UrlContext, TimestampContext } from "./VideoInput.jsx";

const VideoPlayer = () => {
  const videoUrl = useContext(UrlContext);
  const { currentTimestamp } = useContext(TimestampContext);
  const iframeRef = useRef(null);

  // Extract video ID from URL
  const getVideoId = (url) => {
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  // Convert timestamp to seconds
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

  useEffect(() => {
    if (currentTimestamp && iframeRef.current) {
      const seconds = timestampToSeconds(currentTimestamp);
      const iframe = iframeRef.current;
      iframe.src = `https://www.youtube.com/embed/${videoId}?start=${seconds}`;
    }
  }, [currentTimestamp, videoId]);

  if (!videoId) {
    return (
      <div style={{ color: 'red', marginTop: '10px' }}>
        Please enter a valid YouTube URL
      </div>
    );
  }

  return (
    <div style={{ marginTop: '20px' }}>
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
