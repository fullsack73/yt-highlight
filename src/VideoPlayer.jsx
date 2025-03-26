import React, { useState, useContext } from "react";
import { UrlContext } from "./VideoInput.jsx";

const VideoPlayer = () => {
  const [videoSrc, setVideoSrc] = useState("");
  const videoUrl = useContext(UrlContext);

  const handlePlay = () => {
    if (!videoUrl) return alert("No YouTube URL found!");
    setVideoSrc(`http://localhost:5173/stream?url=${encodeURIComponent(videoUrl)}`);
  };

  return (
    <div>
      <button onClick={handlePlay}>Play Video</button>

      {videoSrc && (
        <video controls autoPlay width="600">
          <source src={videoSrc} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      )}
    </div>
  );
};

export default VideoPlayer;
