/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    react(),
    // Opt-in via HTTPS=true npm run dev. SpeechRecognition (and getUserMedia
    // generally) requires a secure context -- localhost is exempted from that
    // check even over plain HTTP, but a LAN address like 192.168.x.x is not,
    // so live cueing silently fails there without HTTPS (surfaces as a
    // mic-access "denied" error with no permission prompt ever shown). Left
    // off by default so local/automated testing over localhost keeps running
    // on plain HTTP with no self-signed-certificate warning to click through.
    ...(process.env.HTTPS === 'true' ? [basicSsl()] : []),
  ],
  // host: true binds the dev server to 0.0.0.0, not just localhost, so it's
  // reachable from a phone on the same Wi-Fi network for real-device testing
  // (see DEPLOYMENT.md). This is a local dev server, not a public deploy.
  // Honors PORT so a tool-assigned instance (e.g. an automated preview) can
  // run alongside a manually-started one on the default 5173 without either
  // fighting over the same port.
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
