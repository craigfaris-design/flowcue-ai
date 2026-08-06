import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { Server as HttpsServer } from "https";

// A dumb byte-forwarding relay between the browser and AssemblyAI's
// real-time streaming API. Exists only so the AssemblyAI API key never
// reaches the client -- it does not parse or understand the audio or
// transcript protocol in either direction; that's the frontend's job (see
// webapp/src/hooks/useAssemblyAIRecognition.ts), same separation of concerns
// as a dumb pipe vs. its consumer.
//
// Switched from Deepgram to AssemblyAI (2026-08) purely on cost -- roughly
// a third of Deepgram's per-minute streaming rate at the time this was
// decided. The one real consequence: AssemblyAI's streaming API does NOT
// accept the webm/opus container MediaRecorder produces (Deepgram
// auto-detected and accepted it) -- it wants raw 16-bit PCM, so the
// frontend's audio capture had to move from MediaRecorder to an
// AudioWorklet doing the Float32->Int16 conversion itself. See
// useAssemblyAIRecognition.ts for that half.
const SAMPLE_RATE = 16000;

// Kept as a fixed set of allowed values (matching webapp/src/lib/types.ts's
// SPEECH_LANGUAGES) rather than passing whatever the client sends straight
// into the outbound AssemblyAI URL -- the client's requested language is
// untrusted input, and this way a bad/unexpected value can't reach
// AssemblyAI's API at all instead of relying on it to reject it safely.
//
// AssemblyAI's `language_codes` param takes bare ISO 639-1 codes (no
// region), unlike Deepgram's BCP-47 tags -- SPEECH_LANGUAGES keeps the
// BCP-47 codes (still needed for the Web Speech API fallback's `lang`),
// so this maps down to the base language for AssemblyAI specifically.
// UNVERIFIED against real usage: nl/hi/ko/ru aren't confirmed supported by
// AssemblyAI's streaming multilingual model (only en/es/de/fr/pt/it are
// documented as supported) -- still routed here rather than silently
// disabled, since a poor/failed AssemblyAI connection already falls back
// to the Web Speech API automatically (see useLiveRecognition.ts), so
// nothing breaks outright if one of these turns out unsupported in
// practice. Revisit once real usage on those four languages is observed.
const SUPPORTED_LANGUAGES: Record<string, string> = {
  "en-US": "en",
  "es-ES": "es",
  "fr-FR": "fr",
  "de-DE": "de",
  "pt-BR": "pt",
  "it-IT": "it",
  "nl-NL": "nl",
  "hi-IN": "hi",
  "ko-KR": "ko",
  "ru-RU": "ru",
};
const DEFAULT_LANGUAGE = "en-US";

function assemblyAiUrl(bcp47Language: string): string {
  // English gets the English-specific model (documented as the fastest
  // real-time option); every other supported language goes through the
  // multilingual model. format_turns mirrors Deepgram's smart_format
  // (punctuation/casing on finalized text); include_partial_turns mirrors
  // Deepgram's interim_results -- the frontend's dedup logic depends on
  // getting both partial and final turns, same as it did with Deepgram.
  const speechModel = bcp47Language === "en-US" ? "universal-streaming-english" : "universal-streaming-multilingual";
  const languageCode = SUPPORTED_LANGUAGES[bcp47Language] ?? SUPPORTED_LANGUAGES[DEFAULT_LANGUAGE];
  const params = new URLSearchParams({
    sample_rate: String(SAMPLE_RATE),
    encoding: "pcm_s16le",
    speech_model: speechModel,
    language_codes: languageCode,
    format_turns: "true",
    include_partial_turns: "true",
  });
  return `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
}

/** Extracts and validates the `language` query param from an incoming relay
 * connection's request URL, falling back to DEFAULT_LANGUAGE for anything
 * missing or not in SUPPORTED_LANGUAGES. Split out from the connection
 * handler so this validation -- the actual security-relevant part of
 * language support -- is unit-testable without standing up a WebSocket. */
export function resolveLanguage(requestUrl: string | undefined): string {
  const requested = new URL(requestUrl ?? "", "http://localhost").searchParams.get("language");
  return requested && requested in SUPPORTED_LANGUAGES ? requested : DEFAULT_LANGUAGE;
}

// Found via code review: with no maxPayload set, the `ws` library's 100MB
// default applied to every relay message -- a single frame from a
// misbehaving or malicious client could be up to 100MB, forwarded straight
// to AssemblyAI. Real audio here is raw 16-bit PCM at 16kHz mono in small
// chunks (see useAssemblyAIRecognition.ts's worklet buffer size), on the
// order of a few KB; 256KB is generous headroom over that with no
// legitimate reason to ever need more.
const MAX_AUDIO_FRAME_BYTES = 256 * 1024;

// Also found via code review: nothing capped how many concurrent relay
// connections a client (or a bug/script) could open, and each one holds
// open a second real connection to AssemblyAI -- unbounded, that's
// unbounded real cost against a single shared API key/quota for this beta.
// A simple global ceiling is enough for now; revisit with per-IP limits if
// this becomes a multi-tenant product.
const MAX_CONCURRENT_RELAY_CONNECTIONS = 20;

export function attachSttRelay(server: Server | HttpsServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/stt-relay", maxPayload: MAX_AUDIO_FRAME_BYTES });
  let activeConnections = 0;

  wss.on("connection", (clientWs, request) => {
    if (activeConnections >= MAX_CONCURRENT_RELAY_CONNECTIONS) {
      clientWs.send(JSON.stringify({ type: "error", message: "Too many active live-cueing sessions right now -- try again shortly." }));
      clientWs.close();
      return;
    }
    activeConnections++;
    clientWs.on("close", () => {
      activeConnections--;
    });

    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", message: "ASSEMBLYAI_API_KEY is not configured on the server." }));
      clientWs.close();
      return;
    }

    const assemblyAiWs = new WebSocket(assemblyAiUrl(resolveLanguage(request.url)), {
      // No "Bearer"/"Token" prefix -- AssemblyAI's streaming API takes the
      // raw API key as the header value.
      headers: { Authorization: apiKey },
    });

    assemblyAiWs.on("open", () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "ready" }));
    });

    assemblyAiWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
    });

    assemblyAiWs.on("error", () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", message: "AssemblyAI connection error." }));
      }
    });

    assemblyAiWs.on("close", () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    clientWs.on("message", (data, isBinary) => {
      if (isBinary && assemblyAiWs.readyState === WebSocket.OPEN) assemblyAiWs.send(data);
    });

    clientWs.on("close", () => {
      if (assemblyAiWs.readyState === WebSocket.OPEN || assemblyAiWs.readyState === WebSocket.CONNECTING) {
        // AssemblyAI expects an explicit Terminate message, not just the
        // socket closing, to end the session cleanly server-side.
        if (assemblyAiWs.readyState === WebSocket.OPEN) {
          assemblyAiWs.send(JSON.stringify({ type: "Terminate" }));
        }
        assemblyAiWs.close();
      }
    });

    clientWs.on("error", () => {
      if (assemblyAiWs.readyState === WebSocket.OPEN || assemblyAiWs.readyState === WebSocket.CONNECTING) {
        assemblyAiWs.close();
      }
    });
  });

  return wss;
}
