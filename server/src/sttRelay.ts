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
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&smart_format=true&punctuate=true&language=en-US";

export function attachSttRelay(server: Server | HttpsServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/stt-relay" });

  wss.on("connection", (clientWs) => {
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
