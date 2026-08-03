import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Streams microphone audio to FlowCue AI's own backend relay
 * (server/src/sttRelay.ts), which forwards it to Deepgram's real-time
 * streaming API and relays transcripts back -- the API key never reaches
 * the browser. Exposes the same { listening, supported, error, start, stop }
 * shape as useSpeechRecognition so callers can swap between them (see
 * useLiveRecognition.ts, which does exactly that with automatic fallback).
 */

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
}
interface DeepgramMessage {
  type?: string;
  message?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
  };
}

// Below this, a word is more likely to be a garbled guess than a real
// transcription -- confirmed via live testing, where Deepgram dropped a
// word entirely and misheard "did not" as "the didn't" in the same
// utterance. Feeding that straight to the sync engine's matcher gives it
// nothing to work with (it can't align to a script word that was never
// actually heard correctly); dropping very-low-confidence words here means
// the engine only ever sees words worth trying to place.
const CONFIDENCE_FLOOR = 0.3;

export interface UseDeepgramRecognitionOptions {
  onWords: (words: string[]) => void;
  /** Overrides the relay URL computed from the current page's origin. */
  relayUrl?: string;
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
  // -- it just fails silently, Deepgram looks "unreachable," and the app
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

export function useDeepgramRecognition({ onWords, relayUrl }: UseDeepgramRecognitionOptions) {
  const [listening, setListening] = useState(false);
  // Availability of getUserMedia/MediaRecorder doesn't change at runtime,
  // so this doesn't need to be state -- just computed once per hook call.
  const supported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const listeningRef = useRef(false);
  const onWordsRef = useRef(onWords);
  onWordsRef.current = onWords;

  // Bumped at the start of every start()/stop() call. Lets a start() that's
  // still awaiting getUserMedia() notice, once the permission prompt
  // resolves, whether it's been superseded by a stop() or a later start()
  // in the meantime -- found via code review: without this, clicking Stop
  // while the mic-permission prompt is pending silently revived the
  // session once the user granted it (a "zombie restart"), and two
  // overlapping start() calls (e.g. a rapid double-click) each unknowingly
  // overwrote the other's stream/recorder/socket refs, orphaning whichever
  // resolved first -- its mic stream and relay connection leaked forever
  // since nothing still held a reference to close them.
  const startTokenRef = useRef(0);

  const cleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // Resource leak found via code review: nothing released the mic
  // stream/recorder/socket when the component using this hook unmounted
  // mid-session (e.g. navigating away or deleting the script while
  // listening) -- the mic stayed hot and the relay connection to Deepgram
  // stayed open indefinitely.
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (!supported) return;
    setError(null);
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

    // Capture starts the instant mic access is granted -- not once the
    // relay/Deepgram handshake finishes. Found via live testing: waiting
    // for "ready" before creating the recorder (the old design) meant
    // anything said in that window -- mic permission plus a real network
    // round-trip from our relay to Deepgram's cloud -- was never recorded
    // at all, showing up as the whole session feeling stuck/behind right
    // from the start. Chunks recorded before the relay is ready are queued
    // here and flushed in order the moment it signals ready, so nothing
    // spoken during the handshake is lost.
    let relayReady = false;
    const pendingChunks: ArrayBuffer[] = [];

    // A single place to give up on the session and say why -- used by
    // every failure path below (recorder error, track ending unexpectedly,
    // a rejected arrayBuffer() read) so each one doesn't have to
    // separately remember to flip listening state and clean up. Found via
    // code review: none of these had any handler at all, so e.g. an OS
    // mic-permission revocation or a USB/Bluetooth mic disconnecting
    // mid-session left `listening` stuck true with no audio flowing and no
    // error shown -- the same "silently goes dead" failure class the
    // ws.onclose fix above addresses for the network side.
    const die = (message: string) => {
      if (!listeningRef.current) return;
      setError(message);
      listeningRef.current = false;
      setListening(false);
      cleanup();
    };

    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      e.data.arrayBuffer().then(
        (buf) => {
          if (relayReady && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(buf);
          } else {
            pendingChunks.push(buf);
          }
        },
        () => die("Lost access to the microphone -- press Start again to resume live cueing.")
      );
    };
    recorder.onerror = () => die("Lost access to the microphone -- press Start again to resume live cueing.");
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => die("The microphone disconnected -- press Start again to resume live cueing.");
    });
    // Timeslice controls how often a chunk of recorded audio is handed to
    // us and sent onward -- every extra ms here is audio sitting on the
    // client before Deepgram even sees it. 100ms keeps that buffer small
    // without fragmenting the webm/opus stream into pieces so tiny the
    // container overhead outweighs the latency gain.
    recorder.start(100);
    listeningRef.current = true;
    setListening(true);

    const ws = new WebSocket(relayUrl ?? defaultRelayUrl());
    wsRef.current = ws;

    // Deepgram's segments don't cleanly grow-then-finalize the way the Web
    // Speech API's utterances do: live testing showed consecutive "final"
    // segments can overlap in time and repeat trailing words (e.g. "a
    // lifetime of" transcribed once at the end of one segment, then again
    // at the start of the next). Counting words-per-utterance and resetting
    // on is_final -- which works for the Web Speech API -- double-fed those
    // repeated words here. Deduping on each word's audio-time position
    // (from Deepgram's word-level timestamps) instead of message/utterance
    // boundaries is robust to that overlap: a word already covered by
    // previously emitted audio is never re-emitted, regardless of which
    // segment or how many times Deepgram sent it.
    let lastEmittedEnd = 0;
    const EPSILON = 0.02;

    ws.onmessage = (event) => {
      let msg: DeepgramMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "error") {
        setError(msg.message ?? "Speech recognition service error.");
        listeningRef.current = false;
        setListening(false);
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

      const words = msg.channel?.alternatives?.[0]?.words;
      if (!words || !words.length) return;
      const newWords = words.filter((w) => w.end > lastEmittedEnd + EPSILON);
      if (newWords.length) {
        // Advance past all of them (even ones we don't forward) so a
        // dropped low-confidence word is never reconsidered/re-emitted
        // later -- only whether it reaches the matcher changes, not the
        // audio-position dedup.
        const trusted = newWords.filter((w) => w.confidence === undefined || w.confidence >= CONFIDENCE_FLOOR);
        if (trusted.length) onWordsRef.current(trusted.map((w) => w.punctuated_word ?? w.word));
        lastEmittedEnd = Math.max(lastEmittedEnd, ...newWords.map((w) => w.end));
      }
    };

    ws.onerror = () => {
      setError("Could not reach the speech recognition relay.");
      listeningRef.current = false;
      setListening(false);
      cleanup();
    };

    ws.onclose = () => {
      if (listeningRef.current) {
        // An unexpected drop (network blip, relay restart, Deepgram-side
        // disconnect) with no prior onerror -- found via code review: this
        // previously left `error` at null, which meant useLiveRecognition's
        // fallback effect (guarded on `!deepgram.error`) never engaged, so
        // a presenter's mic could silently go dead mid-speech with no
        // error shown and no automatic recovery to the Web Speech fallback
        // that was otherwise available.
        setError("Lost connection to the speech recognition relay -- press Start again to resume live cueing.");
        listeningRef.current = false;
        setListening(false);
      }
    };
  }, [supported, relayUrl, cleanup]);

  const stop = useCallback(() => {
    startTokenRef.current++;
    listeningRef.current = false;
    setListening(false);
    cleanup();
  }, [cleanup]);

  return { listening, supported, error, start, stop };
}
