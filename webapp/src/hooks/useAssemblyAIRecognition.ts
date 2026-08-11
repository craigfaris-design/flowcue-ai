import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Streams microphone audio to FlowCue AI's own backend relay
 * (server/src/sttRelay.ts), which forwards it to AssemblyAI's real-time
 * streaming API and relays transcripts back -- the API key never reaches
 * the browser. Exposes the same { listening, supported, error, start, stop }
 * shape as useSpeechRecognition so callers can swap between them (see
 * useLiveRecognition.ts, which does exactly that with automatic fallback).
 *
 * Formerly useDeepgramRecognition.ts / Deepgram -- switched to AssemblyAI
 * (2026-08) for cost (roughly a third of Deepgram's per-minute streaming
 * rate). The one real architectural consequence: AssemblyAI's streaming API
 * wants raw 16-bit PCM, not the webm/opus container MediaRecorder produces
 * (which Deepgram auto-detected and accepted) -- so audio capture here goes
 * through an AudioWorklet (public/pcm-worklet.js) doing the Float32->Int16
 * conversion on the audio thread, instead of MediaRecorder.
 */

interface AssemblyAiWord {
  text: string;
  confidence?: number;
  word_is_final?: boolean;
}
interface AssemblyAiTurnMessage {
  type?: string;
  message?: string;
  turn_order?: number;
  end_of_turn?: boolean;
  transcript?: string;
  words?: AssemblyAiWord[];
}

// Below this, a word is more likely to be a garbled guess than a real
// transcription -- same rationale and threshold as the Deepgram integration
// this replaced (see git history), carried over rather than re-derived
// since nothing about the underlying speech makes a different floor
// obviously more correct.
const CONFIDENCE_FLOOR = 0.3;

// Matches server/src/sttRelay.ts's SAMPLE_RATE -- must agree, since the
// relay tells AssemblyAI what rate to expect and doesn't itself touch the
// audio bytes to verify.
const SAMPLE_RATE = 16000;

export interface UseAssemblyAIRecognitionOptions {
  onWords: (words: string[]) => void;
  /** Overrides the relay URL computed from the current page's origin. */
  relayUrl?: string;
  /** BCP-47 tag (see lib/types.ts's SPEECH_LANGUAGES) -- forwarded to the
   * relay as a query param, which threads it into the actual AssemblyAI
   * connection (see server/src/sttRelay.ts). Defaults to English
   * server-side if omitted. */
  language?: string;
}

function defaultRelayUrl(): string {
  // Production deploys typically put the webapp and backend on different
  // hosts (e.g. Netlify + Render) rather than different ports on the same
  // host, so same-hostname:port doesn't reach the relay -- VITE_STT_RELAY_URL
  // lets a full ws(s)://host[:port] be set instead. VITE_STT_RELAY_PORT stays
  // for the same-host case (local dev, or a reverse proxy on one domain).
  const explicitUrl = import.meta.env.VITE_STT_RELAY_URL as string | undefined;
  if (explicitUrl) return `${explicitUrl.replace(/\/$/, "")}/api/stt-relay`;

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const explicitPort = import.meta.env.VITE_STT_RELAY_PORT as string | undefined;

  // Dev-mode HTTPS (LAN/phone testing) goes through this same origin's own
  // dev-server proxy (see vite.config.ts's server.proxy) instead of a
  // separate port directly. A direct cross-port wss:// connection there hits
  // the backend's own separate self-signed cert, which a phone browser never
  // gets an interactive chance to trust the way it does the page load itself
  // -- it just fails silently, the relay looks "unreachable," and the app
  // falls back to the browser's built-in recognizer (audibly noisy on
  // Android every time it restarts). Plain HTTP dev (desktop, localhost) is
  // unaffected by any of this and keeps hitting the backend's port directly,
  // same as always.
  if (import.meta.env.DEV && scheme === "wss:" && !explicitPort) {
    return `${scheme}//${window.location.host}/api/stt-relay`;
  }

  const port = explicitPort || "4000";
  return `${scheme}//${window.location.hostname}:${port}/api/stt-relay`;
}

