import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'browser-profile-worker': resolve('src/main/browser/browser-profile-worker.ts'),
          'browser-test-worker': resolve('src/main/browser/browser-test-worker.ts'),
          'posting-worker': resolve('src/main/browser/posting-worker.ts'),
          'email-browser-worker': resolve('src/main/email/email-browser-worker.ts'),
          'email-proxy-test-worker': resolve('src/main/email/email-proxy-test-worker.ts')
        }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
