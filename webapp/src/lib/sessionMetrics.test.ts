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
});
