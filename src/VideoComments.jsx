import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { TimestampContext } from "./VideoInput.jsx";
import "./index.css";

// YouTube API 키
const API_KEY = "AIzaSyC3Wb74eaTb_mnKbV5RXZ607SZJI0or5hM";
// 타임스탬프 형식을 찾기 위한 정규식 (MM:SS 또는 HH:MM:SS)
const timestampRegex = /\b(?:\d+:)?\d{1,2}:\d{2}\b/g;

/**
 * YouTube 댓글 컴포넌트
 * - 비디오의 댓글을 가져와서 표시
 * - 타임스탬프가 포함된 댓글 필터링
 * - 타임스탬프 클릭 시 비디오 재생 위치 변경
 */
const VideoComments = ({ videoId, setTimestampSeconds }) => {
  // 상태 관리
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setCurrentTimestamp } = useContext(TimestampContext);
  const [timestampFrequency, setTimestampFrequency] = useState({});

  // Helper: Convert timestamp string to seconds
  const timestampToSeconds = (timestamp) => {
    const parts = timestamp.split(":").map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  /**
   * YouTube API를 사용하여 댓글 가져오기
   * - 페이지네이션 처리
   * - 타임스탬프가 포함된 댓글만 필터링
   * - 좋아요 수가 20개 이상인 댓글만 표시
   */
  const fetchComments = async () => {
    setLoading(true);
    let allComments = [];
    let nextPageToken = null;

    try {
      // 모든 페이지의 댓글을 가져올 때까지 반복
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

      // 댓글 필터링 및 가공
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

      // Collect all unique timestamps in seconds
      const allTimestamps = filteredComments.flatMap(c => c.timestamps);
      const allTimestampsInSeconds = allTimestamps.map(timestampToSeconds);
      const uniqueSeconds = Array.from(new Set(allTimestampsInSeconds)).sort((a, b) => a - b);
      setTimestampSeconds && setTimestampSeconds(uniqueSeconds);

      // Build frequency map for timestamps (in seconds), grouping within ±20 seconds
      const freq = {};
      const sortedSeconds = [...allTimestampsInSeconds].sort((a, b) => a - b);
      // Map each timestamp to its group leader (earliest in its ±20s group)
      const groupLeaders = {};
      for (let i = 0; i < sortedSeconds.length; i++) {
        const sec = sortedSeconds[i];
        // Find the earliest timestamp within ±20s
        let leader = sec;
        for (let j = 0; j < sortedSeconds.length; j++) {
          if (Math.abs(sortedSeconds[j] - sec) <= 20 && sortedSeconds[j] < leader) {
            leader = sortedSeconds[j];
          }
        }
        groupLeaders[sec] = leader;
      }
      // Count group sizes
      const groupCounts = {};
      Object.values(groupLeaders).forEach(leader => {
        groupCounts[leader] = (groupCounts[leader] || 0) + 1;
      });
      setTimestampFrequency(groupCounts);
      // Also pass groupLeaders for rendering
      setTimestampFrequency(prev => ({ ...groupCounts, _groupLeaders: groupLeaders }));

    } catch (err) {
      console.error("Error fetching comments:", err);
      setError("Failed to fetch comments. Check your API key.");
      setTimestampSeconds && setTimestampSeconds([]);
      setTimestampFrequency({});
    } finally {
      setLoading(false);
    }
  };

  /**
   * 타임스탬프 클릭 처리
   * - 선택된 타임스탬프를 Context에 저장
   * - VideoPlayer 컴포넌트에서 해당 시점으로 이동
   */
  const handleTimestampClick = (timestamp) => {
    setCurrentTimestamp(timestamp);
  };

  // Automatically fetch comments when videoId changes
  useEffect(() => {
    if (videoId) {
      fetchComments();
    }
    // eslint-disable-next-line
  }, [videoId]);

  return (
    <div>
      {/* 댓글 로드 버튼 제거됨 - 자동 로드 */}
      {/* {loading && <div className="spinner"></div>} */}
      {loading && <div className="spinner"></div>}

      {/* 에러 메시지 */}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {/* 댓글 목록 */}
      {comments.length > 0 && (
        <div className="comments-container">
          <h3>Comments with Timestamps:</h3>
          <ul>
            {comments.map((comment, index) => (
              <li key={index} className="comment-item" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {/* Likes */}
                <span style={{ minWidth: 60, color: '#888', fontWeight: 'bold' }}>👍 {comment.likeCount}</span>
                {/* Timestamps */}
                <span>
                  {comment.timestamps.map((time, i) => {
                    const sec = timestampToSeconds(time);
                    const groupLeaders = timestampFrequency._groupLeaders || {};
                    const leader = groupLeaders[sec] !== undefined ? groupLeaders[sec] : sec;
                    const isEarliest = sec === leader;
                    const isFrequent = timestampFrequency[leader] > 1;
                    const isPrioritized = isEarliest && isFrequent;
                    return (
                      <button
                        key={i}
                        onClick={() => handleTimestampClick(time)}
                        className="comment-timestamp"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: isPrioritized ? '#d47b06' : '#065fd4',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          padding: '0 5px',
                          fontWeight: isPrioritized ? 'bold' : 'normal',
                          fontSize: '1rem',
                        }}
                      >
                        {time} {isPrioritized && <span title="Popular timestamp">★</span>}
                      </button>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default VideoComments;