// The relay URL is our own backend, not AssemblyAI directly -- this just
// threads the chosen language through as a query param for sttRelay.ts to
// read and forward into its own AssemblyAI connection.
function withLanguage(url: string, language: string | undefined): string {
  if (!language) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}language=${encodeURIComponent(language)}`;
}

export function useAssemblyAIRecognition({ onWords, relayUrl, language }: UseAssemblyAIRecognitionOptions) {
  const [listening, setListening] = useState(false);
  // True only once AssemblyAI's own upstream session has actually opened
  // (the relay's "ready" message) -- distinct from `listening`, which flips
  // true as soon as mic capture starts, before the relay/AssemblyAI
  // handshake finishes. That gap is a few hundred ms normally but can be
  // much longer on a cold Render instance -- reported directly as a real
  // problem for a nervous presenter in front of a crowd who starts talking
  // the instant they see "Listening" with no way to tell whether anything
  // is actually being heard yet. Nothing spoken is lost either way (see
  // pendingChunks below), but the presenter has no way to *know* that
  // without this signal.
  const [ready, setReady] = useState(false);
  // Availability doesn't change at runtime, so this doesn't need to be
  // state -- just computed once per hook call. AudioWorklet is the real
  // gate here (Safari < 14.1 and a handful of older browsers lack it);
  // getUserMedia is the other hard requirement.
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined";
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const listeningRef = useRef(false);
  const onWordsRef = useRef(onWords);
  onWordsRef.current = onWords;

  // Bumped at the start of every start()/stop() call -- see
  // useDeepgramRecognition.ts's history for why (the original "zombie
  // restart" and double-start bugs this guards against apply identically
  // here, since the getUserMedia/setup sequence has the same async shape).
  const startTokenRef = useRef(0);

  const cleanup = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // Resource leak guard -- same rationale as the Deepgram integration this
  // replaced: nothing released the mic stream/audio graph/socket when the
  // component using this hook unmounted mid-session.
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (!supported) return;
    setError(null);
    setReady(false);
    const myToken = ++startTokenRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (startTokenRef.current === myToken) {
        setError("Microphone access was denied. Live cueing is stopped -- allow mic access and press Start again.");
      }
      return;
    }

    if (startTokenRef.current !== myToken) {
      // Superseded by a stop() or another start() while the permission
      // prompt was pending -- this stream was never wanted, release it
      // immediately rather than leaving it open with no reference left to
      // close it.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    // Set as soon as we're committed to this session (mic secured), not
    // after the audio worklet finishes loading below -- that setup is
    // normally near-instant, but the Connecting banner (gated on
    // `listening && !ready`) should start counting from the true beginning
    // of the wait, not from whenever local setup happens to finish.
    listeningRef.current = true;
    setListening(true);

    const die = (message: string) => {
      if (!listeningRef.current) return;
      setError(message);
      listeningRef.current = false;
      setListening(false);
      setReady(false);
      cleanup();
    };

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => die("The microphone disconnected -- press Start again to resume live cueing.");
    });

    // Capture starts the instant mic access is granted -- not once the
    // relay/AssemblyAI handshake finishes, same reasoning as the Deepgram
    // integration: waiting for "ready" first would drop anything said
    // during that round-trip.
    let relayReady = false;
    const pendingChunks: ArrayBuffer[] = [];

    // Opened immediately, in parallel with the audio worklet setup below --
    // this connection (through our relay, on to AssemblyAI) is normally by
    // far the slower of the two (a real network round-trip vs. a
    // same-origin, service-worker-cached module fetch+compile), especially
    // if the relay's backend had spun down from inactivity. Starting it
    // this early, instead of only after the worklet was ready, directly
    // shortens the "Connecting" gap reported as too long in production --
    // nothing about audio capture depends on this existing yet, captured
    // chunks queue in pendingChunks regardless (see workletNode.port.onmessage
    // below) until both this is OPEN and AssemblyAI's own session has begun.
    const ws = new WebSocket(withLanguage(relayUrl ?? defaultRelayUrl(), language));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // AssemblyAI's Turn messages carry the growing transcript for the
    // current speech segment (turn_order), finalizing when end_of_turn is
    // true -- structurally the same "grows, then confirms" shape as the Web
    // Speech API's interim/final results (see useSpeechRecognition.ts),
    // unlike Deepgram's independent-overlapping-segments-by-timestamp
    // model. Tracking emitted-word-count per turn_order and only emitting
    // the delta reuses that same proven pattern rather than inventing a
    // third dedup strategy.
    //
    // Deliberately never deleted: with format_turns enabled (see
    // sttRelay.ts), AssemblyAI sends a *second* Turn message for the same
    // turn_order after the unformatted end_of_turn=true one -- a
    // turn_is_formatted replay of the same words, punctuated/cased.
    // Deleting the entry on end_of_turn (as this used to) made that replay
    // look like a brand-new turn starting from zero, so every word of the
    // paragraph just spoken got emitted a second time right as the speaker
    // paused -- exactly the paragraph-boundary desync reported in
    // production. turn_order only ever increases and is never reused, so
    // keeping old entries around costs nothing and can't cause stale
    // matches.
    const emittedByTurn = new Map<number, number>();

    ws.onmessage = (event) => {
      let msg: AssemblyAiTurnMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "error") {
        setError(msg.message ?? "Speech recognition service error.");
        listeningRef.current = false;
        setListening(false);
        setReady(false);
        cleanup();
        return;
      }

      if (msg.type === "ready") {
        relayReady = true;
        for (const buf of pendingChunks) {
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        }
        pendingChunks.length = 0;
        return;
      }

      // "ready" (above) only confirms *our own relay's* pipe to AssemblyAI
      // opened -- not that AssemblyAI's transcription session has actually
      // begun server-side. "Begin" is AssemblyAI's own confirmation of
      // that (confirmed via a direct connection test: Begin consistently
      // arrives a beat after the socket opens, before any real Turn data).
      // Audio is still safe to send as soon as "ready" fires (AssemblyAI
      // buffers it), but telling the *presenter* it's safe to start
      // talking on the earlier signal was reported directly as premature
      // -- the Ready confirmation would show, and there'd still be a
      // further wait before speech actually started registering.
      if (msg.type === "Begin") {
        setReady(true);
        return;
      }

      if (msg.type !== "Turn" || msg.turn_order === undefined || !msg.words) return;

      const alreadyEmitted = emittedByTurn.get(msg.turn_order) ?? 0;
      const newWords = msg.words.slice(alreadyEmitted);
      if (newWords.length) {
        const trusted = newWords.filter((w) => w.confidence === undefined || w.confidence >= CONFIDENCE_FLOOR);
        if (trusted.length) onWordsRef.current(trusted.map((w) => w.text));
        emittedByTurn.set(msg.turn_order, msg.words.length);
      }
    };

    ws.onerror = () => {
      setError("Could not reach the speech recognition relay.");
      listeningRef.current = false;
      setListening(false);
      setReady(false);
      cleanup();
    };

    ws.onclose = () => {
      if (listeningRef.current) {
        setError("Lost connection to the speech recognition relay -- press Start again to resume live cueing.");
        listeningRef.current = false;
        setListening(false);
        setReady(false);
      }
    };

    // Runs concurrently with the WebSocket connecting above, not after it
    // -- see that block's comment. A same-origin, service-worker-cached
    // module fetch+compile is normally fast regardless, but there's no
    // reason to make it a sequential dependency of the network round-trip.
    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioContextRef.current = audioContext;
    try {
      await audioContext.audioWorklet.addModule("/pcm-worklet.js");
    } catch {
      die("Could not start audio processing -- press Start again to retry.");
      return;
    }

    if (startTokenRef.current !== myToken) {
      // Superseded while the worklet module was loading.
      audioContext.close().catch(() => {});
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;
    const workletNode = new AudioWorkletNode(audioContext, "pcm-worklet");
    workletNodeRef.current = workletNode;
    // Deliberately not connected to audioContext.destination -- this is
    // capture-only, playing the mic back out would just be feedback.
    sourceNode.connect(workletNode);

    workletNode.port.onmessage = (e) => {
      const buf = e.data as ArrayBuffer;
      if (relayReady && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(buf);
      } else {
        pendingChunks.push(buf);
      }
    };
  }, [supported, relayUrl, language, cleanup]);

  const stop = useCallback(() => {
    startTokenRef.current++;
    listeningRef.current = false;
    setListening(false);
    setReady(false);
    cleanup();
  }, [cleanup]);

  return { listening, supported, error, ready, start, stop };
}
