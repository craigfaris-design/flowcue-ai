import { describe, it, expect } from "vitest";
import { computeAdaptiveOptions } from "./adaptiveTuning";
import type { SessionRecord } from "../lib/types";

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s",
    scriptId: "script",
    date: new Date().toISOString(),
    durationSec: 60,
    wordCount: 100,
    fillerCount: 0,
    wpm: 140,
    fillerRate: 0,
    confidence: 90,
    freezeCount: 0,
    ...overrides,
  };
}

describe("computeAdaptiveOptions", () => {
  it("does not personalize with fewer than 5 usable sessions", () => {
    const sessions = [session({ freezeCount: 5 }), session({ freezeCount: 5 })];
    const result = computeAdaptiveOptions(sessions);
    expect(result.isPersonalized).toBe(false);
    expect(result.options).toEqual({});
  });

  it("ignores sessions with no freezeCount recorded (older records) when counting toward the minimum", () => {
    const sessions = [
      session({ freezeCount: undefined }),
      session({ freezeCount: undefined }),
      session({ freezeCount: undefined }),
      session({ freezeCount: 0 }),
      session({ freezeCount: 0 }),
    ];
    // Only 2 of the 5 have a real freezeCount -- below the minimum.
    expect(computeAdaptiveOptions(sessions).isPersonalized).toBe(false);
  });

  it("stays at the shipped defaults for a well-tracked user, once there's enough history", () => {
    const sessions = Array.from({ length: 5 }, () => session({ freezeCount: 0, wordCount: 100 }));
    const result = computeAdaptiveOptions(sessions);
    expect(result.isPersonalized).toBe(true);
    expect(result.options.freezeAfterMs).toBe(3200);
    expect(result.options.confidenceThreshold).toBe(0.6);
  });

  it("relaxes tolerance for a user with a genuinely high freeze rate", () => {
    // 5 freezes per 100 words is well above the "a lot" reference rate --
    // severity clamps to 1, landing at the maximum relaxation.
    const sessions = Array.from({ length: 5 }, () => session({ freezeCount: 5, wordCount: 100 }));
    const result = computeAdaptiveOptions(sessions);
    expect(result.isPersonalized).toBe(true);
    expect(result.options.freezeAfterMs).toBe(5200);
    expect(result.options.confidenceThreshold).toBe(0.55);
  });

  it("scales relaxation proportionally for a moderate freeze rate, never overshooting the bounds", () => {
    // 1.5 freezes per 100 words is half of the 3.0 reference rate.
    const sessions = Array.from({ length: 5 }, () => session({ freezeCount: 1.5, wordCount: 100 }));
    const result = computeAdaptiveOptions(sessions);
    expect(result.options.freezeAfterMs).toBe(4200); // halfway between 3200 and 5200
    expect(result.options.confidenceThreshold).toBeCloseTo(0.575, 5); // halfway between 0.6 and 0.55
  });

  it("never relaxes tolerance beyond the validated-safe bounds, however bad the history is", () => {
    const sessions = Array.from({ length: 10 }, () => session({ freezeCount: 50, wordCount: 100 }));
    const result = computeAdaptiveOptions(sessions);
    expect(result.options.freezeAfterMs).toBeLessThanOrEqual(5200);
    expect(result.options.confidenceThreshold).toBeGreaterThanOrEqual(0.55);
  });

  it("only considers the most recent sessions passed in, not an unbounded history", () => {
    const badOld = Array.from({ length: 20 }, () => session({ freezeCount: 50, wordCount: 100 }));
    const goodRecent = Array.from({ length: 10 }, () => session({ freezeCount: 0, wordCount: 100 }));
    // Caller (storage.getRecentSessions) is responsible for ordering/limiting;
    // this just confirms the function only looks at what it's given up to
    // its own internal cap, not silently including more.
    const result = computeAdaptiveOptions([...goodRecent, ...badOld]);
    expect(result.sessionsUsed).toBe(10);
  });

  it("weights by total words across sessions, not by session count, so one long rough session doesn't dominate", () => {
    const sessions = [
      session({ freezeCount: 30, wordCount: 1000 }), // 3 per 100 words
      session({ freezeCount: 0, wordCount: 100 }),
      session({ freezeCount: 0, wordCount: 100 }),
      session({ freezeCount: 0, wordCount: 100 }),
      session({ freezeCount: 0, wordCount: 100 }),
    ];
    const result = computeAdaptiveOptions(sessions);
    // 30 freezes over 1400 total words ~= 2.14 per 100 words.
    expect(result.freezesPer100Words).toBeCloseTo(2.1, 1);
  });
});
