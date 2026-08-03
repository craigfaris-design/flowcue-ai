import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDeepgramRecognition } from "./useDeepgramRecognition";

class MockMediaRecorder {
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  constructor(_stream: MediaStream, _options: unknown) {
    lastRecorder = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
}

let lastRecorder: MockMediaRecorder | null = null;

function fakeChunkEvent(label: string) {
  const data = { size: 1, arrayBuffer: () => Promise.resolve(label as unknown as ArrayBuffer) };
  return { data } as unknown as { data: Blob };
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
  lastRecorder = null;
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
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

  it("starts recording immediately on mic access, buffering audio until the relay is ready (no lost speech during handshake)", async () => {
    // Found via live testing: the previous design didn't create the
    // recorder until the relay's "ready" message arrived -- meaning
    // anything said during mic-permission + the relay's own round-trip to
    // Deepgram was never recorded at all, showing up as the session
    // feeling badly behind right from the start.
    const { result } = renderHook(() => useDeepgramRecognition({ onWords: () => {} }));
    await act(async () => {
      await result.current.start();
    });

    // Recording (and listening) starts right away, before the relay is ready.
    expect(lastRecorder!.state).toBe("recording");
    expect(result.current.listening).toBe(true);

    // Audio captured before "ready" is queued, not dropped or sent early.
    await act(async () => {
      lastRecorder!.ondataavailable?.(fakeChunkEvent("chunk-before-ready"));
    });
    expect(lastSocket!.sent).toEqual([]);

    // Once ready, the queued chunk is flushed in order.
    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(lastSocket!.sent).toEqual(["chunk-before-ready"]);

    // Anything captured afterward is sent directly.
    await act(async () => {
      lastRecorder!.ondataavailable?.(fakeChunkEvent("chunk-after-ready"));
    });
    expect(lastSocket!.sent).toEqual(["chunk-before-ready", "chunk-after-ready"]);
  });

  // Deepgram word objects carry audio-time start/end (seconds); dedup keys
  // off those, not off transcript text or is_final/utterance boundaries.
  function w(word: string, start: number, end: number) {
    return { word, start, end };
  }

  it("streams interim words incrementally without re-emitting on the final message", async () => {
    const words: string[][] = [];
    const result = await startAndConnect((wArr) => words.push(wArr));

    act(() => {
      lastSocket!.simulateMessage({
        is_final: false,
        channel: { alternatives: [{ words: [w("good", 0, 0.3)] }] },
      });
    });
    act(() => {
      lastSocket!.simulateMessage({
        is_final: false,
        channel: { alternatives: [{ words: [w("good", 0, 0.3), w("evening", 0.3, 0.7)] }] },
      });
    });
    act(() => {
      // Finalizes with one more word than the last interim guess -- same
      // double-feed risk as the Web Speech API bug this mirrors the fix for.
      lastSocket!.simulateMessage({
        is_final: true,
        channel: {
          alternatives: [{ words: [w("good", 0, 0.3), w("evening", 0.3, 0.7), w("everyone", 0.7, 1.2)] }],
        },
      });
    });

    expect(words).toEqual([["good"], ["evening"], ["everyone"]]);
    expect(result.current.error).toBeNull();
  });

  it("does not re-emit words when a later segment starts a fresh word count with new audio", async () => {
    const words: string[][] = [];
    await startAndConnect((wArr) => words.push(wArr));

    act(() => {
      lastSocket!.simulateMessage({
        is_final: true,
        channel: { alternatives: [{ words: [w("good", 0, 0.3), w("evening", 0.3, 0.7)] }] },
      });
    });
    act(() => {
      lastSocket!.simulateMessage({
        is_final: true,
        channel: { alternatives: [{ words: [w("everyone", 0.7, 1.1)] }] },
      });
    });

    expect(words).toEqual([["good", "evening"], ["everyone"]]);
  });

  it("does not double-feed words when consecutive final segments overlap in time (real Deepgram quirk found in live testing)", async () => {
    // Live testing surfaced this exact case: "a lifetime of" was transcribed
    // at the end of one finalized segment, then repeated at the start of
    // the next finalized segment, with overlapping timestamps -- counting
    // words-per-utterance (the old approach) double-fed it. Time-based
    // dedup must recognize the second segment's overlapping words as
    // already covered and only emit what's genuinely new.
    const words: string[][] = [];
    await startAndConnect((wArr) => words.push(wArr));

    act(() => {
      lastSocket!.simulateMessage({
        is_final: true,
        channel: {
          alternatives: [{ words: [w("a", 4.0, 4.1), w("lifetime", 4.1, 4.5), w("of", 4.5, 4.6)] }],
        },
      });
    });
    act(() => {
      // Re-transcribes "a lifetime of" (same time range) before the
      // genuinely new word "happiness."
      lastSocket!.simulateMessage({
        is_final: true,
        channel: {
          alternatives: [
            {
              words: [
                w("a", 4.0, 4.1),
                w("lifetime", 4.1, 4.5),
                w("of", 4.5, 4.6),
                w("happiness.", 4.6, 5.1),
              ],
            },
          ],
        },
      });
    });

    expect(words).toEqual([["a", "lifetime", "of"], ["happiness."]]);
  });

  it("drops very-low-confidence words instead of forwarding a garbled guess to the matcher", async () => {
    // Real capture from live testing: Deepgram assigned a low confidence to
    // a stretch it badly misheard ("did not" -> "the didn't"). Feeding that
    // straight to the sync engine gives it nothing legitimate to align to;
    // filtering it out here means the matcher only ever sees words worth
    // trying to place, rather than actively-wrong ones.
    const words: string[][] = [];
    await startAndConnect((wArr) => words.push(wArr));

    act(() => {
      lastSocket!.simulateMessage({
        is_final: true,
        channel: {
          alternatives: [
            {
              words: [
                { word: "honestly", start: 0, end: 0.4, confidence: 0.95 },
                { word: "the", start: 0.4, end: 0.5, confidence: 0.12 },
                { word: "didnt", start: 0.5, end: 0.7, confidence: 0.1 },
                { word: "believe", start: 0.7, end: 1.0, confidence: 0.9 },
              ],
            },
          ],
        },
      });
    });

    expect(words).toEqual([["honestly", "believe"]]);

    // A word with no confidence field at all (e.g. a test/mocked payload)
    // should still be trusted, not treated as low-confidence by default.
    act(() => {
      lastSocket!.simulateMessage({
        is_final: true,
        channel: { alternatives: [{ words: [{ word: "her", start: 1.0, end: 1.2 }] }] },
      });
    });
    expect(words).toEqual([["honestly", "believe"], ["her"]]);
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

  it("releases the mic stream, recorder, and socket on unmount mid-session (found via code review: previously leaked)", async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] } as unknown as MediaStream),
      },
    });

    const { result, unmount } = renderHook(() => useDeepgramRecognition({ onWords: () => {} }));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      lastSocket!.readyState = MockWebSocket.OPEN;
      lastSocket!.simulateMessage({ type: "ready" });
    });
    expect(result.current.listening).toBe(true);
    expect(lastRecorder!.state).toBe("recording");

    unmount();

    expect(stopTrack).toHaveBeenCalled();
    expect(lastRecorder!.state).toBe("inactive");
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

    const { result } = renderHook(() => useDeepgramRecognition({ onWords: () => {} }));
    // Call start() directly (not wrapped in act) so it genuinely stays
    // pending at its `await getUserMedia()` point -- simulates the user
    // pressing Stop before the mic-permission prompt resolves.
    const startPromise = result.current.start();
    act(() => {
      result.current.stop();
    });

    const stopTrack = vi.fn();
    await act(async () => {
      resolveGetUserMedia({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] } as unknown as MediaStream);
      await startPromise;
    });

    // The superseded stream must be released immediately, and the session
    // must not silently come back to life.
    expect(stopTrack).toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
    expect(lastRecorder).toBeNull();
  });

  it("does not orphan the first stream when start() is called twice before either mic prompt resolves", async () => {
    const resolvers: Array<(stream: MediaStream) => void> = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolvers.push(resolve);
            })
        ),
      },
    });

    const { result } = renderHook(() => useDeepgramRecognition({ onWords: () => {} }));
    // Call both directly (not wrapped in act) -- simulates a rapid
    // double-click before either mic-permission prompt resolves.
    const firstStart = result.current.start();
    const secondStart = result.current.start();

    const firstStopTrack = vi.fn();
    const secondStopTrack = vi.fn();
    await act(async () => {
      resolvers[0]({ getTracks: () => [{ stop: firstStopTrack }], getAudioTracks: () => [] } as unknown as MediaStream);
      resolvers[1]({ getTracks: () => [{ stop: secondStopTrack }], getAudioTracks: () => [] } as unknown as MediaStream);
      await firstStart;
      await secondStart;
    });

    // The first (superseded) call's stream is released; only the second's
    // recorder is left active -- nothing is silently leaked.
    expect(firstStopTrack).toHaveBeenCalled();
    expect(secondStopTrack).not.toHaveBeenCalled();
  });

  it("surfaces an error on an unexpected connection drop, not just an explicit relay error message", async () => {
    // Found via code review: ws.onclose previously only flipped listening
    // to false without setting `error`, which meant useLiveRecognition's
    // fallback effect (guarded on `!deepgram.error`) never engaged on a
    // silent network drop -- the mic would look "just stopped" with no
    // explanation and no automatic fallback.
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
