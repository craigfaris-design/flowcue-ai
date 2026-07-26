import { describe, it, expect } from "vitest";
import { SyncEngine } from "./syncEngine";

// Same reference script as syncEngine.test.ts, reused so results are
// comparable across both files.
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

function busyWaitMs(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* intentional busy-wait so Date.now()-based freeze logic actually elapses */
  }
}

describe("SyncEngine -- realistic human speech patterns", () => {
  it("does not freeze on an ordinary pause between sentences (default threshold)", () => {
    // Found via live testing: a completely normal ~2.5s pause for a breath
    // or a beat of emphasis -- routine in an emotional speech like a
    // wedding toast -- froze under the old 2000ms default even with
    // perfect transcription. Uses the real default threshold deliberately,
    // not an overridden one, to guard the actual shipped behavior.
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    busyWaitMs(2500);
    expect(engine.getState().frozen).toBe(false);
  });

  it("keeps tracking through one isolated misrecognized word, not just clean transcripts", () => {
    // An earlier fix (requiring the single freshest word to match, to stop
    // ad-lib drift) turned out too strict against ordinary recognizer noise:
    // real speech-to-text regularly misrecognizes an isolated word even
    // mid-sentence, and that fix disqualified every candidate -- including
    // the correct one -- whenever the bad luck landed on the newest word,
    // which showed up as spurious freezes during otherwise-normal live
    // speech. "impossible" stands in for a real word the recognizer
    // garbled entirely (not just a minor misspelling fuzzy-matching handles).
    const engine = new SyncEngine(script, { freezeAfterMs: 500 });
    speak(engine, "When Sarah first told me she was getting married I".split(" "));
    speak(engine, ["impossible"]); // one isolated bad word from the recognizer
    speak(engine, "honestly did not believe her".split(" "));
    expect(engine.getState().frozen).toBe(false);
    // Completes sentence 1 exactly, so the anticipatory-highlight behavior
    // (see the dedicated test for it) correctly shows sentence 2 as next.
    expect(engine.getState().sentenceIndex).toBe(2);
  });

  it("does not falsely freeze on a brief natural pause mid-sentence", () => {
    const engine = new SyncEngine(script, { freezeAfterMs: 300 });
    speak(engine, "Good evening everyone and".split(" "));
    busyWaitMs(50); // a short breath, well under the freeze threshold
    speak(engine, "thank you for being here".split(" "));
    expect(engine.getState().frozen).toBe(false);
    expect(engine.getState().sentenceIndex).toBe(0);
  });

  it("freezes on true silence, then un-freezes and resumes correctly once speech continues", () => {
    const engine = new SyncEngine(script, { freezeAfterMs: 60 });
    speak(engine, "When Sarah first told me she was getting".split(" "));
    const midState = engine.getState();
    expect(midState.frozen).toBe(false);

    busyWaitMs(90); // silence past the freeze threshold -- no ingestWord calls at all
    expect(engine.getState().frozen).toBe(true);
    // position must hold, not drift, while frozen
    expect(engine.getState().cursorTokenIndex).toBe(midState.cursorTokenIndex);

    speak(engine, "married I honestly did not believe".split(" "));
    const resumed = engine.getState();
    expect(resumed.frozen).toBe(false);
    expect(resumed.sentenceIndex).toBe(1);
  });

  it("shrugs off a stuttered false start without drifting position", () => {
    const engine = new SyncEngine(script);
    // "Good- good evening, evening everyone and thank thank you for being here"
    speak(engine, "Good good evening evening everyone and thank thank you for being here".split(" "));
    expect(engine.getState().sentenceIndex).toBe(0);
    expect(engine.getState().frozen).toBe(false);
  });

  it("shrugs off an immediately double-fired word from a recognizer glitch", () => {
    const engine = new SyncEngine(script);
    speak(engine, "We have have been best best friends since the third grade".split(" "));
    expect(engine.getState().sentenceIndex).toBe(2);
  });

  it("recovers from a large forward skip beyond the near-search window", () => {
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    // Jump straight to the closing line -- far past nearWindowAfter (45 tokens).
    // (Sentence index 5, not 4: "Tonight is not... though. It is about..." splits
    // into two sentences at the tokenizer level, per syncEngine.test.ts.)
    speak(engine, "So please raise your glass and join me in wishing them a lifetime of happiness".split(" "));
    expect(engine.getState().sentenceIndex).toBe(5);
  });

  it("recovers when the speaker restarts from the top after reading well past it", () => {
    const engine = new SyncEngine(script);
    speak(
      engine,
      (
        "Good evening everyone and thank you for being here tonight " +
        "When Sarah first told me she was getting married I honestly did not believe her " +
        "We have been best friends since the third grade and I have seen her through"
      ).split(" ")
    );
    expect(engine.getState().sentenceIndex).toBe(2);

    speak(engine, "sorry let me start that again good evening everyone and thank you for being here".split(" "));
    expect(engine.getState().sentenceIndex).toBe(0);
  });

  it("tolerates numbers, contractions, and punctuation-heavy words", () => {
    const punctScript = "The ceremony starts at 3:00 p.m. sharp, so don't be late to James's toast.";
    const engine = new SyncEngine(punctScript);
    speak(engine, "The ceremony starts at 300 pm sharp so dont be late to jamess toast".split(" "));
    const state = engine.getState();
    expect(state.frozen).toBe(false);
    expect(state.cursorTokenIndex).toBe(state.totalTokens - 1);
  });

  it("tracks flawlessly through a full, uninterrupted linear reading", () => {
    const engine = new SyncEngine(script);
    const allWords = script.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
    speak(engine, allWords);
    const state = engine.getState();
    expect(state.frozen).toBe(false);
    expect(state.sentenceIndex).toBe(state.totalSentences - 1);
    expect(state.cursorTokenIndex).toBe(state.totalTokens - 1);
  });

  it("biases toward the nearer occurrence when a phrase repeats later in the script", () => {
    // A refrain repeated twice, spaced apart -- exactly the case the Technical
    // Architecture doc calls out: "biasing toward the nearest unvisited
    // occurrence rather than the first occurrence."
    const refrainScript = [
      "We will always remember this day together.",
      "The food was wonderful and the music even better.",
      "Every guest here has a story about how these two met.",
      "We will always remember this day together.",
      "Thank you all so much for coming to celebrate with us.",
    ].join("\n");
    const engine = new SyncEngine(refrainScript);

    speak(engine, "We will always remember this day".split(" "));
    expect(engine.getState().sentenceIndex).toBe(0);

    speak(engine, "together The food was wonderful and the music even better".split(" "));
    speak(engine, "Every guest here has a story about how these two".split(" "));
    expect(engine.getState().sentenceIndex).toBe(2);

    // Speaker repeats the refrain for emphasis, now further along in the script.
    speak(engine, "met We will always remember this day".split(" "));
    const afterRefrain = engine.getState();
    expect(afterRefrain.sentenceIndex).toBe(3);

    // And normal forward reading continues correctly afterward.
    speak(engine, "Thank you all so much for coming to celebrate with us".split(" "));
    expect(engine.getState().sentenceIndex).toBe(4);
  });

  it("does not false-jump on an ad-lib that coincidentally shares common short words nearby", () => {
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    const before = engine.getState();

    // Ad-lib built almost entirely from short, high-frequency words that also
    // appear throughout the script ("and", "the", "for", "is") -- none long
    // enough (>=4 chars) to fuzzy-match, so this should freeze, not jump.
    const engineWithFastFreeze = new SyncEngine(script, { freezeAfterMs: 30 });
    speak(engineWithFastFreeze, "Good evening everyone and thank you for being here tonight".split(" "));
    speak(engineWithFastFreeze, "and for the and is for the and".split(" "));
    busyWaitMs(50);
    const after = engineWithFastFreeze.getState();

    expect(after.frozen).toBe(true);
    expect(after.sentenceIndex).toBeLessThanOrEqual(before.sentenceIndex);
  });

  it("handles an ad-lib aside that returns cleanly to the script afterward", () => {
    const engine = new SyncEngine(script, { freezeAfterMs: 10000 });
    speak(engine, "When Sarah first told me she was getting married I honestly did not believe".split(" "));
    speak(
      engine,
      "her you know she called me at midnight to tell me and I thought she was joking around with me".split(" ")
    );
    // Off-script aside shouldn't move the cursor to a bogus distant match.
    const duringAdlib = engine.getState();
    expect(duringAdlib.sentenceIndex).toBeLessThanOrEqual(2);

    speak(engine, "We have been best friends since the third grade and I have seen her through".split(" "));
    expect(engine.getState().sentenceIndex).toBe(2);
  });
});
