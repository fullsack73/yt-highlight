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
const VideoComments = ({ videoId, setTimestampSeconds, onCommentsLoaded }) => {
  // 상태 관리
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setCurrentTimestamp } = useContext(TimestampContext);
  const [timestampFrequency, setTimestampFrequency] = useState({});
  const [priorityComments, setPriorityComments] = useState([]);
  const [otherComments, setOtherComments] = useState([]);

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
      // Send timestamps to parent component
      setTimestampSeconds && setTimestampSeconds(uniqueSeconds);
      
      // Notify parent that comments are loaded
      onCommentsLoaded && onCommentsLoaded(videoId);

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
      setTimestampFrequency(prev => ({ ...groupCounts, _groupLeaders: groupLeaders }));

      // Build priority and other comments
      // Map: leader timestamp (seconds) -> { comment, timestamp }
      const leaderToPriority = {};
      // Set to track which comment/timestamp pairs are used as priority
      const usedCommentTimestamp = new Set();
      filteredComments.forEach((comment, commentIdx) => {
        comment.timestamps.forEach((time) => {
          const sec = timestampToSeconds(time);
          const leader = groupLeaders[sec] !== undefined ? groupLeaders[sec] : sec;
          // Only consider as priority if this is the leader and group is frequent
          if (sec === leader && groupCounts[leader] > 1 && !leaderToPriority[leader]) {
            leaderToPriority[leader] = { comment, time, commentIdx };
            usedCommentTimestamp.add(`${commentIdx}_${time}`);
          }
        });
      });
      // Priority comments: one per group leader
      const priorityList = Object.values(leaderToPriority);
      priorityList.sort((a, b) => b.comment.likeCount - a.comment.likeCount);
      setPriorityComments(priorityList);
      // Other comments: all timestamps/comments not used as priority
      const otherList = [];
      filteredComments.forEach((comment, commentIdx) => {
        comment.timestamps.forEach((time) => {
          if (!usedCommentTimestamp.has(`${commentIdx}_${time}`)) {
            otherList.push({ comment, time, commentIdx });
          }
        });
      });
      otherList.sort((a, b) => b.comment.likeCount - a.comment.likeCount);
      setOtherComments(otherList);

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
      // Reset states
      setPriorityComments([]);
      setOtherComments([]);
      setTimestampFrequency({});
      setError("");
      
      // Fetch comments
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
      {(priorityComments.length > 0 || otherComments.length > 0) && (
        <div className="comments-container">
          {/* Priority comments section */}
          {priorityComments.length > 0 && (
            <>
              <h3>Priority Highlights</h3>
              <ul>
                {priorityComments.map(({ comment, time, commentIdx }, idx) => (
                  <li key={`priority-${commentIdx}-${time}`} className="comment-item" style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#fffbe6', borderLeft: '4px solid #d47b06' }}>
                    <span style={{ minWidth: 60, color: '#d47b06', fontWeight: 'bold' }}>👍 {comment.likeCount}</span>
                    <button
                      onClick={() => handleTimestampClick(time)}
                      className="comment-timestamp"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#d47b06',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: '0 5px',
                        fontWeight: 'bold',
                        fontSize: '1rem',
                      }}
                    >
                      {time} <span title="Popular timestamp">★</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Other comments section */}
          {otherComments.length > 0 && (
            <>
              <h3>Other Timestamps</h3>
              <ul>
                {otherComments.map(({ comment, time, commentIdx }, idx) => (
                  <li key={`other-${commentIdx}-${time}`} className="comment-item" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ minWidth: 60, color: '#888', fontWeight: 'bold' }}>👍 {comment.likeCount}</span>
                    <button
                      onClick={() => handleTimestampClick(time)}
                      className="comment-timestamp"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#065fd4',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: '0 5px',
                        fontWeight: 'normal',
                        fontSize: '1rem',
                      }}
                    >
                      {time}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoComments;
