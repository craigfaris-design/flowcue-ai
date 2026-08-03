import { useCallback, useEffect, useRef, useState } from "react";
import { useDeepgramRecognition } from "./useDeepgramRecognition";
import { useSpeechRecognition } from "./useSpeechRecognition";

/**
 * Prefers Deepgram (low-latency, SLA-backed cloud STT via FlowCue AI's own
 * relay -- see server/src/sttRelay.ts) and falls back automatically to the
 * browser's built-in Web Speech API if Deepgram isn't usable: either its own
 * prerequisites are missing (no getUserMedia/MediaRecorder support) or it's
 * unreachable/unconfigured once a start is actually attempted (checked only
 * after start(), not on mount, so an unsupported Deepgram doesn't trigger a
 * fallback before the user has asked to start at all). Exposes the same
 * { listening, supported, error, start, stop } shape either one does, so
 * ScriptWorkspace doesn't need to know which provider is actually live.
 *
 * Does NOT fall back on a mic-permission error -- that would fail identically
 * on either provider, so surfacing it directly is more honest than silently
 * retrying with a different backend that has the same problem.
 */
export interface UseLiveRecognitionOptions {
  onWords: (words: string[]) => void;
}

export function useLiveRecognition({ onWords }: UseLiveRecognitionOptions) {
  const [usingFallback, setUsingFallback] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const deepgram = useDeepgramRecognition({ onWords });
  const webSpeech = useSpeechRecognition({ onWords });

  // Refs always hold the latest hook result, so the effect/callbacks below
  // never call a stale start/stop closure without needing to re-run on every
  // change to deepgram/webSpeech themselves (React guarantees ref identity
  // is stable, so it's correct -- not a suppression -- to omit them below).
  const deepgramRef = useRef(deepgram);
  deepgramRef.current = deepgram;
  const webSpeechRef = useRef(webSpeech);
  webSpeechRef.current = webSpeech;

  useEffect(() => {
    if (!attempted || usingFallback) return;
    if (deepgram.supported && !deepgram.error) return; // deepgram is fine so far -- nothing to do
    if (deepgram.error?.includes("Microphone access was denied")) return; // would fail on either provider

    setUsingFallback(true);
    webSpeechRef.current.start();
  }, [attempted, deepgram.error, deepgram.supported, usingFallback]);

  const active = usingFallback ? webSpeech : deepgram;

  const start = useCallback(() => {
    // Found via code review: start() had no guard against being called
    // while a session is already active. Not currently reachable through
    // the UI (the Start button is replaced by Stop once listening), but
    // this is a public hook API -- a second call while on the fallback
    // path would launch Deepgram *alongside* the already-running Web
    // Speech recognizer, feeding the sync engine two interleaved
    // transcripts from both providers at once.
    if (active.listening) return;
    setUsingFallback(false);
    setAttempted(true);
    deepgramRef.current.start();
  }, [active.listening]);

  const stop = useCallback(() => {
    setAttempted(false);
    deepgramRef.current.stop();
    webSpeechRef.current.stop();
  }, []);

  return {
    listening: active.listening,
    supported: deepgram.supported || webSpeech.supported,
    // Once fallback succeeds, the Deepgram error that triggered it is an
    // implementation detail, not something the presenter needs to see --
    // only surface an error from whichever provider is currently active.
    error: active.error,
    usingFallback,
    start,
    stop,
  };
}
