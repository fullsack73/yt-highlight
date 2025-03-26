import React, { useState, createContext } from "react";
import "./index.css";

export let UrlContext = createContext();
export let TimestampContext = createContext();

const VideoInput = ({ onVideoSubmit, children }) => {
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState("");
  const [currentTimestamp, setCurrentTimestamp] = useState("");

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
    <UrlContext.Provider value={videoUrl}>
      <TimestampContext.Provider value={{ currentTimestamp, setCurrentTimestamp }}>
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
          {children}
        </div>
      </TimestampContext.Provider>
    </UrlContext.Provider>
  );
};

export default VideoInput;