document.getElementById('getUrlBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url.includes("youtube.com/watch")) {
    const videoUrl = tab.url;
    const targetUrl = "http://localhost:5173/yt-highlight/?videoUrl=" + encodeURIComponent(videoUrl);
    chrome.tabs.create({ url: targetUrl });
  } else {
    alert("YouTube 영상 페이지가 아닙니다.");
  }
});
