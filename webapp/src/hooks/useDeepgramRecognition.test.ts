import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDeepgramRecognition } from "./useDeepgramRecognition";

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(_stream: MediaStream, _options: unknown) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
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
  sent: unknown[] = [];
  constructor(_url: string) {
    lastSocket = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  // Test helper, not part of the real WebSocket API.
  simulateMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

let lastSocket: MockWebSocket | null = null;

beforeEach(() => {
  lastSocket = null;
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("WebSocket", MockWebSocket);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startAndConnect(onWords: (w: string[]) => void) {
  const { result } = renderHook(() => useDeepgramRecognition({ onWords }));
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    lastSocket!.readyState = MockWebSocket.OPEN;
    lastSocket!.simulateMessage({ type: "ready" });
  });
  return result;
}

describe("useDeepgramRecognition", () => {
  it("reports supported based on getUserMedia/MediaRecorder availability", () => {
    const { result } = renderHook(() => useDeepgramRecognition({ onWords: () => {} }));
    expect(result.current.supported).toBe(true);
  });

  it("becomes listening once the relay signals ready", async () => {
    const result = await startAndConnect(() => {});
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("streams interim words incrementally without re-emitting on the final message", async () => {
    const words: string[][] = [];
    const result = await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage({ is_final: false, channel: { alternatives: [{ transcript: "good" }] } });
    });
    act(() => {
      lastSocket!.simulateMessage({ is_final: false, channel: { alternatives: [{ transcript: "good evening" }] } });
    });
    act(() => {
      // Finalizes with one more word than the last interim guess -- same
      // double-feed risk as the Web Speech API bug this mirrors the fix for.
      lastSocket!.simulateMessage({ is_final: true, channel: { alternatives: [{ transcript: "good evening everyone" }] } });
    });

    expect(words).toEqual([["good"], ["evening"], ["everyone"]]);
    expect(result.current.error).toBeNull();
  });

  it("starts a fresh utterance count after is_final, not carrying over the old one", async () => {
    const words: string[][] = [];
    await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage({ is_final: true, channel: { alternatives: [{ transcript: "good evening" }] } });
    });
    act(() => {
      lastSocket!.simulateMessage({ is_final: true, channel: { alternatives: [{ transcript: "everyone" }] } });
    });

    expect(words).toEqual([["good", "evening"], ["everyone"]]);
  });

  it("surfaces the relay's error message and stops listening", async () => {
    const result = await startAndConnect(() => {});
    act(() => {
      lastSocket!.simulateMessage({ type: "error", message: "DEEPGRAM_API_KEY is not configured on the server." });
    });

    expect(result.current.error).toMatch(/DEEPGRAM_API_KEY is not configured/);
    expect(result.current.listening).toBe(false);
  });

  it("surfaces a clear message when the microphone is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { result } = renderHook(() => useDeepgramRecognition({ onWords: () => {} }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toMatch(/microphone access was denied/i);
    expect(result.current.listening).toBe(false);
  });
});
