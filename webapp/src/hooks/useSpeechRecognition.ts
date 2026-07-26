import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API's SpeechRecognition types aren't in lib.dom yet in most
// TS setups, so we declare the minimal surface we use.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

// Errors that mean the mic will never come back on its own (permission
// denied/revoked, no mic present, or the browser blocked the service) --
// retrying onend just spams getUserMedia prompts. Everything else
// (no-speech, aborted, transient network blips) is expected and self-heals
// via the existing onend restart loop.
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was denied. Live cueing is stopped -- allow mic access and press Start again.",
  "service-not-allowed": "Speech recognition was blocked by the browser. Live cueing is stopped.",
  "audio-capture": "No microphone was found. Live cueing is stopped.",
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export interface UseSpeechRecognitionOptions {
  onWords: (words: string[]) => void;
}

export function useSpeechRecognition({ onWords }: UseSpeechRecognitionOptions) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const onWordsRef = useRef(onWords);
  onWordsRef.current = onWords;

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    setError(null);
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // Tracks how many words have already been emitted for each in-progress
    // result index. A real recognizer streams the same segment repeatedly as
    // interim guesses firm up ("I" -> "I want" -> "I want to" ...), then fires
    // it ONE MORE TIME in full once isFinal flips true -- that final event is
    // not new speech, it's the same segment being confirmed. Re-sending the
    // whole text there (as this used to) double-feeds every word in it right
    // as the engine's match buffer, which is exactly when a real speaker
    // pauses (isFinal fires on pauses), corrupting the buffer at the worst
    // possible moment and showing up as spurious freezes. Only ever emit the
    // delta beyond what this exact result index has already sent.
    const emittedByResultIndex = new Map<number, number>();

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const words = result[0].transcript.trim().split(/\s+/).filter(Boolean);
        const alreadyEmitted = emittedByResultIndex.get(i) ?? 0;
        const newWords = words.slice(alreadyEmitted);
        if (newWords.length) onWordsRef.current(newWords);

        if (result.isFinal) {
          emittedByResultIndex.delete(i);
        } else {
          emittedByResultIndex.set(i, words.length);
        }
      }
    };
    recognition.onerror = (event) => {
      if (FATAL_ERRORS.has(event.error)) {
        listeningRef.current = false;
        setListening(false);
        setError(ERROR_MESSAGES[event.error] ?? "Live cueing stopped due to a speech recognition error.");
      }
      /* everything else (no-speech, aborted, network) is transient -- onend's restart loop handles it */
    };
    recognition.onend = () => {
      if (listeningRef.current) {
        try {
          recognition.start();
        } catch {
          /* already starting */
        }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    listeningRef.current = true;
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { listening, supported, error, start, stop };
}
