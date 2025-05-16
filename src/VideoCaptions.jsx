import { useState, useEffect } from 'react';
import axios from 'axios';

/**
 * VideoCaptions Component
 * Fetches and displays captions (subtitles) for a given YouTube videoId.
 *
 * Props:
 *   - videoId: string (YouTube video ID)
 */
const VideoCaptions = ({ videoId }) => {
  const [captions, setCaptions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!videoId) return;
    setCaptions("");
    setError("");
    setLoading(true);

    // Fetch caption tracks list (not available via public YouTube Data API v3)
    // We'll try to fetch the captions XML directly (if available)
    const fetchCaptions = async () => {
      try {
        // Step 1: Get video info to find caption tracks
        const infoUrl = `https://youtube.com/get_video_info?video_id=${videoId}&el=detailpage`;
        const infoRes = await axios.get(infoUrl);
        const params = new URLSearchParams(infoRes.data);
        const playerResponse = JSON.parse(params.get('player_response'));
        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!captionTracks || captionTracks.length === 0) {
          setError("No captions available for this video.");
          setLoading(false);
          return;
        }

        // Step 2: Fetch the first caption track (usually English or auto-generated)
        const captionUrl = captionTracks[0].baseUrl;
        const captionRes = await axios.get(captionUrl);
        setCaptions(captionRes.data);
      } catch (err) {
        setError("Failed to fetch captions. Captions may not be available or CORS may block the request.");
      } finally {
        setLoading(false);
      }
    };

    fetchCaptions();
  }, [videoId]);

  return (
    <div className="captions-container">
      <h3>Captions</h3>
      {loading && <div className="spinner"></div>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {captions && (
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', background: '#f9f9f9', padding: 10 }}>
          {typeof captions === 'string' ? captions : JSON.stringify(captions, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default VideoCaptions; 