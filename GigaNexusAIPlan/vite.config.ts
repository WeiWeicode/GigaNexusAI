import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 開發模式：vite --host 對區網開放，/api 轉給本機 Node 服務（:5190）
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5190', xfwd: true },
    },
  },
})
