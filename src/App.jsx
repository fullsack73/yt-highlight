import React, { useState } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";

function App() {
  const [videoId, setVideoId] = useState("");

  return (
    <div>
      <VideoInput onVideoSubmit={setVideoId}>
        <div className="main-content">
          <div className="left-column">
            {videoId && <VideoComments videoId={videoId} />}
          </div>
          <div className="right-column">
            {videoId && <VideoPlayer />}
          </div>
        </div>
      </VideoInput>
    </div>
  );
}

export default App
