import React, { useState } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";
import VideoPlayer from "./VideoPlayer.jsx";

function App() {
  const [videoId, setVideoId] = useState("");

  return (
    <div>
      <VideoInput onVideoSubmit={setVideoId}>
        {videoId && <VideoComments videoId={videoId} />}
        {videoId && <VideoPlayer />}
      </VideoInput>
    </div>
  );
}

export default App
