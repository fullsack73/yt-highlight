import express from 'express';
import cors from 'cors';
import youtubedl from 'youtube-dl-exec';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Create a directory for temporary video files
const tempDir = join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

app.post('/download', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log('Received URL:', url);

  try {
    // First, get video info
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0']
    });

    console.log('Video info:', info);

    if (!info || !info.id) {
      throw new Error('Failed to get video information');
    }

    const outputPath = join(tempDir, `${info.id}.mp4`);
    
    // Download the video
    await youtubedl(url, {
      output: outputPath,
      format: 'best[height<=720]',
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0']
    });

    console.log('Video downloaded to:', outputPath);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Video file was not created');
    }

    // Send the video file
    res.sendFile(outputPath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: 'Failed to send video file' });
      }
      // Clean up the file after sending
      fs.unlink(outputPath, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    });
  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ error: 'Failed to download video: ' + error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 