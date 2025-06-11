// frontend/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Output directory relative to the 'root' of the Vite project (which is 'frontend/')
    // So, this will build to 'frontend/dist/' relative to your main project root.
    outDir: 'dist',
  }
})