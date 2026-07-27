import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 개발 전용 — vite(5173)가 앱을, /api는 Express(4000)로 프록시.
  // 운영에서는 Express가 dist/까지 서빙하므로 이 프록시는 안 쓰인다.
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
