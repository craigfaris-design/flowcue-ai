import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAssemblyAIRecognition } from "./useAssemblyAIRecognition";

class MockAudioWorkletNode {
  port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  connect() {}
  disconnect() {}
  // Test helper, not part of the real AudioWorkletNode API.
  simulateChunk(buf: ArrayBuffer) {
    this.port.onmessage?.({ data: buf });
  }
}

let lastWorkletNode: MockAudioWorkletNode | null = null;
let lastAudioContext: MockAudioContext | null = null;

class MockAudioContext {
  state: "running" | "closed" = "running";
  addModule = vi.fn().mockResolvedValue(undefined);
  audioWorklet = { addModule: (...args: unknown[]) => this.addModule(...args) };
  constructor(_opts?: unknown) {
    lastAudioContext = this;
  }
  createMediaStreamSource(_stream: MediaStream) {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

function fakeChunk(sampleCount = 10): ArrayBuffer {
  return new Int16Array(sampleCount).buffer;
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
  url: string;
  constructor(url: string) {
    this.url = url;
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
  lastWorkletNode = null;
  lastAudioContext = null;
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal(
    "AudioWorkletNode",
    class extends MockAudioWorkletNode {
      constructor(_ctx: unknown, _name: string) {
        super();
        lastWorkletNode = this;
      }
    }
  );
  vi.stubGlobal("WebSocket", MockWebSocket);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startAndConnect(onWords: (w: string[]) => void) {
  const { result } = renderHook(() => useAssemblyAIRecognition({ onWords }));
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    lastSocket!.readyState = MockWebSocket.OPEN;
    lastSocket!.simulateMessage({ type: "ready" });
  });
  return result;
}

function turn(turnOrder: number, words: Array<{ text: string; confidence?: number }>, endOfTurn = false) {
  return { type: "Turn", turn_order: turnOrder, end_of_turn: endOfTurn, words };
}

describe("useAssemblyAIRecognition", () => {
  it("reports supported based on getUserMedia/AudioContext/AudioWorkletNode availability", () => {
    const { result } = renderHook(() => useAssemblyAIRecognition({ onWords: () => {} }));
    expect(result.current.supported).toBe(true);
  });

  it("becomes listening once the relay signals ready", async () => {
    const result = await startAndConnect(() => {});
    expect(result.current.listening).toBe(true);
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("reports listening but not ready during the mic-capture-to-relay-handshake gap", async () => {
    // The gap this exists to surface: mic capture (and `listening`) starts
    // the instant permission is granted, but the presenter isn't actually
    // being heard by AssemblyAI until the relay's "ready" message arrives
    // -- reported directly as confusing for a nervous presenter with no way
    // to tell those two states apart.
    const { result } = renderHook(() => useAssemblyAIRecognition({ onWords: () => {} }));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.listening).toBe(true);
    expect(result.current.ready).toBe(false);

    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(result.current.ready).toBe(true);
  });

  it("resets ready to false on stop, error, and connection drop -- never sticky across sessions", async () => {
    const result = await startAndConnect(() => {});
    expect(result.current.ready).toBe(true);

    act(() => {
      result.current.stop();
    });
    expect(result.current.ready).toBe(false);

    const result2 = await startAndConnect(() => {});
    expect(result2.current.ready).toBe(true);
    act(() => {
      lastSocket!.onclose?.();
    });
    expect(result2.current.ready).toBe(false);
  });

  it("starts capturing immediately on mic access, buffering PCM chunks until the relay is ready (no lost speech during handshake)", async () => {
    const { result } = renderHook(() => useAssemblyAIRecognition({ onWords: () => {} }));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.listening).toBe(true);
    expect(lastAudioContext!.addModule).toHaveBeenCalledWith("/pcm-worklet.js");

    // A PCM chunk captured before "ready" is queued, not dropped or sent early.
    const chunkBeforeReady = fakeChunk();
    await act(async () => {
      lastWorkletNode!.simulateChunk(chunkBeforeReady);
    });
    expect(lastSocket!.sent).toEqual([]);

    // Once ready, the queued chunk is flushed.
    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(lastSocket!.sent).toEqual([chunkBeforeReady]);

    // Anything captured afterward is sent directly.
    const chunkAfterReady = fakeChunk();
    await act(async () => {
      lastWorkletNode!.simulateChunk(chunkAfterReady);
    });
    expect(lastSocket!.sent).toEqual([chunkBeforeReady, chunkAfterReady]);
  });

  it("emits new words as a Turn's word list grows, without re-emitting already-seen ones", async () => {
    const words: string[][] = [];
    const result = await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage(turn(0, [{ text: "Good" }]));
    });
    act(() => {
      lastSocket!.simulateMessage(turn(0, [{ text: "Good" }, { text: "evening" }]));
    });
    act(() => {
      lastSocket!.simulateMessage(turn(0, [{ text: "Good" }, { text: "evening" }, { text: "everyone" }], true));
    });

    expect(words).toEqual([["Good"], ["evening"], ["everyone"]]);
    expect(result.current.error).toBeNull();
  });

  it("does not re-emit a turn's words when AssemblyAI replays them formatted (format_turns' second end_of_turn message, same turn_order)", async () => {
    const words: string[][] = [];
    await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage(turn(0, [{ text: "Good" }, { text: "evening" }], true));
    });
    // AssemblyAI's format_turns behavior: after the unformatted end_of_turn
    // message, a second Turn message for the SAME turn_order arrives with
    // turn_is_formatted:true and punctuated/cased text -- not new speech.
    act(() => {
      lastSocket!.simulateMessage({
        type: "Turn",
        turn_order: 0,
        end_of_turn: true,
        turn_is_formatted: true,
        words: [{ text: "Good" }, { text: "evening," }],
      });
    });

    expect(words).toEqual([["Good", "evening"]]);
  });

  it("does not leak emitted-word tracking between separate turns", async () => {
    const words: string[][] = [];
    await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage(turn(0, [{ text: "First" }, { text: "turn" }, { text: "done" }], true));
    });
    act(() => {
      lastSocket!.simulateMessage(turn(1, [{ text: "Second" }]));
    });
    act(() => {
      lastSocket!.simulateMessage(turn(1, [{ text: "Second" }, { text: "turn" }], true));
    });

    expect(words).toEqual([["First", "turn", "done"], ["Second"], ["turn"]]);
  });

  it("drops very-low-confidence words instead of forwarding a garbled guess to the matcher", async () => {
    const words: string[][] = [];
    await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage(
        turn(0, [
          { text: "honestly", confidence: 0.95 },
          { text: "the", confidence: 0.12 },
          { text: "believe", confidence: 0.9 },
        ])
      );
    });

    expect(words).toEqual([["honestly", "believe"]]);

    // A word with no confidence field at all should still be trusted.
    act(() => {
      lastSocket!.simulateMessage(turn(1, [{ text: "her" }]));
    });
    expect(words).toEqual([["honestly", "believe"], ["her"]]);
  });

  it("ignores non-Turn message types (Begin/Termination) without erroring", async () => {
    const words: string[][] = [];
    const result = await startAndConnect((w) => words.push(w));

    act(() => {
      lastSocket!.simulateMessage({ type: "Begin", id: "abc", expires_at: 12345 });
    });
    act(() => {
      lastSocket!.simulateMessage({ type: "Termination", audio_duration_seconds: 1, session_duration_seconds: 2 });
    });

    expect(words).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the relay's error message and stops listening", async () => {
    const result = await startAndConnect(() => {});
    act(() => {
      lastSocket!.simulateMessage({ type: "error", message: "ASSEMBLYAI_API_KEY is not configured on the server." });
    });

    expect(result.current.error).toMatch(/ASSEMBLYAI_API_KEY is not configured/);
    expect(result.current.listening).toBe(false);
  });

  it("surfaces a clear message when the microphone is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { result } = renderHook(() => useAssemblyAIRecognition({ onWords: () => {} }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toMatch(/microphone access was denied/i);
    expect(result.current.listening).toBe(false);
  });

  it("releases the mic stream, audio context, and socket on unmount mid-session", async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] } as unknown as MediaStream),
      },
    });

    const { result, unmount } = renderHook(() => useAssemblyAIRecognition({ onWords: () => {} }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(result.current.listening).toBe(true);

    unmount();

    expect(stopTrack).toHaveBeenCalled();
    expect(lastAudioContext!.state).toBe("closed");
    expect(lastSocket!.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("does not revive a session stopped while the mic-permission prompt was still pending (the 'zombie restart' bug)", async () => {
    let resolveGetUserMedia!: (stream: MediaStream) => void;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveGetUserMedia = resolve;
            })
        ),
      },
    });

    const { result } = renderHook(() => useAssemblyAIRecognition({ onWords: () => {} }));
    const startPromise = result.current.start();
    act(() => {
      result.current.stop();
    });

    const stopTrack = vi.fn();
    await act(async () => {
      resolveGetUserMedia({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] } as unknown as MediaStream);
      await startPromise;
    });

    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("threads the language option through to the relay URL as a query param", async () => {
    const { result } = renderHook(() =>
      useAssemblyAIRecognition({ onWords: () => {}, relayUrl: "wss://example.test/api/stt-relay", language: "fr-FR" })
    );
    await act(async () => {
      await result.current.start();
    });
    expect(lastSocket!.url).toBe("wss://example.test/api/stt-relay?language=fr-FR");
  });

  it("surfaces an error on an unexpected connection drop, not just an explicit relay error message", async () => {
    const result = await startAndConnect(() => {});
    act(() => {
      lastSocket!.onclose?.();
    });
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toMatch(/lost connection/i);
  });

  it("surfaces an error and stops if the microphone disconnects mid-session", async () => {
    const stopTrack = vi.fn();
    let endedHandler: (() => void) | undefined;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
          getAudioTracks: () => [
            {
              set onended(fn: () => void) {
                endedHandler = fn;
              },
            },
          ],
        } as unknown as MediaStream),
      },
    });

    const result = await startAndConnect(() => {});
    expect(result.current.listening).toBe(true);

    act(() => {
      endedHandler?.();
    });

    expect(result.current.listening).toBe(false);
    expect(result.current.error).toMatch(/microphone disconnected/i);
  });
});
