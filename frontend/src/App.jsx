// src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";
import { UrlContext, TimestampContext } from "./VideoInput.jsx";

function App() {
  const [appVideoId, setAppVideoId] = useState("");
  const [videoUrlForContext, setVideoUrlForContext] = useState("");
  const [currentTimestampForContext, setCurrentTimestampForContext] = useState("");

  const [priorityCommentTimestamps, setPriorityCommentTimestamps] = useState([]);
  const [regularCommentTimestamps, setRegularCommentTimestamps] = useState([]);
  const [audioTimestamps, setAudioTimestamps] = useState([]);
  const [combinedTimestamps, setCombinedTimestamps] = useState([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [error, setError] = useState('');

  const [mostReplayedData, setMostReplayedData] = useState(null);
  const [isFetchingMostReplayed, setIsFetchingMostReplayed] = useState(false);
  const [mostReplayedError, setMostReplayedError] = useState('');

  const pollingIntervalRef = useRef(null);

  const extractVideoIdFromUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const processAudioAnalysis = async (urlForAnalysis) => {
    console.log('[DEBUG] processAudioAnalysis: Triggered for URL:', urlForAnalysis);
    if (!urlForAnalysis) {
      setError('Cannot start audio analysis: No video URL for analysis.');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setProgressMessage('Initiating analysis... This may take a moment.');
    setAudioTimestamps([]);
    setAnalysisProgress('Requesting analysis from server...');
    stopPolling(); // Stop any previous polling

    const pollAnalysisStatus = (key) => {
      pollingIntervalRef.current = setInterval(async () => {
        try {
          console.log(`[pollAnalysisStatus] Polling with key: '${key}', type: ${typeof key}`);
          const statusResponse = await fetch(`/api/analysis-status?key=${encodeURIComponent(key)}`);
          if (!statusResponse.ok) {
            throw new Error(`Server error while polling: ${statusResponse.status}`);
          }
          const data = await statusResponse.json();

          if (data.status === 'success') {
            stopPolling();
            const formattedHighlights = (data.audio_highlights || []).map(h => parseFloat(h));
            setAudioTimestamps(formattedHighlights);
            setIsAnalyzing(false);
            setAnalysisProgress('');
          } else if (data.status === 'error') {
            stopPolling();
            setError(data.message || 'Analysis failed on the backend.');
            setIsAnalyzing(false);
            setAnalysisProgress('');
          } else if (data.status === 'processing') {
            setAnalysisProgress(data.message || 'Processing...');
          } else {
            console.warn('Received unknown status during polling:', data);
          }
        } catch (e) {
          stopPolling();
          setError(`Connection to server lost or failed during analysis: ${e.message}`);
          setIsAnalyzing(false);
          setAnalysisProgress('');
        }
      }, 2000);
    };

    try {
      const startResponse = await fetch('/api/process-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: urlForAnalysis, force_fresh: true }),
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({ message: 'Failed to parse error JSON.' }));
        throw new Error(errorData.message || `HTTP error! status: ${startResponse.status}`);
      }

      const initialData = await startResponse.json();

      if (initialData.status === 'success') {
        const formattedHighlights = (initialData.audio_highlights || []).map(h => parseFloat(h));
        setAudioTimestamps(formattedHighlights);
        setIsAnalyzing(false);
      } else if (initialData.status === 'processing' && initialData.cache_key) {
        setAnalysisProgress('Task submitted. Waiting for progress updates...');
        pollAnalysisStatus(initialData.cache_key);
      } else {
        throw new Error(initialData.message || 'Unexpected response from server.');
      }
    } catch (e) {
      setError(`Analysis request failed: ${e.message}`);
      setIsAnalyzing(false);
      setAnalysisProgress('');
    }
  };

  const fetchMostReplayedData = async (youtubeUrl) => {
    if (!youtubeUrl) {
      setMostReplayedError("No URL provided for heatmap data.");
      return;
    }
    setIsFetchingMostReplayed(true);
    setMostReplayedError('');
    setMostReplayedData(null);

    try {
      const response = await fetch('/api/get-most-replayed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: youtubeUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Server responded with status: ${response.status}`);
      }

      const data = await response.json();
      if (data.status === 'success') {
        setMostReplayedData(data);
      } else {
        throw new Error(data.message || 'Failed to get most replayed data.');
      }
    } catch (e) {
      setMostReplayedError(e.message);
    } finally {
      setIsFetchingMostReplayed(false);
    }
  };

  const handleVideoSubmit = (submittedUrl) => {
    const newVideoId = extractVideoIdFromUrl(submittedUrl);

    if (newVideoId) {
      setAppVideoId(newVideoId);
      setVideoUrlForContext(submittedUrl);
      
      // Reset all data for the new video
      stopPolling();
      setPriorityCommentTimestamps([]);
      setRegularCommentTimestamps([]);
      setAudioTimestamps([]);
      setCombinedTimestamps([]);
      setError('');
      setMostReplayedError('');
      setMostReplayedData(null);
      setAnalysisProgress('');

      // Start both analyses
      processAudioAnalysis(submittedUrl);
      fetchMostReplayedData(submittedUrl);
    } else {
      setError("Invalid YouTube URL. Please check and try again.");
    }
  };

  const formatStamp = (timeInput, type, color, label = null) => {
    const time = parseFloat(timeInput);
    if (isNaN(time) || time < 0) return null;
    return { time, type, color, label };
  };

  useEffect(() => {
    const formattedPriority = priorityCommentTimestamps.map(t => formatStamp(t, 'priority', '#ff7f0e'));
    const formattedRegular = regularCommentTimestamps.map(t => formatStamp(t, 'comment', '#1f77b4'));
    const formattedAudio = audioTimestamps.map(t => formatStamp(t, 'audio', '#2ca02c'));

    let allTimestamps = [...formattedPriority, ...formattedRegular, ...formattedAudio].filter(stamp => stamp !== null);

    if (mostReplayedData && mostReplayedData.status === 'success' && (mostReplayedData.highest_intensity_marker_data || mostReplayedData.most_replayed_label_marker_data)) {
      const { highest_intensity_marker_data: highestIntensityMarker, most_replayed_label_marker_data: mostReplayedLabelMarker } = mostReplayedData;
      
      if (highestIntensityMarker && highestIntensityMarker.startMillis) {
        const intensitySeconds = parseFloat(highestIntensityMarker.startMillis) / 1000;
        if (!isNaN(intensitySeconds)) {
          allTimestamps.push(formatStamp(intensitySeconds, 'mostReplayed', '#d62728', 'Highest Intensity'));
        }
      }
      
      if (mostReplayedLabelMarker && mostReplayedLabelMarker.startMillis) {
        const labelMarkerSeconds = parseFloat(mostReplayedLabelMarker.startMillis) / 1000;
        const mrLabel = mostReplayedData.data.find(d => d.startMillis === mostReplayedLabelMarker.startMillis);
        if (!isNaN(labelMarkerSeconds)) {
          allTimestamps.push(formatStamp(labelMarkerSeconds, 'mostReplayed', '#800080', mrLabel ? mrLabel.label_text : 'Most Replayed'));
        }
      }
    }

    allTimestamps = allTimestamps.filter(Boolean);

    const priorityOrder = { 'priority': 0, 'mostReplayed': 1, 'comment': 2, 'audio': 3 };
    allTimestamps.sort((a, b) => {
        const timeDiff = a.time - b.time;
        if (Math.abs(timeDiff) < 1) { // Group nearby timestamps
            return priorityOrder[a.type] - priorityOrder[b.type];
        }
        return timeDiff;
    });

    const deduplicated = [];
    if (allTimestamps.length > 0) {
      deduplicated.push(allTimestamps[0]);
      for (let i = 1; i < allTimestamps.length; i++) {
        if (Math.abs(allTimestamps[i].time - deduplicated[deduplicated.length - 1].time) >= 1) {
          deduplicated.push(allTimestamps[i]);
        }
      }
    }

    setCombinedTimestamps(deduplicated);

    // Cleanup polling on component unmount
    return () => stopPolling();
  }, [priorityCommentTimestamps, regularCommentTimestamps, audioTimestamps, mostReplayedData]);

  return (
    <UrlContext.Provider value={videoUrlForContext}>
      <TimestampContext.Provider value={{ currentTimestamp: currentTimestampForContext, setCurrentTimestamp: setCurrentTimestampForContext }}>
        <div>
          <div className="container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
            <VideoInput onVideoSubmit={handleVideoSubmit} />
            
            {isAnalyzing && <p style={{ color: '#007bff', fontWeight: 'bold' }}>Analysis Status: {analysisProgress}</p>}
            {error && <p style={{ color: 'red', whiteSpace: 'pre-wrap', border: '1px solid red', padding: '10px', borderRadius: '4px' }}>Error: {error}</p>}
            
            <div className="main-content" style={{ display: 'flex', flexDirection: 'row', marginTop: '20px', gap: '20px' }}>
              <div className="left-column" style={{ flex: '1 1 400px', minWidth: '300px' }}>
                {appVideoId && (
                  <>
                    <VideoComments
                      videoId={appVideoId}
                      setPriorityTimestamps={setPriorityCommentTimestamps}
                      setRegularTimestamps={setRegularCommentTimestamps}
                    />
                  </>
                )}
              </div>

              <div className="right-column" style={{ flex: '2 1 600px', minWidth: '400px' }}>
                <VideoPlayer
                  timestampSeconds={combinedTimestamps}
                  mostReplayedRawData={mostReplayedData}
                />
              </div>
            </div>
          </div>
        </div>
      </TimestampContext.Provider>
    </UrlContext.Provider>
  );
}

export default App;