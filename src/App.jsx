import React, { useState } from "react";
import VideoComments from "./VideoComments.jsx"
import VideoInput from "./VideoInput.jsx"

function App() {
  const [videoId, setVideoId] = useState("");

  return (
    <div>
      {/* <VideoInput onVideoSubmit={setVideoId} /> */}
      <VideoComments videoId={"dQw4w9WgXcQ"} />
    </div>
  );
}

export default App
