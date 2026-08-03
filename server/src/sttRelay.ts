import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { Server as HttpsServer } from "https";

// A dumb byte-forwarding relay between the browser and Deepgram's real-time
// streaming API. Exists only so the Deepgram API key never reaches the
// client -- it does not parse or understand the audio or transcript
// protocol in either direction; that's the frontend's job (see
// webapp/src/hooks/useDeepgramRecognition.ts), same separation of concerns
// as a dumb pipe vs. its consumer.
//
// Deepgram auto-detects the container format (webm/opus, from
// MediaRecorder) as long as no encoding/sample_rate params are set here --
// forcing those would require raw PCM, which is a lot more client-side work
// for no benefit.
// words=true (word-level start/end timestamps) is on by default, but the
// frontend's dedup logic (useDeepgramRecognition.ts) depends on it to avoid
// double-feeding words when consecutive segments overlap -- requesting it
// explicitly rather than relying on the default not changing.
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&smart_format=true&punctuate=true&words=true&language=en-US";

// Found via code review: with no maxPayload set, the `ws` library's 100MB
// default applied to every relay message -- a single frame from a
// misbehaving or malicious client could be up to 100MB, forwarded straight
// to Deepgram. Real audio here is 100ms of opus-encoded speech (see
// useDeepgramRecognition.ts's MediaRecorder timeslice), which is on the
// order of a few KB; 256KB is generous headroom over that with no
// legitimate reason to ever need more.
const MAX_AUDIO_FRAME_BYTES = 256 * 1024;

// Also found via code review: nothing capped how many concurrent relay
// connections a client (or a bug/script) could open, and each one holds
// open a second real connection to Deepgram -- unbounded, that's unbounded
// real cost against a single shared Deepgram key/quota for this beta. A
// simple global ceiling is enough for now; revisit with per-IP limits if
// this becomes a multi-tenant product.
const MAX_CONCURRENT_RELAY_CONNECTIONS = 20;

export function attachSttRelay(server: Server | HttpsServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/stt-relay", maxPayload: MAX_AUDIO_FRAME_BYTES });
  let activeConnections = 0;

  wss.on("connection", (clientWs) => {
    if (activeConnections >= MAX_CONCURRENT_RELAY_CONNECTIONS) {
      clientWs.send(JSON.stringify({ type: "error", message: "Too many active live-cueing sessions right now -- try again shortly." }));
      clientWs.close();
      return;
    }
    activeConnections++;
    clientWs.on("close", () => {
      activeConnections--;
    });

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", message: "DEEPGRAM_API_KEY is not configured on the server." }));
      clientWs.close();
      return;
    }

    const deepgramWs = new WebSocket(DEEPGRAM_URL, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    deepgramWs.on("open", () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "ready" }));
    });

    deepgramWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
    });

    deepgramWs.on("error", () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", message: "Deepgram connection error." }));
      }
    });

    deepgramWs.on("close", () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    clientWs.on("message", (data, isBinary) => {
      if (isBinary && deepgramWs.readyState === WebSocket.OPEN) deepgramWs.send(data);
    });

    clientWs.on("close", () => {
      if (deepgramWs.readyState === WebSocket.OPEN || deepgramWs.readyState === WebSocket.CONNECTING) {
        deepgramWs.close();
      }
    });

    clientWs.on("error", () => {
      if (deepgramWs.readyState === WebSocket.OPEN || deepgramWs.readyState === WebSocket.CONNECTING) {
        deepgramWs.close();
      }
    });
  });

  return wss;
}
