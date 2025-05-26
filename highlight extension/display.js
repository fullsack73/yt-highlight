const params = new URLSearchParams(window.location.search);
const videoUrl = params.get("videoUrl");

if (videoUrl) {
  console.log("Received URL:", videoUrl);
  document.getElementById("urlBox").textContent = videoUrl;
} else {
  document.getElementById("urlBox").textContent = "URL이 전달되지 않았습니다.";
}
