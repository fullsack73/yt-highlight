import librosa
import numpy as np

y, sr = librosa.load('audio.wav')
frame_length = 2048
hop_length = 512
energy = np.array([
    sum(abs(y[i:i+frame_length]**2))
    for i in range(0, len(y), hop_length)
])
threshold = np.percentile(energy, 95)  # Top 5% energy
highlight_frames = np.where(energy > threshold)[0]
highlight_times = highlight_frames * hop_length / sr
print(highlight_times)  # Seconds where highlights likely occur
