import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { TimestampContext } from "./VideoInput.jsx";
import "./index.css";

const API_KEY = "AIzaSyC3Wb74eaTb_mnKbV5RXZ607SZJI0or5hM";
const timestampRegex = /\b(?:\d+:)?\d{1,2}:\d{2}\b/g;

const VideoComments = ({ videoId }) => {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setCurrentTimestamp } = useContext(TimestampContext);

  const fetchComments = async () => {
    setLoading(true);
    let allComments = [];
    let nextPageToken = null;

    try {
      do {
        const response = await axios.get(
          `https://www.googleapis.com/youtube/v3/commentThreads`,
          {
            params: {
              key: API_KEY,
              videoId: videoId,
              part: "snippet",
              maxResults: 100,
              order: "relevance",
              pageToken: nextPageToken,
            },
          }
        );

        allComments = allComments.concat(response.data.items);
        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      const filteredComments = allComments
        .map((item) => {
          const text = item.snippet.topLevelComment.snippet.textDisplay;
          const timestamps = text.match(timestampRegex) || [];
          const likeCount = item.snippet.topLevelComment.snippet.likeCount || 0;
          return {
            text,
            likeCount,
            timestamps,
          };
        })
        .filter((comment) => comment.timestamps.length > 0 && comment.likeCount > 20);

      setComments(filteredComments);

    } catch (err) {
      console.error("Error fetching comments:", err);
      setError("Failed to fetch comments. Check your API key.");
    } finally {
      setLoading(false);
    }
  };

  const handleTimestampClick = (timestamp) => {
    setCurrentTimestamp(timestamp);
  };

  return (
    <div>
      <button className="load-comments-button" onClick={fetchComments} disabled={loading}>
        {loading ? "Loading..." : "Load Comments"}
      </button>

      {loading && <div className="spinner"></div>}

      {error && <p style={{ color: "red" }}>{error}</p>}

      {comments.length > 0 && (
        <div className="comments-container">
          <h3>Comments with Timestamps:</h3>
          <ul>
            {comments.map((comment, index) => (
              <li key={index} className="comment-item">
                <p>{comment.text}</p>
                <p><strong>Likes:</strong> {comment.likeCount}</p>
                <strong>Timestamps:</strong>{" "}
                {comment.timestamps.map((time, i) => (
                  <button
                    key={i}
                    onClick={() => handleTimestampClick(time)}
                    className="comment-timestamp"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#065fd4',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      padding: '0 5px'
                    }}
                  >
                    {time}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default VideoComments;