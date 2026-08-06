import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSpeechRecognition } from "./useSpeechRecognition";

class MockRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

let lastInstance: MockRecognition | null = null;

beforeEach(() => {
  lastInstance = null;
  window.SpeechRecognition = vi.fn(function (this: MockRecognition) {
    lastInstance = new MockRecognition();
    return lastInstance;
  }) as unknown as new () => MockRecognition;
});

afterEach(() => {
  delete window.SpeechRecognition;
});

describe("useSpeechRecognition", () => {
  it("defaults to English when no language is given", () => {
    const { result } = renderHook(() => useSpeechRecognition({ onWords: () => {} }));
    act(() => result.current.start());
    expect(lastInstance!.lang).toBe("en-US");
  });

  it("sets the recognizer's language from the language option", () => {
    const { result } = renderHook(() => useSpeechRecognition({ onWords: () => {}, language: "de-DE" }));
    act(() => result.current.start());
    expect(lastInstance!.lang).toBe("de-DE");
  });

  it("stops listening and surfaces a message on a fatal error (mic permission denied)", () => {
    const { result } = renderHook(() => useSpeechRecognition({ onWords: () => {} }));

    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();

    act(() => lastInstance!.onerror?.({ error: "not-allowed" }));

    expect(result.current.listening).toBe(false);
    expect(result.current.error).toMatch(/microphone access was denied/i);
  });

  it("does not stop listening or set an error on a transient error (no-speech)", () => {
    const { result } = renderHook(() => useSpeechRecognition({ onWords: () => {} }));

    act(() => result.current.start());
    act(() => lastInstance!.onerror?.({ error: "no-speech" }));

    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("clears a previous error when starting again", () => {
    const { result } = renderHook(() => useSpeechRecognition({ onWords: () => {} }));

    act(() => result.current.start());
    act(() => lastInstance!.onerror?.({ error: "audio-capture" }));
    expect(result.current.error).not.toBeNull();

    act(() => result.current.start());
    expect(result.current.error).toBeNull();
  });

  function fireResult(isFinal: boolean, transcript: string, resultIndex = 0) {
    // event.results is indexed from the start of the session -- pad with
    // placeholder already-final entries so results[resultIndex] lands where
    // the real handler's `for (i = event.resultIndex; ...)` loop expects it.
    const results = Array.from({ length: resultIndex }, () => ({ isFinal: true, 0: { transcript: "" } }));
    results.push({ isFinal, 0: { transcript } });
    lastInstance!.onresult?.({ resultIndex, results });
  }

  it("streams interim words incrementally as a segment firms up", () => {
    const words: string[][] = [];
    const { result } = renderHook(() => useSpeechRecognition({ onWords: (w) => words.push(w) }));
    act(() => result.current.start());

    act(() => fireResult(false, "I"));
    act(() => fireResult(false, "I want"));
    act(() => fireResult(false, "I want to"));

    expect(words).toEqual([["I"], ["want"], ["to"]]);
  });

  it("does not re-emit already-streamed interim words when the segment finalizes", () => {
    // The exact bug found via live testing: a real recognizer fires the same
    // segment's full text one more time when isFinal flips true, which is a
    // confirmation of speech already streamed as interim, not new speech.
    // Re-emitting it duplicated every word right as the sync engine's match
    // buffer, corrupting it at the worst moment (a real pause) and showing
    // up as spurious "Holding position" freezes during live testing.
    const words: string[][] = [];
    const { result } = renderHook(() => useSpeechRecognition({ onWords: (w) => words.push(w) }));
    act(() => result.current.start());

    act(() => fireResult(false, "I"));
    act(() => fireResult(false, "I want"));
    act(() => fireResult(false, "I want to"));
    // Finalizes with one more word than the last interim guess had.
    act(() => fireResult(true, "I want to go"));

    expect(words).toEqual([["I"], ["want"], ["to"], ["go"]]);
  });

  it("emits a fresh final result in full when no interim preceded it", () => {
    const words: string[][] = [];
    const { result } = renderHook(() => useSpeechRecognition({ onWords: (w) => words.push(w) }));
    act(() => result.current.start());

    act(() => fireResult(true, "good evening everyone"));

    expect(words).toEqual([["good", "evening", "everyone"]]);
  });

  it("does not leak emitted-word tracking between separate result segments", () => {
    const words: string[][] = [];
    const { result } = renderHook(() => useSpeechRecognition({ onWords: (w) => words.push(w) }));
    act(() => result.current.start());

    act(() => fireResult(true, "first segment done", 0));
    act(() => fireResult(false, "second", 1));
    act(() => fireResult(true, "second segment", 1));

    expect(words).toEqual([["first", "segment", "done"], ["second"], ["segment"]]);
  });
});
