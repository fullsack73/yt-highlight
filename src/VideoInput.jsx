import React, { useState } from "react";
import "./index.css";

const VideoInput = ({ onVideoSubmit }) => {
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");

  // Function to extract Video ID from URL
  const extractVideoId = (url) => {
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const videoId = extractVideoId(videoUrl);
    if (videoId) {
      setError("");
      onVideoSubmit(videoId); // Pass video ID to parent
    } else {
      setError("Invalid YouTube URL. Please enter a valid video link.");
    }
  };

  return (
    <div className="input-container">
      <h2>YouTube Comment Highlighter</h2>
      <form onSubmit={handleSubmit}>
      <input 
          type="text" 
          value={videoUrl}  
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="Enter YouTube video URL"
      />
        <button type="submit">Fetch Comments</button> 
      </form>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
};

export default VideoInput;