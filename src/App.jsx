import React, { useState, useEffect } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";

function App() {
  const [videoId, setVideoId] = useState("");
  const [commentTimestamps, setCommentTimestamps] = useState([]);
  const [audioTimestamps, setAudioTimestamps] = useState([]);
  const [combinedTimestamps, setCombinedTimestamps] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [audioAnalysisStarted, setAudioAnalysisStarted] = useState(false);

  // Process audio analysis in the background after comments are loaded
  const processAudioAnalysis = async (url) => {
    if (!url) return;
    
    setIsAnalyzing(true);
    setAudioAnalysisStarted(true);
    
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
      setAudioTimestamps(data.highlights || []);
      console.log('Audio analysis completed with', data.highlights?.length || 0, 'highlights');
    } catch (err) {
      console.error('Error processing YouTube URL:', err);
      setError(err.message || 'An error occurred while processing the audio analysis');
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

  // Combine comment and audio timestamps when either updates
  useEffect(() => {
    // Combine and deduplicate timestamps
    const allTimestamps = [...new Set([...commentTimestamps, ...audioTimestamps])].sort((a, b) => a - b);
    setCombinedTimestamps(allTimestamps);
  }, [commentTimestamps, audioTimestamps]);

  return (
    <div>
      <VideoInput onVideoSubmit={(url) => {
        // Reset states
        setAudioTimestamps([]);
        setCommentTimestamps([]);
        setCombinedTimestamps([]);
        setAudioAnalysisStarted(false);
        setError('');
        
        const videoId = extractVideoId(url);
        if (videoId) {
          setVideoId(videoId);
          // Audio analysis will be triggered after comments are loaded
        } else {
          setError('Invalid YouTube URL');
        }
      }}>
        <div className="main-content">
          <div className="left-column">
            {videoId && (
              <>
                {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                
                {/* Start audio analysis when comments are loaded */}
                <VideoComments 
                  videoId={videoId} 
                  setTimestampSeconds={setCommentTimestamps} 
                  onCommentsLoaded={(url) => {
                    if (!audioAnalysisStarted) {
                      processAudioAnalysis(`https://www.youtube.com/watch?v=${videoId}`);
                    }
                  }}
                />
                
                {/* Audio analysis status */}
                {audioAnalysisStarted && (
                  <div className="audio-analysis-section">
                    <h3>Audio Analysis</h3>
                    {isAnalyzing ? (
                      <p>Analyzing audio for additional highlights... This may take a moment.</p>
                    ) : audioTimestamps.length > 0 ? (
                      <p>✅ Found {audioTimestamps.length} additional highlights from audio analysis!</p>
                    ) : (
                      <p>No additional highlights found from audio analysis.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="right-column">
            {videoId && <VideoPlayer timestampSeconds={combinedTimestamps} />}
          </div>
        </div>
      </VideoInput>
    </div>
  );
}

export default App;
