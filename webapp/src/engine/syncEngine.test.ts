import { describe, it, expect } from "vitest";
import { SyncEngine } from "./syncEngine";

const script = [
  "Good evening, everyone, and thank you for being here tonight.",
  "When Sarah first told me she was getting married, I honestly did not believe her.",
  "We have been best friends since the third grade, and I have seen her through everything.",
  "Tonight is not about the past, though. It is about the future she is building with James.",
  "So please raise your glass and join me in wishing them a lifetime of happiness.",
].join("\n");

function speak(engine: SyncEngine, words: string[]) {
  words.forEach((w) => engine.ingestWord(w));
}

describe("SyncEngine", () => {
  it("tracks forward during normal linear reading", () => {
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    expect(engine.getState().sentenceIndex).toBe(0);
  });

  it("recovers from a skip-ahead within the target sentence", () => {
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    speak(engine, "So please raise your glass and join me in wishing them".split(" "));
    // "Tonight is not about the past, though. It is about the future..." splits into
    // two sentences at the tokenizer level, so the toast line is sentence index 5.
    expect(engine.getState().sentenceIndex).toBe(5);
  });

  it("keeps the correct (later) position after a repeated line", () => {
    const engine = new SyncEngine(script);
    speak(engine, "When Sarah first told me she was getting married I honestly did not believe her".split(" "));
    speak(engine, "When Sarah first told me".split(" "));
    speak(engine, "she was getting married I honestly did not believe her".split(" "));
    speak(engine, "We have been best friends since the third grade".split(" "));
    expect(engine.getState().sentenceIndex).toBe(2);
  });

  it("detects a backtrack to an earlier sentence", () => {
    const engine = new SyncEngine(script);
    speak(engine, "We have been best friends since the third grade and I have seen her through everything".split(" "));
    speak(engine, "Tonight is not about the past though".split(" "));
    speak(engine, "We have been best friends since the third grade".split(" "));
    expect(engine.getState().sentenceIndex).toBe(2);
  });

  it("tolerates minor misrecognition via fuzzy matching", () => {
    const engine = new SyncEngine(script);
    speak(engine, "When Sarah first told me she was getting marreid I honestly did not beleive her".split(" "));
    expect(engine.getState().sentenceIndex).toBe(1);
  });

  it("freezes rather than guesses during sustained off-script speech", () => {
    const engine = new SyncEngine(script, { freezeAfterMs: 50 });
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    speak(engine, "you know my dog ate my notes so bear with me here folks".split(" "));
    const settled = engine.getState();

    const wait = Date.now() + 80;
    while (Date.now() < wait) {
      /* busy-wait to exceed freezeAfterMs */
    }
    const after = engine.getState();

    expect(after.frozen).toBe(true);
    expect(after.cursorTokenIndex).toBe(settled.cursorTokenIndex);
    expect(after.sentenceIndex).toBeLessThanOrEqual(1);
  });

  it("reset() clears the cursor and buffer", () => {
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    expect(engine.getState().cursorTokenIndex).toBeGreaterThan(-1);
    engine.reset();
    expect(engine.getState().cursorTokenIndex).toBe(-1);
  });
});
