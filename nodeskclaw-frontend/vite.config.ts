import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:8000'

const projectRoot = path.resolve(__dirname, '..')
const eeAdminDir = path.resolve(projectRoot, 'ee/frontend/admin')
const hasEE = fs.existsSync(eeAdminDir)

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [
      ...(hasEE
        ? [{ find: '@/router/ee-stub', replacement: path.resolve(eeAdminDir, 'routes') }]
        : []),
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
    dedupe: hasEE
      ? ['vue', 'vue-router', 'vue-i18n', 'pinia', 'lucide-vue-next', '@vueuse/core']
      : [],
  },
  server: {
    fs: {
      allow: ['.', ...(hasEE ? [eeAdminDir] : [])],
    },
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/stream': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
