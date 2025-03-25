import React, { useState } from "react";
import VideoComments from "./VideoComments.jsx";
import VideoInput from "./VideoInput.jsx";

function App() {
  const [videoId, setVideoId] = useState("");

  return (
    <div>
      <VideoInput onVideoSubmit={setVideoId} />
      {videoId && <VideoComments videoId={videoId} />}
    </div>
  );
}

export default App
