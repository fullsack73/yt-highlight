import React, { useState } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";

function App() {
  const [videoId, setVideoId] = useState("");
  const [timestampSeconds, setTimestampSeconds] = useState([]);
  const [audioHighlights, setAudioHighlights] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');

  const handleAudioAnalysis = async (audioFile) => {
    if (!audioFile) {
      setError('Please select an audio file');
      return;
    }

    const formData = new FormData();
    formData.append('audio', audioFile);
    
    setIsAnalyzing(true);
    setError('');
    
    try {
      const response = await fetch('http://localhost:5000/api/highlights', {
        method: 'POST',
        body: formData,
        mode: 'cors',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setAudioHighlights(data.highlights);
      // Update the timestamps to trigger video player updates
      setTimestampSeconds(data.highlights);
    } catch (err) {
      console.error('Error analyzing audio:', err);
      setError(err.message || 'An error occurred while processing the audio');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <VideoInput onVideoSubmit={setVideoId}>
        <div className="main-content">
          <div className="left-column">
            {videoId && (
              <>
                <div className="audio-upload" style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                  <h3>Audio Highlight Detection</h3>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => handleAudioAnalysis(e.target.files[0])}
                    disabled={isAnalyzing}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  {isAnalyzing && <p>Analyzing audio... This may take a moment.</p>}
                  {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                  
                  {audioHighlights.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                      <h4>Detected Highlights:</h4>
                      <ul style={{ listStyle: 'none', padding: 0, maxHeight: '200px', overflowY: 'auto' }}>
                        {audioHighlights.map((time, index) => (
                          <li key={index} style={{ marginBottom: '0.5rem', cursor: 'pointer' }}
                              onClick={() => setTimestampSeconds([time])}>
                            {formatTime(time)} - <span style={{ color: '#007bff' }}>Jump to highlight</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
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
