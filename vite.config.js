import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app under /<repo-name>/. Override with VITE_BASE if
// the repo is named differently or the app moves to Cloudflare Pages ('/').
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/acs-sales-app/',
  build: { chunkSizeWarningLimit: 1500 },
})
