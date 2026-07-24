/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // host: true binds the dev server to 0.0.0.0, not just localhost, so it's
  // reachable from a phone on the same Wi-Fi network for real-device testing
  // (see DEPLOYMENT.md). This is a local dev server, not a public deploy.
  server: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
