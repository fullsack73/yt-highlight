import React, { useState } from "react";
import GetComments from "./GetComments.jsx"
import VideoInput from "./VideoInput.jsx"

function App() {
  const [videoId, setVideoId] = useState("");

  return (
    <div>
      {/* <VideoInput onVideoSubmit={setVideoId} /> */}
      <GetComments videoId={"dQw4w9WgXcQ"} />
    </div>
  );
}

export default App
