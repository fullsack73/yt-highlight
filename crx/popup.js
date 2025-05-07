document.getElementById('getUrlBtn').addEventListener('click', async () => {
    // 현재 탭의 URL 가져오기
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
    if (tab && tab.url.includes("youtube.com/watch")) {
      const videoUrl = tab.url;
  
      // 새 탭 열고 URL 전달
      chrome.tabs.create({
        url: chrome.runtime.getURL("display.html") + "?videoUrl=" + encodeURIComponent(videoUrl)
      });
    } else {
      alert("YouTube 영상 페이지가 아닙니다.");
    }
  });
  
