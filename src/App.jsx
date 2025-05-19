import React, { useState, useEffect } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";

function App() {
  const [videoId, setVideoId] = useState("");
  const [timestampSeconds, setTimestampSeconds] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');

  const processYouTubeUrl = async (url) => {
    if (!url) {
      setError('Please enter a YouTube URL');
      return;
    }
    
    setIsAnalyzing(true);
    setError('');
    
    try {
      const response = await fetch('http://localhost:5000/api/process-youtube', {
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ youtube_url: url }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setTimestampSeconds(data.highlights || []);
    } catch (err) {
      console.error('Error processing YouTube URL:', err);
      setError(err.message || 'An error occurred while processing the YouTube video');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Extract video ID from YouTube URL
  const extractVideoId = (url) => {
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  return (
    <div>
      <VideoInput onVideoSubmit={(url) => {
        const videoId = extractVideoId(url);
        if (videoId) {
          setVideoId(videoId);
          processYouTubeUrl(url);
        } else {
          setError('Invalid YouTube URL');
        }
      }}>
        <div className="main-content">
          <div className="left-column">
            {videoId && (
              <>
                {isAnalyzing && <p>Analyzing video for highlights... This may take a moment.</p>}
                {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                <VideoComments videoId={videoId} setTimestampSeconds={setTimestampSeconds} />
              </>
            )}
          </div>
          <div className="right-column">
            {videoId && <VideoPlayer timestampSeconds={timestampSeconds} />}
          </div>
        </div>
      </VideoInput>
    </div>
  );
}

export default App
