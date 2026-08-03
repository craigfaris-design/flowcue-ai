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
    // A completely normal ~2.5s pause for a breath or a beat of emphasis --
    // routine in an emotional speech like a wedding toast. Uses the real
    // default threshold deliberately, not an overridden one, to guard the
    // actual shipped behavior.
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

  it("never freezes on pure silence, no matter how long, only on actively mismatched speech", () => {
    // Found via live testing: freezing based on wall-clock silence duration
    // (the original design) fired "Holding position" during ordinary pauses
    // between paragraphs -- a reader taking a breath, or pausing to read
    // ahead, hasn't done anything wrong, and pausing longer doesn't make it
    // more wrong. Nothing should look "lost" until the speaker actually
    // resumes and the engine genuinely can't place what they're saying.
    const engine = new SyncEngine(script, { freezeAfterMs: 60 });
    speak(engine, "When Sarah first told me she was getting".split(" "));
    const midState = engine.getState();
    expect(midState.frozen).toBe(false);

    busyWaitMs(200); // a long silence, well past freezeAfterMs -- no ingestWord calls at all
    expect(engine.getState().frozen).toBe(false);
    // position must hold, not drift, during the silence
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

  it("never even misaligns on a duplicated word, not just eventually recovers from it (real Deepgram hallucination found in live testing)", () => {
    // Real capture from live testing: Deepgram transcribed "did not not
    // believe her" for a single spoken "not" -- a genuine recognizer
    // hallucination, not a segment-overlap artifact (that's the separate
    // bug already fixed in useDeepgramRecognition.ts). Unlike the older
    // "double-fired word" test above, this asserts frozen stays false
    // throughout -- i.e. the duplicate is neutralized immediately, not
    // just eventually recovered from after it ages out of the buffer.
    const engine = new SyncEngine(script, { freezeAfterMs: 200 });
    speak(engine, "When Sarah first told me she was getting married I honestly did not".split(" "));
    expect(engine.getState().frozen).toBe(false);
    speak(engine, ["not"]); // the hallucinated duplicate
    expect(engine.getState().frozen).toBe(false);
    speak(engine, "believe her".split(" "));
    expect(engine.getState().frozen).toBe(false);
    expect(engine.getState().sentenceIndex).toBe(2);
  });

  it("never misaligns on a single fabricated extra word either, a different failure mode found in the same live-testing session", () => {
    // Real capture from live testing: Deepgram inserted a fabricated word
    // ("built") between two correctly-heard words ("is" and "building")
    // that matches nothing in the script -- not a duplicate, not a merged
    // contraction, just a genuinely stray word. Same underlying problem as
    // both of those (one extra token shifts everything after it out of
    // alignment), fixed generally in scoreCandidate's single-skip
    // tolerance rather than by pattern-matching this specific case too.
    const engine = new SyncEngine(script, { freezeAfterMs: 200 });
    speak(engine, "Tonight is not about the past though It is about the future she is".split(" "));
    expect(engine.getState().frozen).toBe(false);
    speak(engine, ["built"]); // the fabricated word
    expect(engine.getState().frozen).toBe(false);
    speak(engine, "building with James".split(" "));
    expect(engine.getState().frozen).toBe(false);
    // Completes sentence 4 exactly, so the anticipatory-highlight behavior
    // correctly shows sentence 5 as next.
    expect(engine.getState().sentenceIndex).toBe(5);
  });

  it("never misaligns on two separate stray words in the same sentence (a real multi-word self-correction, not just one glitch)", () => {
    // Real capture from live testing (on a different, denser script than
    // this fixture): a genuine speaker self-correction produced two
    // distinct stray words in the same sentence ("it is, isn't, isn't
    // called..." -- an extra "is" plus a repeated "isn't" far enough
    // apart that the adjacent-duplicate collapse didn't neutralize both).
    // One-skip tolerance alone wasn't enough for that case; this simulates
    // the same shape of problem against this file's fixture script.
    const engine = new SyncEngine(script, { freezeAfterMs: 200 });
    speak(engine, "Tonight is not".split(" "));
    expect(engine.getState().frozen).toBe(false);
    speak(engine, ["maybe"]); // first stray word
    expect(engine.getState().frozen).toBe(false);
    speak(engine, "about the past".split(" "));
    expect(engine.getState().frozen).toBe(false);
    speak(engine, ["really"]); // second, unrelated stray word
    expect(engine.getState().frozen).toBe(false);
    speak(engine, ["though"]);
    expect(engine.getState().frozen).toBe(false);
    expect(engine.getState().sentenceIndex).toBe(4);
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

  it("does not yank the cursor back to an earlier refrain occurrence when trailing noise arrives right at the end of the script", () => {
    // Found via the fuzz harness (syncEngine.fuzz.test.ts's "poetry" script,
    // a refrain repeated three times): once the cursor reaches the literal
    // last token, nearLo (cursor - nearWindowBefore) can exceed the highest
    // valid search start (tokens.length - buffer size), so the near-window
    // search comes back empty and every subsequent word falls through to
    // the full-script search. On a script with a repeated phrase, a single
    // stray/noise word arriving after the true end can make an *earlier*
    // occurrence of the refrain score exactly as well as the correct
    // tail -- and without a nearest-to-cursor tie-break in that full-script
    // fallback, the scan kept whichever candidate it reached first (the
    // earlier one), yanking the cursor backward by dozens of tokens on one
    // bit of trailing noise instead of holding position at the end. Fixed
    // by threading a `preferNear` (the current cursor) into searchRange()
    // so ties resolve toward the nearer candidate there too, matching the
    // "biases toward the nearer occurrence" policy the near-window search
    // already gets for free (see the dedicated test for the two-occurrence
    // case above).
    const refrainScript = [
      "We rise again when morning comes.",
      "We rise again, we rise again.",
      "The night was long, the road was hard.",
      "We rise again when morning comes.",
      "We rise again, we rise again.",
      "A thousand steps behind us now.",
      "We rise again when morning comes.",
      "We rise again, we rise again.",
    ].join("\n");
    const engine = new SyncEngine(refrainScript);

    speak(
      engine,
      (
        "We rise again when morning comes We rise again we rise again " +
        "The night was long the road was hard " +
        "We rise again when morning comes We rise again we rise again " +
        "A thousand steps behind us now " +
        "We rise again when morning comes We rise again we rise again"
      ).split(" ")
    );
    const atEnd = engine.getState();
    expect(atEnd.cursorTokenIndex).toBe(atEnd.totalTokens - 1);

    // One fabricated word arrives after the speaker has already finished --
    // a trailing STT hallucination/stray insertion, not more real script.
    speak(engine, ["webhookURL"]);
    const afterTrailingNoise = engine.getState();
    expect(afterTrailingNoise.cursorTokenIndex).toBeGreaterThanOrEqual(atEnd.cursorTokenIndex);
  });

  it("reaches the script's literal last word even when a stray word is inserted within the final match window", () => {
    // Found via the fuzz harness (syncEngine.fuzz.test.ts's "jargonHeavy"
    // script): a fabricated/stray word landing within matchWindowSize (6)
    // tokens of the script's end pushes the correct startIdx for the
    // remaining real words past `tokens.length - spokenBuffer.length` --
    // the bound searchRange() used to clamp its search to, on the
    // (previously correct-looking) assumption that a full buffer-sized
    // window must fit before the script ends. That's only true for a
    // straight 1:1 alignment; scoreCandidate's own skip-tolerant search
    // already produces valid (in fact correct) token indices past that
    // point once a buffer slot is skipped, so the bound was excluding a
    // legitimate candidate outright -- the cursor stalled one word short of
    // the true end and never recovered, since nothing later ever arrives to
    // retry it. Fixed by widening the searchable range to the script's last
    // valid token index (out-of-range token lookups already degrade to "no
    // match" rather than crashing) and clamping the resulting cursor
    // separately so it can never exceed a valid token index.
    const jargonTail = [
      "For example, there is a package called mirror_id used by several developer systems.",
      "I did not find an obvious major company called MirrorID building the same product.",
      "There is an academic project focused on identity preserved generation, although it isn't called MirrorID.",
      "A proper trademark search needs to examine relevant classes and jurisdictions, especially software.",
    ].join("\n");
    const engine = new SyncEngine(jargonTail);

    speak(
      engine,
      (
        "For example there is a package called mirror_id used by several developer systems " +
        "I did not find an obvious major company called MirrorID building the same product " +
        "There is an academic project focused on identity preserved generation although it isn't called MirrorID " +
        "A proper trademark search needs to examine relevant classes and"
      ).split(" ")
    );
    // Fabricated stray word (a real Deepgram-style hallucination of jargon,
    // per the fuzz harness's JARGON_WORDS) wedged in right before the tail.
    speak(engine, ["GPT4"]);
    speak(engine, "jurisdictions especially software".split(" "));

    const state = engine.getState();
    expect(state.cursorTokenIndex).toBe(state.totalTokens - 1);
  });
});
