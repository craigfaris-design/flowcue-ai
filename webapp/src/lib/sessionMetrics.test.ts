import { describe, it, expect } from "vitest";
import { computeSessionMetrics, practiceNudge } from "./sessionMetrics";

describe("computeSessionMetrics", () => {
  it("computes wpm and filler rate from word/filler counts and duration", () => {
    const m = computeSessionMetrics(140, 7, 60);
    expect(m.wpm).toBe(140);
    expect(m.fillerRate).toBe(5);
  });

  it("scores full confidence at the ideal pace with no filler words", () => {
    const m = computeSessionMetrics(140, 0, 60);
    expect(m.confidence).toBe(100);
  });

  it("never divides by zero duration, treating anything under 1s as 1s", () => {
    const m = computeSessionMetrics(10, 0, 0);
    expect(Number.isFinite(m.wpm)).toBe(true);
    expect(m.wpm).toBe(600);
  });

  it("reports a 0% filler rate rather than NaN when no words were spoken", () => {
    const m = computeSessionMetrics(0, 0, 30);
    expect(m.fillerRate).toBe(0);
    expect(Number.isNaN(m.confidence)).toBe(false);
  });

  it("clamps confidence to [0, 100] instead of going negative on a bad session", () => {
    const m = computeSessionMetrics(100, 100, 10); // 100% filler rate, wildly fast pace
    expect(m.confidence).toBe(0);
    expect(m.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe("practiceNudge", () => {
  it("asks for more speech before coaching on too little data", () => {
    expect(practiceNudge(3, 0, 140)).toMatch(/keep going/i);
  });

  it("flags a high filler-word rate", () => {
    expect(practiceNudge(50, 12, 140)).toMatch(/filler words/i);
  });

  it("flags speaking too fast", () => {
    expect(practiceNudge(50, 2, 180)).toMatch(/slowing down/i);
  });

  it("flags speaking too slowly", () => {
    expect(practiceNudge(50, 2, 90)).toMatch(/pick up the pace/i);
  });

  it("gives positive feedback when pace and filler rate are both fine", () => {
    expect(practiceNudge(50, 2, 140)).toMatch(/good pace/i);
  });

  it("prioritizes the filler-word warning over a pace warning when both apply", () => {
    // High filler rate AND too fast -- filler words are the more actionable
    // thing to fix first, so that's the one message shown, not both at once.
    expect(practiceNudge(50, 15, 180)).toMatch(/filler words/i);
  });

  describe("personalized pace band", () => {
    // A presenter whose own natural pace is 180wpm -- the generic band
    // would flag this as "too fast" every session, which isn't useful
    // coaching if it's genuinely normal for them. See adaptiveTuning.ts's
    // paceRange, which computes this from the device's own history.
    const fastTalkerRange = { slowWpm: 153, fastWpm: 207 };

    it("does not flag a pace that's fast by the generic band but normal for this presenter", () => {
      expect(practiceNudge(50, 2, 180, fastTalkerRange)).toMatch(/good pace/i);
    });

    it("still flags a pace that's fast even by this presenter's own wider band", () => {
      expect(practiceNudge(50, 2, 220, fastTalkerRange)).toMatch(/slowing down/i);
    });

    it("flags a pace as too slow relative to this presenter's own (higher) floor, even though it's within the generic band", () => {
      // 120wpm reads as fine against the generic 110-165 band, but is
      // below this presenter's own personalized floor of 153.
      expect(practiceNudge(50, 2, 120, fastTalkerRange)).toMatch(/pick up the pace/i);
    });

    it("falls back to the generic band when no personalized range is passed", () => {
      expect(practiceNudge(50, 2, 180)).toMatch(/slowing down/i);
    });
  });
});
