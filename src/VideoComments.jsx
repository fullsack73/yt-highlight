import { useState, useEffect } from 'react';
import axios from 'axios';
import "./index.css";

const API_KEY = "AIzaSyC3Wb74eaTb_mnKbV5RXZ607SZJI0or5hM";
const timestampRegex = /\b(?:\d+:)?\d{1,2}:\d{2}\b/g;

const VideoComments = ({ videoId }) => {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");

  const fetchComments = async () => {
    try {
      const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/commentThreads`,
        {
          params: {
            key: API_KEY,
            videoId: videoId,
            part: "snippet",
            maxResults: 50,
            order: "relevance",
          },
        }
      );


      const filteredComments = response.data.items
        .map((item) => {
          const text = item.snippet.topLevelComment.snippet.textDisplay;
          const timestamps = text.match(timestampRegex) || []; // Find timestamps
          return {
            text,
            likeCount: item.snippet.topLevelComment.snippet.likeCount,
            timestamps,
          };
        })
        .filter((comment) => comment.timestamps.length > 0);

      setComments(filteredComments);
    } catch (err) {
      console.error("Error fetching comments:", err);
      setError("Failed to fetch comments. Check your API key.");
    }
  };

  return (
    <div>
      <button className="load-comments-button" onClick={fetchComments}>
        Load Comments
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {comments.length > 0 && (
        <div className="comments-container">
          <h3>Comments with Timestamps:</h3>
          <ul>
            {comments.map((comment, index) => (
              <li key={index} className="comment-item">
                <p>{comment.text}</p>
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