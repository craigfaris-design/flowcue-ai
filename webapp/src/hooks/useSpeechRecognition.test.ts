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
});
