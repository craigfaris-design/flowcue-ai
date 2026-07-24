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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const lastInterimLengthRef = useRef(0);
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
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          const words = text.trim().split(/\s+/).filter(Boolean);
          if (words.length) onWordsRef.current(words);
          lastInterimLengthRef.current = 0;
        } else {
          interim += text;
        }
      }
      if (interim) {
        const words = interim.trim().split(/\s+/).filter(Boolean);
        const newWords = words.slice(lastInterimLengthRef.current);
        if (newWords.length) onWordsRef.current(newWords);
        lastInterimLengthRef.current = words.length;
      }
    };
    recognition.onerror = () => {
      /* transient recognition errors are expected (silence timeouts, etc.) */
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

  return { listening, supported, start, stop };
}
