import { useCallback, useRef, useState } from "react";

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
}
interface DeepgramMessage {
  type?: string;
  message?: string;
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
  };
}

export interface UseDeepgramRecognitionOptions {
  onWords: (words: string[]) => void;
  /** Overrides the relay URL computed from the current page's origin. */
  relayUrl?: string;
}

function defaultRelayUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const port = (import.meta.env.VITE_STT_RELAY_PORT as string | undefined) || "4000";
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

  const start = useCallback(async () => {
    if (!supported) return;
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was denied. Live cueing is stopped -- allow mic access and press Start again.");
      return;
    }
    streamRef.current = stream;

    const ws = new WebSocket(relayUrl ?? defaultRelayUrl());
    wsRef.current = ws;

    // Deepgram (like the Web Speech API) streams a growing transcript for
    // the current utterance, then marks it is_final and starts a new one.
    // Emitting the full transcript every message would double-feed every
    // word already sent as the utterance grew -- the exact bug found and
    // fixed in useSpeechRecognition.ts. Track how many words of the
    // *current* utterance have been emitted, and reset that count whenever
    // is_final arrives (the next message starts a fresh utterance).
    let emittedInUtterance = 0;

    ws.onopen = () => {
      // Wait for the relay's "ready" (Deepgram connection established)
      // before streaming audio -- sending audio into a not-yet-open
      // upstream connection would just be dropped.
    };

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
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then((buf) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(buf);
            });
          }
        };
        // A short timeslice keeps chunks flowing frequently for low latency
        // without waiting for a whole utterance to finish recording.
        recorder.start(250);
        listeningRef.current = true;
        setListening(true);
        return;
      }

      const transcript = msg.channel?.alternatives?.[0]?.transcript;
      if (typeof transcript !== "string") return;
      const words = transcript.trim().split(/\s+/).filter(Boolean);
      const newWords = words.slice(emittedInUtterance);
      if (newWords.length) onWordsRef.current(newWords);
      emittedInUtterance = msg.is_final ? 0 : words.length;
    };

    ws.onerror = () => {
      setError("Could not reach the speech recognition relay.");
      listeningRef.current = false;
      setListening(false);
      cleanup();
    };

    ws.onclose = () => {
      if (listeningRef.current) {
        listeningRef.current = false;
        setListening(false);
      }
    };
  }, [supported, relayUrl, cleanup]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    cleanup();
  }, [cleanup]);

  return { listening, supported, error, start, stop };
}
