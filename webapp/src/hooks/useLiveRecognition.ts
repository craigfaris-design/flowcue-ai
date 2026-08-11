import { useCallback, useEffect, useRef, useState } from "react";
import { useAssemblyAIRecognition } from "./useAssemblyAIRecognition";
import { useSpeechRecognition } from "./useSpeechRecognition";

/**
 * Prefers AssemblyAI (low-latency cloud STT via FlowCue AI's own relay --
 * see server/src/sttRelay.ts) and falls back automatically to the browser's
 * built-in Web Speech API if AssemblyAI isn't usable: either its own
 * prerequisites are missing (no getUserMedia/AudioWorklet support) or it's
 * unreachable/unconfigured once a start is actually attempted (checked only
 * after start(), not on mount, so an unsupported AssemblyAI doesn't trigger
 * a fallback before the user has asked to start at all). Exposes the same
 * { listening, supported, error, start, stop } shape either one does, so
 * ScriptWorkspace doesn't need to know which provider is actually live.
 *
 * Does NOT fall back on a mic-permission error -- that would fail identically
 * on either provider, so surfacing it directly is more honest than silently
 * retrying with a different backend that has the same problem.
 */
export interface UseLiveRecognitionOptions {
  onWords: (words: string[]) => void;
  /** BCP-47 tag (see lib/types.ts's SPEECH_LANGUAGES) forwarded to whichever
   * provider ends up active, so a fallback mid-session still listens for
   * the right language rather than silently reverting to English. */
  language?: string;
}

export function useLiveRecognition({ onWords, language }: UseLiveRecognitionOptions) {
  const [usingFallback, setUsingFallback] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const assemblyAi = useAssemblyAIRecognition({ onWords, language });
  const webSpeech = useSpeechRecognition({ onWords, language });

  // Refs always hold the latest hook result, so the effect/callbacks below
  // never call a stale start/stop closure without needing to re-run on every
  // change to assemblyAi/webSpeech themselves (React guarantees ref identity
  // is stable, so it's correct -- not a suppression -- to omit them below).
  const assemblyAiRef = useRef(assemblyAi);
  assemblyAiRef.current = assemblyAi;
  const webSpeechRef = useRef(webSpeech);
  webSpeechRef.current = webSpeech;

  useEffect(() => {
    if (!attempted || usingFallback) return;
    if (assemblyAi.supported && !assemblyAi.error) return; // assemblyAi is fine so far -- nothing to do
    if (assemblyAi.error?.includes("Microphone access was denied")) return; // would fail on either provider

    setUsingFallback(true);
    webSpeechRef.current.start();
  }, [attempted, assemblyAi.error, assemblyAi.supported, usingFallback]);

  const active = usingFallback ? webSpeech : assemblyAi;

  const start = useCallback(() => {
    // Found via code review: start() had no guard against being called
    // while a session is already active. Not currently reachable through
    // the UI (the Start button is replaced by Stop once listening), but
    // this is a public hook API -- a second call while on the fallback
    // path would launch AssemblyAI *alongside* the already-running Web
    // Speech recognizer, feeding the sync engine two interleaved
    // transcripts from both providers at once.
    if (active.listening) return;
    setUsingFallback(false);
    setAttempted(true);
    assemblyAiRef.current.start();
  }, [active.listening]);

  const stop = useCallback(() => {
    setAttempted(false);
    assemblyAiRef.current.stop();
    webSpeechRef.current.stop();
  }, []);

  return {
    listening: active.listening,
    supported: assemblyAi.supported || webSpeech.supported,
    // Once fallback succeeds, the AssemblyAI error that triggered it is an
    // implementation detail, not something the presenter needs to see --
    // only surface an error from whichever provider is currently active.
    error: active.error,
    usingFallback,
    // The Web Speech API has no discrete "connection established" handshake
    // the way AssemblyAI's relay does -- it's a synchronous browser call, so
    // `listening` itself is already the closest honest signal there. Only
    // AssemblyAI has a real gap between "mic capturing" and "actually being
    // heard" worth surfacing separately (see useAssemblyAIRecognition's
    // `ready` for why that gap matters to a presenter).
    ready: usingFallback ? webSpeech.listening : assemblyAi.ready,
    start,
    stop,
  };
}
