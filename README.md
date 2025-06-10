# YouTube Highlight Finder

This web application automatically identifies and showcases the most replayed moments in any YouTube video. Users can simply paste a YouTube URL to quickly see the highlights, making it easy to jump to the most interesting parts of a video.

**Live Demo:** [http://yt-hl-env-dev.eba-metdnuyc.ap-northeast-2.elasticbeanstalk.com/](http://yt-hl-env-dev.eba-metdnuyc.ap-northeast-2.elasticbeanstalk.com/)

## Features

- **Automatic Highlight Detection:** Analyzes video audio to find moments of high energy and excitement.
- **YouTube Heatmap Integration:** Fetches and displays YouTube's own "most replayed" data for a more accurate view of popular moments.
- **Interactive Timeline:** Clickable timestamps allow users to jump directly to highlights in the video.
- **Responsive Design:** A clean and modern interface built with React that works on both desktop and mobile devices.
- **Background Processing:** Heavy analysis tasks are run in the background to keep the UI responsive.

## How It Works

1.  **URL Input:** The user pastes a YouTube video URL into the input field on the React frontend.
2.  **Backend Request:** The frontend sends the URL to the Flask backend API.
3.  **Audio Download:** The backend uses `yt-dlp` to download the audio stream of the video.
4.  **Audio Analysis:** The audio is analyzed using the `librosa` library to calculate sound energy and identify peaks, which correspond to potential highlights.
5.  **Heatmap Data:** The server also fetches the "most replayed" heatmap data directly from YouTube's internal APIs.
6.  **Results:** The identified timestamps and heatmap data are sent back to the frontend and displayed on an interactive timeline.

## Tech Stack

-   **Frontend:**
    -   React
    -   Vite
    -   JavaScript (ES6+)
-   **Backend:**
    -   Python 3
    -   Flask (as the web framework)
    -   Gunicorn (as the WSGI server)
    -   `yt-dlp` (for downloading YouTube audio)
    -   `librosa` & `numpy` (for audio analysis)
-   **Deployment:**
    -   AWS Elastic Beanstalk
    -   `ffmpeg` (installed via `.ebextensions` for audio processing)

## Project Structure

```
/
├── frontend/         # React source code
├── dist/             # Compiled React frontend, served by Flask
├── application.py    # Main Flask backend logic
├── requirements.txt  # Python dependencies
├── Procfile          # Specifies the command to run the app on Elastic Beanstalk
└── .ebextensions/    # Elastic Beanstalk configuration files (e.g., for installing ffmpeg)
```
