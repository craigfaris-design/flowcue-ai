import { describe, it, expect } from "vitest";
import { SyncEngine, expandSpokenWord, isDistinctiveToken, normalize, tokenizeScript } from "./syncEngine";

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
    speak(engine, "Good evening everyone and thank you for being here".split(" "));
    expect(engine.getState().sentenceIndex).toBe(0);
  });

  it("highlights the next sentence the instant the current one completes, before any word of it is spoken", () => {
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    // Not a single word of sentence 1 has been spoken -- the display must
    // already be waiting on it, not lagging on the just-finished sentence 0
    // until words of sentence 1 arrive to "confirm" it.
    expect(engine.getState().sentenceIndex).toBe(1);
    expect(engine.getState().frozen).toBe(false);
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

  it("does not regress to a previous paragraph after off-script ad-libbing (jokes/crowd banter unrelated to the speech)", () => {
    // The exact scenario reported from live use: the presenter reads
    // through a couple of paragraphs, veers off to talk to the crowd about
    // something with nothing to do with the script, then resumes reading
    // where they left off. The old full-script fallback search (triggered
    // because ad-lib content matches nothing near the cursor) had no floor
    // on how far backward it could jump, and a short run of common words in
    // the ad-lib could coincidentally clear the confidence threshold
    // against an earlier paragraph -- visibly "undoing" a paragraph the
    // presenter had already delivered right as they returned to the script.
    const engine = new SyncEngine(script);
    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    speak(engine, "When Sarah first told me she was getting married I honestly did not believe her".split(" "));
    const beforeAdLib = engine.getState();
    expect(beforeAdLib.sentenceIndex).toBe(2);

    // Off-script content sharing no real phrasing with the script.
    speak(
      engine,
      "you know this actually reminds me of a camping trip we took last summer where it rained the entire weekend and nobody had packed a proper tent".split(
        " "
      )
    );

    // Resume the script exactly where they left off.
    speak(engine, "We have been best friends since the third grade and I have seen her through everything".split(" "));

    const after = engine.getState();
    expect(after.sentenceIndex).toBeGreaterThanOrEqual(beforeAdLib.sentenceIndex);
    expect(after.sentenceIndex).toBe(3);
  });

  it("still allows a genuine backward match if the recognizer briefly free-associates a *word* the script also happens to use later, as long as it's not a strong multi-word match to earlier text", () => {
    // Guards the actual mechanism the fix above relies on: disqualifying a
    // backward candidate specifically when fewer than all of the most
    // recent words match, not by distance or any other proxy. A single
    // coincidentally-matching common word mixed into otherwise-unrelated
    // speech must not be enough on its own.
    const engine = new SyncEngine(script);
    speak(engine, "We have been best friends since the third grade and I have seen her through everything".split(" "));
    const before = engine.getState();
    expect(before.sentenceIndex).toBe(3);

    // "married" appears earlier (sentence 1), but surrounded by unrelated
    // words -- only one of the recent words coincidentally overlaps.
    speak(engine, "anyway I was reading about how beavers build their dams last night fascinating stuff".split(" "));
    const after = engine.getState();
    expect(after.sentenceIndex).toBeGreaterThanOrEqual(before.sentenceIndex);
  });

  it("never automatically regresses to an earlier sentence, even for a strong/exact repeat of that text", () => {
    // Was "detects a backtrack to an earlier sentence" -- intentionally
    // changed. Reported directly, twice, from live use: once for a
    // coincidental match during off-script ad-libbing (see the test
    // above), and again for exactly the case this used to test for on
    // purpose -- deliberately re-reading an earlier line word-for-word
    // (e.g. reading the opening again after finishing the whole speech)
    // still yanked the display backward, ruining the flow just the same.
    // Both reports land on the same real requirement: once a paragraph has
    // been delivered, automatic speech-matching must never move the
    // display behind it again, no matter how confident the match looks.
    // (A presenter who deliberately wants to revisit an earlier line has
    // Reset, or Offline Reading's tap-to-jump gesture, for that -- this is
    // specifically about what automatic matching is allowed to do alone.)
    const engine = new SyncEngine(script);
    speak(engine, "We have been best friends since the third grade and I have seen her through everything".split(" "));
    speak(engine, "Tonight is not about the past though".split(" "));
    const highWaterSentence = engine.getState().sentenceIndex;

    // Word-for-word repeat of sentence 2 -- previously detected as a
    // deliberate backtrack and followed; must now be refused outright.
    speak(engine, "We have been best friends since the third grade".split(" "));
    expect(engine.getState().sentenceIndex).toBe(highWaterSentence);
  });

  it("does not regress even after finishing the whole script and then reading the opening line again", () => {
    // The exact manual test that surfaced this: read all the way through,
    // then try the first paragraph again -- must hold at the end, not jump
    // back to the beginning.
    const engine = new SyncEngine(script);
    speak(
      engine,
      "Good evening everyone and thank you for being here tonight When Sarah first told me she was getting married I honestly did not believe her We have been best friends since the third grade and I have seen her through everything Tonight is not about the past though It is about the future she is building with James So please raise your glass and join me in wishing them a lifetime of happiness"
        .split(" ")
    );
    const highWater = engine.getState();
    expect(highWater.cursorTokenIndex).toBe(highWater.totalTokens - 1);

    speak(engine, "Good evening everyone and thank you for being here tonight".split(" "));
    const after = engine.getState();
    expect(after.cursorTokenIndex).toBe(highWater.cursorTokenIndex);
    expect(after.sentenceIndex).toBe(highWater.sentenceIndex);
  });

  it("tolerates minor misrecognition via fuzzy matching", () => {
    const engine = new SyncEngine(script);
    speak(engine, "When Sarah first told me she was getting marreid I honestly did not beleive".split(" "));
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

  it("expandSpokenWord splits a negation contraction into its full-form parts", () => {
    expect(expandSpokenWord("didn't")).toEqual(["did", "not"]);
    expect(expandSpokenWord("Didn't")).toEqual(["did", "not"]);
    expect(expandSpokenWord("wasn't")).toEqual(["was", "not"]);
  });

  it("expandSpokenWord splits an is/are/will/have contraction too (not just negations)", () => {
    // Real capture from live testing: the script says "she is building"
    // (two words), but Deepgram transcribed "she's building" -- the same
    // class of mismatch as "didn't"/"did not", just a different
    // contraction family that an earlier fix missed entirely.
    expect(expandSpokenWord("she's")).toEqual(["she", "is"]);
    expect(expandSpokenWord("we're")).toEqual(["we", "are"]);
    expect(expandSpokenWord("i'll")).toEqual(["i", "will"]);
    expect(expandSpokenWord("they've")).toEqual(["they", "have"]);
  });

  it("expandSpokenWord leaves ordinary words and genuine possessives unchanged", () => {
    expect(expandSpokenWord("married")).toEqual(["married"]);
    // "Sarah's"/"James's" are possessives, not contractions -- must stay
    // one token, matching how the script itself would tokenize them.
    expect(expandSpokenWord("Sarah's")).toEqual(["Sarah's"]);
  });

  it("does not misalign when speech contracts a word the script wrote in full (real Deepgram behavior found in live testing)", () => {
    // Real capture from live testing: the script says "did not" (two
    // words), but Deepgram transcribed the spoken audio as "didn't" (one
    // word). Feeding that straight in, unexpanded, shifts every later
    // word one position out of alignment -- the same class of bug as the
    // duplicate-word case, just a missing token instead of an extra one.
    const engine = new SyncEngine(script);
    "When Sarah first told me she was getting married I honestly"
      .split(" ")
      .forEach((w) => engine.ingestWord(w));
    expandSpokenWord("didn't").forEach((w) => engine.ingestWord(w));
    speak(engine, "believe her".split(" "));
    expect(engine.getState().frozen).toBe(false);
    expect(engine.getState().sentenceIndex).toBe(2);
  });

  it("does not misalign on an is/are/will/have contraction either (the 'she's' case from live testing)", () => {
    const engine = new SyncEngine(script);
    "Tonight is not about the past though It is about the future"
      .split(" ")
      .forEach((w) => engine.ingestWord(w));
    expandSpokenWord("she's").forEach((w) => engine.ingestWord(w));
    speak(engine, "building with James".split(" "));
    expect(engine.getState().frozen).toBe(false);
    // Completes sentence 4 exactly ("...building with James."), so the
    // anticipatory-highlight behavior correctly shows sentence 5 as next.
    expect(engine.getState().sentenceIndex).toBe(5);
  });

  describe("isDistinctiveToken", () => {
    it("flags camelCase, snake_case, digits, and acronyms as distinctive", () => {
      expect(isDistinctiveToken("MirrorID")).toBe(true);
      expect(isDistinctiveToken("mirror_id")).toBe(true);
      expect(isDistinctiveToken("GPT4")).toBe(true);
      expect(isDistinctiveToken("API")).toBe(true);
    });

    it("does not flag ordinary English words just for being long or sentence-initial", () => {
      expect(isDistinctiveToken("though")).toBe(false);
      expect(isDistinctiveToken("trademark")).toBe(false);
      expect(isDistinctiveToken("Tonight")).toBe(false);
    });
  });

  it("tolerates a mangled jargon/brand term without freezing, where the same 3-of-6 match ratio would otherwise fall short (real-world finding: users will paste scripts full of invented product/technical terms)", () => {
    // A window's overall match ratio can land below the default 0.6
    // threshold even when every ordinary word around it agrees, purely
    // because of one recognizer-mangled jargon/brand term -- confirmed
    // via live testing on a script full of an invented term ("MirrorID")
    // transcribed inconsistently. scoreCandidate relaxes the threshold to
    // 0.5 specifically for a window containing such a term.
    const jargonScript = "Our internal codename for this project is MirrorID.";
    const engine = new SyncEngine(jargonScript, { freezeAfterMs: 200 });
    speak(engine, "Our internal".split(" "));
    expect(engine.getState().frozen).toBe(false);

    // Two early words mis-heard, "this"/"project"/"is" heard correctly,
    // and "MirrorID" itself mangled -- exactly 3 of 6 in the window
    // (0.5), with the window containing the jargon term.
    speak(engine, ["wrongone", "wrongtwo", "this", "project", "is", "mirroridtypo"]);
    expect(engine.getState().frozen).toBe(false);
    // `frozen` alone can't prove the match actually succeeded -- this test
    // runs synchronously, so the freeze clock never has real elapsed time
    // to trip regardless of whether matching worked. The cursor actually
    // reaching the script's last token is the real proof the mangled
    // jargon term didn't stall tracking.
    expect(engine.getState().cursorTokenIndex).toBe(7);
  });

  describe("normalize -- non-Latin scripts and accented Latin", () => {
    it("no longer strips a non-Latin word down to nothing (found via accessibility review)", () => {
      // The old filter (`[^a-z0-9']`) matched only ASCII, so any non-Latin
      // word normalized to "" -- and tokenizeScript() drops empty-normalized
      // tokens entirely, making the word permanently invisible to the
      // matcher even though the script still displayed it.
      expect(normalize("日本語")).not.toBe("");
      expect(normalize("שלום")).not.toBe("");
      expect(normalize("Привет")).not.toBe("");
    });

    it("a script containing non-Latin names still tokenizes them, instead of silently dropping them", () => {
      const { tokens } = tokenizeScript("Please welcome our guest of honor, 田中さん, to the stage.");
      const rawWords = tokens.map((t) => t.raw);
      expect(rawWords).toContain("田中さん,");
    });

    it("strips accents from Latin letters so a plain-ASCII STT guess still fuzzy-matches", () => {
      expect(normalize("café")).toBe("cafe");
      expect(normalize("naïve")).toBe("naive");
      expect(normalize("José")).toBe("jose");
      expect(normalize("François")).toBe("francois");
      expect(normalize("Zoë")).toBe("zoe");
    });

    it("tracks through a script with accented names even when the recognizer transcribes them as plain ASCII", () => {
      const engine = new SyncEngine("Please welcome José and François to the stage.");
      speak(engine, "Please welcome jose and francois to the stage".split(" "));
      const state = engine.getState();
      expect(state.frozen).toBe(false);
      expect(state.cursorTokenIndex).toBe(state.totalTokens - 1);
    });
  });
});
