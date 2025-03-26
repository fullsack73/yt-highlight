import { useState, useEffect } from 'react';
import axios from 'axios';
import "./index.css";

const API_KEY = "AIzaSyC3Wb74eaTb_mnKbV5RXZ607SZJI0or5hM";
const timestampRegex = /\b(?:\d+:)?\d{1,2}:\d{2}\b/g;

const VideoComments = ({ videoId }) => {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false); // New loading state

  const fetchComments = async () => {
    setLoading(true); // Start loading
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
              pageToken: nextPageToken, // Use the nextPageToken for pagination
            },
          }
        );

        allComments = allComments.concat(response.data.items); // Append new comments
        nextPageToken = response.data.nextPageToken; // Update the nextPageToken
      } while (nextPageToken); // Continue fetching until there are no more pages

      // Process all comments
      const filteredComments = allComments
        .map((item) => {
          const text = item.snippet.topLevelComment.snippet.textDisplay;
          const timestamps = text.match(timestampRegex) || []; // Find timestamps
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
                  <a
                    key={i}
                    href={`https://www.youtube.com/watch?v=${videoId}&t=${time.replace(":", "m")}s`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="comment-timestamp"
                  >
                    {time}
                  </a>
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