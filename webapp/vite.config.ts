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
    // Proxies the STT relay through this same dev server instead of the
    // browser connecting to the backend's own port directly. Found the hard
    // way testing over LAN/HTTPS on a phone: the webapp and the backend each
    // carry their OWN separate self-signed cert in dev, and a phone browser
    // only trusts whichever origin's cert warning it clicked through --
    // trusting the webapp's doesn't trust the backend's. Worse, an untrusted
    // cert doesn't show an interactive prompt for a WebSocket connection the
    // way it does for a page load -- it just fails silently -- which is what
    // made Deepgram look "unreachable" from a phone and fall back to the
    // browser's own noisy speech recognizer. Proxying means the phone only
    // ever talks to ONE already-trusted origin; this dev server forwards the
    // WebSocket to the backend over plain, unencrypted localhost traffic,
    // which needs no certificate since it never leaves this machine.
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.STT_RELAY_PORT || 4000}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
