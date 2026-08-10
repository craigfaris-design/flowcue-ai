import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PacedCursor, DEFAULT_WPM, MIN_WPM, MAX_WPM } from "./pacedCursor";

const SCRIPT = "Good evening everyone. Thank you for being here tonight. It means a lot to us.";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PacedCursor", () => {
  it("tokenizes the same way SyncEngine does (sentences/tokens available up front)", () => {
    const cursor = new PacedCursor(SCRIPT);
    expect(cursor.sentences).toEqual([
      "Good evening everyone.",
      "Thank you for being here tonight.",
      "It means a lot to us.",
    ]);
    expect(cursor.tokens.length).toBe(15);
  });

  it("does not advance until start() is called", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    vi.advanceTimersByTime(5000);
    expect(cursor.getState().cursorTokenIndex).toBe(-1);
  });

  it("advances at the configured words-per-minute pace once playing", () => {
    // 120 wpm = 2 words/sec -- after 3s, ~6 words should have passed.
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.start();
    vi.advanceTimersByTime(3000);
    const state = cursor.getState();
    expect(state.cursorTokenIndex).toBeGreaterThanOrEqual(4);
    expect(state.cursorTokenIndex).toBeLessThanOrEqual(6);
  });

  it("freezes in place when paused, and resumes from the same spot", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.start();
    vi.advanceTimersByTime(2000);
    cursor.pause();
    const pausedIndex = cursor.getState().cursorTokenIndex;

    vi.advanceTimersByTime(5000);
    expect(cursor.getState().cursorTokenIndex).toBe(pausedIndex);

    cursor.start();
    vi.advanceTimersByTime(1);
    expect(cursor.getState().cursorTokenIndex).toBe(pausedIndex);
    expect(cursor.isPlaying()).toBe(true);
  });

  it("jumps straight to a sentence's first token, and keeps advancing from there if playing", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.start();
    vi.advanceTimersByTime(10000); // drift well into the script
    cursor.jumpToSentence(0); // tap the first line to resync back to the start
    expect(cursor.getState().sentenceIndex).toBe(0);
    expect(cursor.getState().cursorTokenIndex).toBe(0);

    // Still playing -- should keep moving forward from the jumped-to spot,
    // not stay pinned there.
    vi.advanceTimersByTime(2000);
    expect(cursor.getState().cursorTokenIndex).toBeGreaterThan(0);
  });

  it("jumping while paused stages the position without resuming playback", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.jumpToSentence(1);
    expect(cursor.isPlaying()).toBe(false);
    expect(cursor.getState().sentenceIndex).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(cursor.getState().sentenceIndex).toBe(1); // never moved, never started
  });

  it("changing pace mid-read does not jump the cursor, only changes future speed", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.start();
    vi.advanceTimersByTime(2000);
    const before = cursor.getState().cursorTokenIndex;
    cursor.setWpm(240);
    // No time has passed yet at the moment of the change -- position must
    // be unchanged right at the rebase point.
    expect(cursor.getState().cursorTokenIndex).toBe(before);
    vi.advanceTimersByTime(2000);
    // But should now be moving roughly twice as fast as before.
    expect(cursor.getState().cursorTokenIndex).toBeGreaterThan(before + 4);
  });

  it("clamps wpm to the documented range", () => {
    const cursor = new PacedCursor(SCRIPT, DEFAULT_WPM);
    cursor.setWpm(9999);
    expect(cursor.getWpm()).toBe(MAX_WPM);
    cursor.setWpm(-50);
    expect(cursor.getWpm()).toBe(MIN_WPM);
  });

  it("clamps the cursor at the script's last token instead of overrunning it", () => {
    const cursor = new PacedCursor(SCRIPT, 1000); // absurdly fast
    cursor.start();
    vi.advanceTimersByTime(60000);
    const state = cursor.getState();
    expect(state.cursorTokenIndex).toBe(cursor.tokens.length - 1);
    expect(cursor.reachedEnd()).toBe(true);
  });

  it("reset() returns to the unstarted state", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.start();
    vi.advanceTimersByTime(3000);
    cursor.reset();
    expect(cursor.isPlaying()).toBe(false);
    expect(cursor.getState().cursorTokenIndex).toBe(-1);
  });

  it("always reports full confidence and never frozen -- there's no matching to lose", () => {
    const cursor = new PacedCursor(SCRIPT, 120);
    cursor.start();
    vi.advanceTimersByTime(3000);
    const state = cursor.getState();
    expect(state.confidence).toBe(1);
    expect(state.frozen).toBe(false);
  });
});
