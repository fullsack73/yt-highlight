import { useState, useEffect } from 'react';
import axios from 'axios';

const API_KEY = "AIzaSyC3Wb74eaTb_mnKbV5RXZ607SZJI0or5hM";

const GetComments = ({ videoId }) => {
  const [comments, setComments] = useState([]);

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
            order: "relevance", // You can also use "time"
          },
        }
      );

      const filteredComments = response.data.items
        .map((item) => ({
          text: item.snippet.topLevelComment.snippet.textDisplay,
          likeCount: item.snippet.topLevelComment.snippet.likeCount,
          timestamp: item.snippet.topLevelComment.snippet.publishedAt,
        }))
        .filter((comment) => comment.likeCount >= 5) // Filter based on likes
        .sort((a, b) => b.likeCount - a.likeCount); // Sort by likes in descending order

      setComments(filteredComments);
    } catch (error) {
      console.error("Error fetching comments", error);
    }
  };

  return (
    <div>
      <h2>YouTube Comments</h2>
      <button onClick={fetchComments}>Load Comments</button>
      <ul>
        {comments.map((comment, index) => (
          <li key={index}>
            <strong>{comment.likeCount} Likes:</strong> {comment.text} <br />
            <small>{new Date(comment.timestamp).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default GetComments;