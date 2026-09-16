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
          'scenario-action-worker': resolve('src/main/browser/scenario-action-worker.ts'),
          'scanner-group-worker': resolve('src/main/browser/scanner-group-worker.ts'),
          'scanner-page-worker': resolve('src/main/browser/scanner-page-worker.ts'),
          'scanner-user-worker': resolve('src/main/browser/scanner-user-worker.ts'),
          'scanner-group-members-worker': resolve('src/main/browser/scanner-group-members-worker.ts'),
          'change-info-audit-worker': resolve('src/main/browser/change-info-audit-worker.ts'),
          'email-browser-worker': resolve('src/main/email/email-browser-worker.ts'),
          'primary-mailbox-browser-worker': resolve('src/main/email/primary-mailbox-browser-worker.ts'),
          'email-oauth-worker': resolve('src/main/email/email-oauth-worker.ts'),
          'email-proxy-test-worker': resolve('src/main/email/email-proxy-test-worker.ts'),
          'zalo-browser-worker': resolve('src/main/zalo/zalo-browser-worker.ts')
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
