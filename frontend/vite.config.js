import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/yt-highlight/',
  server: {
    allowedHosts: ['https://fullsack73.github.io/yt-highlight/']
  }
})
