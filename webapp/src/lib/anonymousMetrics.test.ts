import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendAnonymousMetrics, type AnonymousSessionMetrics } from "./anonymousMetrics";

const metrics: AnonymousSessionMetrics = {
  durationSec: 60,
  wordCount: 140,
  wpm: 140,
  fillerRate: 2,
  confidence: 90,
  freezeCount: 0,
  language: "en-US",
  visualMode: "sentence",
  usingFallback: false,
};

describe("sendAnonymousMetrics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_STT_RELAY_URL", "wss://flowcue-backend.onrender.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts to the backend's /api/metrics endpoint, converting wss:// to https://", () => {
    sendAnonymousMetrics(metrics);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://flowcue-backend.onrender.com/api/metrics",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sends exactly the numeric/enum fields and nothing else -- no free text, no identifiers", () => {
    sendAnonymousMetrics(metrics);
    const [, options] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toEqual(metrics);
    // Guards the actual privacy property, not just today's shape: every
    // value sent must be a number, boolean, or short enum-like string --
    // never anything that could carry free-text/transcript content.
    for (const [key, value] of Object.entries(sentBody)) {
      const isShortEnumString = typeof value === "string" && value.length <= 12;
      expect(
        typeof value === "number" || typeof value === "boolean" || isShortEnumString,
        `field "${key}" (${JSON.stringify(value)}) doesn't look like a safe numeric/enum value`
      ).toBe(true);
    }
  });

  it("never sends cookies/credentials -- each submission must be unlinkable", () => {
    sendAnonymousMetrics(metrics);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.credentials).toBe("omit");
  });

  it("never throws even if fetch rejects (best-effort only)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(() => sendAnonymousMetrics(metrics)).not.toThrow();
  });

  it("does nothing (no fetch call, no throw) when fetch itself isn't available", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => sendAnonymousMetrics(metrics)).not.toThrow();
  });
});
