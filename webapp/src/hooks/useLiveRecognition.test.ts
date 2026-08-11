import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveRecognition } from "./useLiveRecognition";

// Minimal Web Speech API mock, matching the pattern in useSpeechRecognition.test.ts.
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

// Minimal AssemblyAI-side mocks, matching the pattern in useAssemblyAIRecognition.test.ts.
class MockAudioWorkletNode {
  port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  connect() {}
  disconnect() {}
}

class MockAudioContext {
  state: "running" | "closed" = "running";
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  constructor(_opts?: unknown) {}
  createMediaStreamSource(_stream: MediaStream) {
    return { connect() {}, disconnect() {} };
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string) {
    lastSocket = this;
  }
  send() {}
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  simulateMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

let lastSocket: MockWebSocket | null = null;
let lastRecognition: MockRecognition | null = null;

beforeEach(() => {
  lastSocket = null;
  lastRecognition = null;
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
  vi.stubGlobal("WebSocket", MockWebSocket);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream),
    },
  });
  window.SpeechRecognition = vi.fn(function () {
    const instance = new MockRecognition();
    lastRecognition = instance;
    return instance;
  }) as unknown as new () => MockRecognition;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.SpeechRecognition;
});

describe("useLiveRecognition", () => {
  it("falls back to the browser recognizer when AssemblyAI's connection drops mid-session, not just when it's unreachable at start", async () => {
    // Found via code review: the fallback effect only checked
    // `!assemblyAi.error`, which used to never become true on an unexpected
    // connection drop (ws.onclose didn't set an error) -- fixed at the
    // source in useAssemblyAIRecognition.ts. This verifies the composed
    // fallback behavior actually engages now that it does.
    const { result } = renderHook(() => useLiveRecognition({ onWords: () => {} }));

    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(result.current.usingFallback).toBe(false);

    act(() => {
      lastSocket!.onclose?.();
    });

    expect(result.current.usingFallback).toBe(true);
    expect(lastRecognition!.start).toHaveBeenCalled();
  });

  it("does not fall back on a microphone-permission error (would fail identically on either provider)", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { result } = renderHook(() => useLiveRecognition({ onWords: () => {} }));

    await act(async () => {
      result.current.start();
    });

    expect(result.current.usingFallback).toBe(false);
    expect(lastRecognition).toBeNull();
  });

  it("surfaces AssemblyAI's ready handshake gap, but treats the Web Speech fallback as ready as soon as it's listening", async () => {
    const { result } = renderHook(() => useLiveRecognition({ onWords: () => {} }));

    await act(async () => {
      result.current.start();
    });
    // Mic capturing (listening) started, but AssemblyAI's relay handshake
    // hasn't completed yet -- this is exactly the gap a nervous presenter
    // needs surfaced instead of assuming "Listening" already means "heard."
    expect(result.current.listening).toBe(true);
    expect(result.current.ready).toBe(false);

    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(result.current.ready).toBe(true);

    // Once AssemblyAI drops and the fallback takes over, there's no separate
    // handshake to wait on -- ready should track listening directly.
    act(() => {
      lastSocket!.onclose?.();
    });
    expect(result.current.usingFallback).toBe(true);
    expect(result.current.listening).toBe(true);
    expect(result.current.ready).toBe(true);
  });

  it("start() is a no-op while already listening, so it can never run both providers at once", async () => {
    const { result } = renderHook(() => useLiveRecognition({ onWords: () => {} }));

    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(result.current.listening).toBe(true);

    const socketBeforeSecondStart = lastSocket;
    act(() => {
      result.current.start();
    });

    // No new AssemblyAI connection was opened by the redundant start() call.
    expect(lastSocket).toBe(socketBeforeSecondStart);
  });
});
