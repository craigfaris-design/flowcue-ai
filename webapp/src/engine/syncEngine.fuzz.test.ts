import { describe, it, expect } from "vitest";
import { SyncEngine, tokenizeScript, expandSpokenWord } from "./syncEngine";

/**
 * Fuzz/property-based testing for the sync engine.
 *
 * Every bug fixed earlier this session (duplicated words, merged
 * contractions, fabricated stray words, mangled jargon) was found the slow
 * way: a human reading a script out loud, hitting a specific real-world STT
 * artifact, and reporting it. This harness generates hundreds of randomized
 * combinations of those same artifact *types* programmatically and checks
 * one invariant: given a script read start-to-finish with realistic noise
 * injected, does the engine's cursor still reach the end?
 *
 * This does NOT replace live testing -- it can't catch real STT accuracy,
 * network latency, or actual mic/device behavior. It only stress-tests the
 * matching *algorithm* against far more combinations than a person could
 * read aloud in a session, so future edge cases in the algorithm itself
 * surface as a failing test with an exact reproducible word sequence,
 * instead of waiting for someone to hit them live.
 *
 * Deterministic: every trial is seeded, so a failure is always reproducible
 * (the failure message includes the seed and the exact corrupted sequence)
 * and CI never flakes.
 */

// Small, dependency-free seeded PRNG (mulberry32) -- deterministic across
// runs/machines, unlike Math.random().
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// Ordinary filler words for fabricated insertions/substitutions -- deliberately
// mundane so they don't accidentally resemble script content.
const RANDOM_WORDS = [
  "banana",
  "purple",
  "somehow",
  "yesterday",
  "quickly",
  "window",
  "orbit",
  "cactus",
  "whisper",
  "gravel",
  "lantern",
  "occur",
  "mumble",
  "pocket",
  "circuit",
];

const JARGON_WORDS = ["MirrorID", "mirror_id", "GPT4", "OAuth2", "webhookURL"];

// Reverse map of the engine's own contraction table, so corruption can
// realistically merge "did"+"not" -> "didn't" the same way real speech (or
// Deepgram's smart_format) does -- built once by expanding a few known
// contractions rather than hand-duplicating the pairs.
const CONTRACTION_PAIRS: Array<[string, string, string]> = [
  ["did", "not", "didn't"],
  ["does", "not", "doesn't"],
  ["is", "not", "isn't"],
  ["was", "not", "wasn't"],
  ["she", "is", "she's"],
  ["he", "is", "he's"],
  ["it", "is", "it's"],
  ["they", "are", "they're"],
  ["we", "are", "we're"],
  ["will", "not", "won't"],
];

interface CorruptionOptions {
  /** Probability, per real word, of each artifact type independently. */
  dropRate: number;
  duplicateRate: number;
  strayInsertRate: number;
  substituteRate: number;
  contractRate: number;
  jargonRate: number;
  /**
   * Probability of swapping a word with the *next* word (transposition) --
   * a real stutter/self-correction pattern ("the cat sat" -> "the sat cat")
   * distinct from a stray insertion or substitution: no word is added,
   * dropped, or altered, just reordered. Modeled separately from the other
   * rates below because it needs to consume two words atomically (so it
   * can't just be folded into the per-word loop the way substitute/duplicate
   * are) -- see the swap handling in corruptWords().
   */
  swapRate: number;
}

const MODERATE_NOISE: CorruptionOptions = {
  dropRate: 0.04,
  duplicateRate: 0.04,
  strayInsertRate: 0.04,
  substituteRate: 0.06,
  contractRate: 0.5, // applied only when an eligible adjacent pair is found
  jargonRate: 0.3, // applied only to tokens that are already jargon-like
  swapRate: 0.03,
};

// Roughly double every rate -- this is well beyond what a real, mostly-fluent
// speaker/STT pairing produces (nearly 1-in-3 words touched by some
// artifact). Not meant to pass at a high bar: it's here to characterize
// *how* the engine degrades under genuinely severe noise, and specifically
// to catch a catastrophic collapse (near-0% success) that would indicate a
// real bug, as opposed to the graceful, partial degradation expected here.
const HEAVY_NOISE: CorruptionOptions = {
  dropRate: 0.09,
  duplicateRate: 0.08,
  strayInsertRate: 0.08,
  substituteRate: 0.12,
  contractRate: 0.7,
  jargonRate: 0.5,
  swapRate: 0.06,
};

// Simulates a fuzzy STT misrecognition: alter a couple of letters rather
// than substituting a wholly unrelated word, so it's sometimes still
// fuzzy-matchable (as real misrecognitions often are) and sometimes not.
function nearMiss(rng: () => number, word: string): string {
  if (word.length < 4) return pick(rng, RANDOM_WORDS);
  const chars = word.split("");
  const pos = Math.floor(rng() * chars.length);
  chars[pos] = pick(rng, "aeioubdgkmnprst".split(""));
  return chars.join("");
}

/**
 * Walks the real word sequence and emits a corrupted version: drops, stray
 * insertions, adjacent duplicates, misrecognition-like substitutions, and
 * contraction-merging, each independently randomized per word.
 */
function corruptWords(words: string[], rng: () => number, opts: CorruptionOptions): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    // Contraction merge: look ahead for a known adjacent pair.
    if (i + 1 < words.length) {
      const pair = CONTRACTION_PAIRS.find(
        ([a, b]) => a === words[i].toLowerCase() && b === words[i + 1].toLowerCase()
      );
      if (pair && rng() < opts.contractRate) {
        out.push(pair[2]);
        i += 2;
        continue;
      }
    }

    // Adjacent transposition: "the cat sat" -> "the sat cat", a genuine
    // stutter/self-correction pattern (a speaker catching themselves
    // mid-word-order and re-saying it in swapped order), not simulated by
    // any of the other artifact types -- drop/duplicate/substitute/stray-insert
    // all preserve relative word order otherwise. Excluded whenever the pair
    // would include the script's literal last word, for the same reason
    // drops exclude it: swapping the final word out of the final position
    // would make "reaches the end" (cursor landing on the last token)
    // require the matcher to somehow still end there despite the true last
    // word arriving *before* its predecessor, which isn't a matching
    // failure to catch, just an artifact of how "reached the end" is
    // defined for this harness. NOTE: an earlier version of this check used
    // `i + 2 < words.length`, which reads as "protect the last two words"
    // but actually still permitted swapping (words.length-3, words.length-2)
    // -- i.e. displacing the *second-to-last* word into third-to-last and
    // vice versa, one step short of the true guarantee needed. That let a
    // corrupted trigram immediately preceding the (untouched) final word
    // reach the matcher, which is fine in general but turned out to
    // reliably break alignment on a script with a repeated refrain (the
    // "poetry" script's dedicated fuzz test): the corrupted tail no longer
    // fuzzy-matched the correct occurrence well enough, while looking just
    // as plausible as one of the refrain's earlier occurrences, so the
    // engine reasonably matched an earlier one instead. `i + 1 < words.length - 1`
    // is the tight version: it only forbids the pair that would move the
    // literal last word, exactly mirroring the drop exclusion above.
    if (i + 1 < words.length - 1 && rng() < opts.swapRate) {
      out.push(words[i + 1], words[i]);
      i += 2;
      continue;
    }

    const word = words[i];
    const isJargonLike = /[a-z][A-Z]|_|\d/.test(word);

    // Dropping the script's literal last word makes "the cursor reaches
    // the end" impossible for any algorithm -- that word's audio was
    // simply never represented, which isn't a matcher failure to catch.
    const isLastWord = i === words.length - 1;
    if (!isLastWord && rng() < opts.dropRate) {
      // Word never recognized at all -- emit nothing for it.
      i++;
      continue;
    }

    if (isJargonLike && rng() < opts.jargonRate) {
      out.push(nearMiss(rng, word));
    } else if (rng() < opts.substituteRate) {
      out.push(nearMiss(rng, word));
    } else {
      out.push(word);
    }

    if (rng() < opts.duplicateRate) out.push(out[out.length - 1]);
    if (rng() < opts.strayInsertRate) out.push(pick(rng, i % 2 === 0 ? RANDOM_WORDS : JARGON_WORDS));

    i++;
  }
  return out;
}

const SCRIPTS = {
  toast: [
    "Good evening, everyone, and thank you for being here tonight.",
    "When Sarah first told me she was getting married, I honestly did not believe her.",
    "We have been best friends since the third grade, and I have seen her through everything.",
    "Tonight is not about the past, though. It is about the future she is building with James.",
    "So please raise your glass and join me in wishing them a lifetime of happiness.",
  ].join("\n"),
  jargonHeavy: [
    "For example, there is a package called mirror_id used by several developer systems.",
    "I did not find an obvious major company called MirrorID building the same product.",
    "There is an academic project focused on identity preserved generation, although it isn't called MirrorID.",
    "A proper trademark search needs to examine relevant classes and jurisdictions, especially software.",
  ].join("\n"),
  legalJargon: [
    "This agreement is entered into between AcmeCorp and the counterparty referenced in Exhibit A.",
    "Neither party shall be liable for delay caused by a force majeure event beyond its reasonable control.",
    "The indemnifying party agrees to defend and hold harmless the other party under Section 4.2.b of this agreement.",
    "All confidential information disclosed under this NDA remains the property of the disclosing party.",
    "This clause survives termination and governs any dispute arising under the jurisdiction specified in Schedule C.",
    "Nothing in this agreement shall be construed as granting a license to any IP not expressly listed herein.",
  ].join("\n"),
  medicalJargon: [
    "The patient was prescribed a starting dose of twenty five milligrams of lisinopril once daily.",
    "Doctor Alvarez noted mild tachycardia but no signs of arrhythmia during the echocardiogram.",
    "We recommend a follow up with the endocrinologist to reassess the hemoglobin A1C levels next quarter.",
    "The attending physician documented no known allergies and cleared the patient for the outpatient procedure.",
    "Please continue the metformin regimen and monitor for any signs of gastrointestinal discomfort.",
  ].join("\n"),
  longFormal: [
    "Good afternoon, and thank you all for joining us for this year's annual shareholder briefing.",
    "Over the past twelve months, our engineering organization shipped more releases than in the previous two years combined.",
    "Revenue grew by thirty four percent year over year, driven primarily by expansion in our enterprise segment.",
    "We also saw a meaningful improvement in gross margin, which climbed from sixty one percent to sixty eight percent.",
    "None of this would have been possible without the dedication of every single person across this organization.",
    "Turning now to our product roadmap, we plan to invest heavily in three strategic areas over the coming year.",
    "The first is platform reliability, where our goal is to reduce unplanned downtime by more than half.",
    "The second is international expansion, starting with localized offerings for our customers in Germany and Japan.",
    "The third, and perhaps most exciting, is a significant investment in our machine learning infrastructure.",
    "We believe these investments position us extremely well heading into a more competitive landscape next year.",
    "On the people side, we grew headcount by twenty two percent while maintaining our voluntary attrition rate below industry average.",
    "I want to specifically thank our customer success team, who maintained a net promoter score above seventy throughout the year.",
    "Looking ahead, we remain cautiously optimistic about macroeconomic conditions but are planning conservatively for the next two quarters.",
    "Our balance sheet remains strong, with more than eighteen months of runway even under a conservative growth scenario.",
    "We are also excited to announce a new partnership that we believe will meaningfully accelerate our distribution strategy.",
    "Before I hand things over for questions, I want to reiterate how proud I am of what this team accomplished.",
    "None of our progress happens without the trust our customers place in us every single day.",
    "So thank you again for being here, for your continued support, and for believing in where we are headed.",
    "With that, I will open the floor to questions from the board and from our investors joining remotely.",
  ].join("\n"),
  // Speaker-name prefixes ("MAYA:") and parenthetical stage directions read
  // as ordinary tokens to the tokenizer -- nobody speaks "MAYA colon" aloud,
  // but a real user rehearsing a screenplay would skip straight to their own
  // line's dialogue, meaning the *previous* speaker's whole line (name prefix
  // included) is effectively a block the engine must skip over/through, not
  // unlike an ad-lib aside. This script exercises that shape of content, not
  // literal spoken-stage-direction realism.
  screenplay: [
    "INT. LIVING ROOM - NIGHT",
    "MAYA: I told you already, I am not going back there.",
    "DEREK: You always say that.",
    "MAYA: This time I mean it.",
    "DEREK: Fine. Then let us talk about what happens next.",
    "MAYA: There is nothing left to talk about, Derek.",
    "DEREK: There is always something left to talk about.",
    "MAYA: Not tonight. I am done talking for tonight.",
  ].join("\n"),
  // Numbers, dates, times, and addresses spoken naturally -- a distinct STT
  // failure mode from ordinary jargon: Deepgram's smart_format renders these
  // as compact tokens ("2:30pm", "555-0142") that normalize() strips down to
  // plain digit runs, so a near-miss substitution or a dropped digit changes
  // the *meaning* of the token a lot while barely changing its edit distance.
  numbersAndAddresses: [
    "Please join us on March 3rd at 2:30pm for the ribbon cutting ceremony.",
    "The new office is located at 1234 Main Street, Suite 200.",
    "If you have questions before then, call 555-0142 or email the front desk.",
    "Doors open at 9:00am and the program runs until roughly 11:45am.",
    "We expect around 350 guests, with parking available at 500 Oak Avenue.",
  ].join("\n"),
  // A multicultural wedding toast full of non-English proper nouns -- these
  // are exactly the kind of long, unusual-shaped word isDistinctiveToken()
  // was NOT designed to relax the threshold for (no digits/camelCase/
  // underscores/all-caps), yet they're just as likely to be misrecognized by
  // a generic STT model as invented jargon is. Checks whether that gap is a
  // real problem in practice or already covered by ordinary fuzzy matching.
  multiculturalNames: [
    "We are so grateful to celebrate Siobhan and Nikhil today, surrounded by family from three continents.",
    "Siobhan grew up in County Clare, while Nikhil was raised between Mumbai and Nairobi.",
    "Nikhil's mentor, a teppanyaki chef named Tsuyoshi Yamamoto, flew in just for this weekend.",
    "To Siobhan's parents, Aoife and Padraig, thank you for welcoming Nikhil into your family with open arms.",
    "And to Nikhil's grandmother, Saraswati, who traveled the farthest of anyone here, we are honored by your presence.",
    "Please raise a glass to Siobhan and Nikhil, and to Xiomara and Wojciech, who introduced them in the first place.",
  ].join("\n"),
  // Poetry/song lyrics with a refrain repeated three times, spaced apart --
  // a harder version of the two-occurrence repeated-phrase case already
  // covered in syncEngine.stress.test.ts ("biases toward the nearer
  // occurrence"). With three occurrences, noise can plausibly make the
  // engine land on the *first* or *middle* one instead of the correct
  // (nearest-to-current-position) one, which corruptWords()'s noise doesn't
  // specifically target but should still survive incidentally.
  poetry: [
    "We rise again when morning comes.",
    "We rise again, we rise again.",
    "The night was long, the road was hard.",
    "We rise again when morning comes.",
    "We rise again, we rise again.",
    "A thousand steps behind us now.",
    "We rise again when morning comes.",
    "We rise again, we rise again.",
  ].join("\n"),
  // Under 20 words, and under the default matchWindowSize (6) times two --
  // checks the engine doesn't misbehave when the *entire script* is barely
  // bigger than one match window (ingestWord doesn't even attempt a search
  // until the buffer holds 3 words, and searchRange clamps its upper bound
  // to `tokens.length - spokenBuffer.length`, which goes negative for a
  // script shorter than the buffer -- worth confirming that clamp holds up
  // for a script this small rather than just assuming it from reading the code).
  short: "Thank you all so much for coming tonight. It means the world to us.",
  // Heavy abbreviations/acronyms and unusual punctuation ("e.g.", "i.e.",
  // "Dr.", "vs.", parenthetical asides, em-dashes). tokenizeScript() splits
  // sentences on ".!?" followed by whitespace, so "Dr. Chen" and "e.g.
  // supply" each end up splitting into extra (short) sentences at the
  // tokenizer level -- not a bug, just a quirk of this content type worth
  // covering, since a real user's uploaded script (meeting notes, an
  // annotated speech) is exactly this shape.
  abbreviations: [
    "Dr. Chen, our keynote speaker, will cover a few topics -- e.g. supply chains, i.e. logistics writ large.",
    "This talk runs roughly 45 min. vs. the usual 60, so please hold questions until the end.",
    "As Prof. Alvarez likes to say (and I am paraphrasing here), timing is everything.",
  ].join("\n"),
};

function wordsOf(scriptText: string): string[] {
  return tokenizeScript(scriptText).tokens.map((t) => t.raw);
}

function runTrial(scriptText: string, seed: number, opts: CorruptionOptions) {
  const rng = mulberry32(seed);
  const realWords = wordsOf(scriptText);
  const corrupted = corruptWords(realWords, rng, opts);

  const engine = new SyncEngine(scriptText);
  corrupted.forEach((w) => expandSpokenWord(w).forEach((piece) => engine.ingestWord(piece)));

  const state = engine.getState();
  const reachedEnd = state.cursorTokenIndex >= state.totalTokens - 1;
  return { reachedEnd, corrupted, cursor: state.cursorTokenIndex, total: state.totalTokens };
}

// Trial count and timeout per script -- the ~300-word longFormal script
// costs noticeably more per trial than the shorter ones (more words fed
// through the same per-word candidate search), so it uses fewer trials
// and a longer timeout rather than slowing every script down to match it.
const SCRIPT_RUN_CONFIG: Record<string, { trials: number; timeoutMs: number }> = {
  toast: { trials: 150, timeoutMs: 30000 },
  jargonHeavy: { trials: 150, timeoutMs: 30000 },
  legalJargon: { trials: 150, timeoutMs: 30000 },
  medicalJargon: { trials: 150, timeoutMs: 30000 },
  longFormal: { trials: 60, timeoutMs: 45000 },
  // New scripts below are similar in length to toast/jargonHeavy (or
  // shorter), so they'd default to 150 trials -- trimmed to keep this
  // session's ~15s-per-new-script budget rather than blindly matching the
  // existing scripts' trial count, since each additional script is pure
  // additive runtime on top of an already-~90s suite.
  screenplay: { trials: 100, timeoutMs: 20000 },
  numbersAndAddresses: { trials: 100, timeoutMs: 20000 },
  multiculturalNames: { trials: 100, timeoutMs: 20000 },
  poetry: { trials: 100, timeoutMs: 20000 },
  short: { trials: 100, timeoutMs: 20000 },
  abbreviations: { trials: 100, timeoutMs: 20000 },
};

describe("SyncEngine fuzz testing", () => {
  const MIN_SUCCESS_RATE = 0.9;

  for (const [name, scriptText] of Object.entries(SCRIPTS)) {
    const { trials, timeoutMs } = SCRIPT_RUN_CONFIG[name] ?? { trials: 150, timeoutMs: 30000 };

    it(
      `reaches the end of the "${name}" script in at least ${Math.round(
        MIN_SUCCESS_RATE * 100
      )}% of ${trials} randomized noisy read-throughs`,
      () => {
        const failures: Array<{ seed: number; corrupted: string[]; cursor: number; total: number }> = [];
        let successes = 0;

        for (let seed = 1; seed <= trials; seed++) {
          const result = runTrial(scriptText, seed, MODERATE_NOISE);
          if (result.reachedEnd) {
            successes++;
          } else {
            failures.push({ seed, corrupted: result.corrupted, cursor: result.cursor, total: result.total });
          }
        }

        const successRate = successes / trials;
        if (successRate < MIN_SUCCESS_RATE) {
          // Surface a couple of concrete failing sequences (seed + exact
          // corrupted words) so any real regression is directly reproducible
          // as a dedicated test, the same way every other fix this session
          // started from one real captured sequence.
          const sample = failures
            .slice(0, 3)
            .map((f) => `seed ${f.seed} (cursor ${f.cursor}/${f.total - 1}): ${f.corrupted.join(" ")}`)
            .join("\n");
          throw new Error(
            `Success rate ${(successRate * 100).toFixed(1)}% is below the ${
              MIN_SUCCESS_RATE * 100
            }% floor (${failures.length}/${trials} failed).\nSample failing sequences:\n${sample}`
          );
        }

        expect(successRate).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE);
      },
      timeoutMs
    );
  }

  it("never advances on pure unrelated noise (still refuses to guess, even under fuzzing)", () => {
    // The flip side of "must reach the end despite noise": feeding words
    // that share nothing with the script at all must never produce a
    // false match, at any seed. Uses only long, distinctive-looking noise
    // words -- short common words are covered by the dedicated ad-lib test
    // in syncEngine.stress.test.ts.
    const rng = mulberry32(99);
    for (let trial = 0; trial < 50; trial++) {
      const engine = new SyncEngine(SCRIPTS.toast);
      const noise = Array.from({ length: 12 }, () => pick(rng, RANDOM_WORDS));
      noise.forEach((w) => engine.ingestWord(w));
      expect(engine.getState().cursorTokenIndex).toBe(-1);
    }
  });

  it(
    "degrades gracefully (not catastrophically) under heavy noise, well beyond realistic conditions",
    () => {
      // Roughly a third of words touched by some artifact -- worse than any
      // real speaker/STT pairing should produce. Not asserting a high bar
      // here (some genuine failures under this much noise are expected and
      // fine); asserting there's no *collapse* to near-zero, which would
      // signal a real bug rather than expected degradation.
      const MIN_HEAVY_SUCCESS_RATE = 0.4;

      for (const [name, scriptText] of Object.entries(SCRIPTS)) {
        // longFormal (~300 words) costs much more per trial than the
        // shorter scripts -- fewer trials for it keeps this test's total
        // runtime reasonable without weakening the signal for the rest.
        const trials = name === "longFormal" ? 25 : 100;
        let successes = 0;
        for (let seed = 1; seed <= trials; seed++) {
          if (runTrial(scriptText, seed, HEAVY_NOISE).reachedEnd) successes++;
        }
        const rate = successes / trials;
        expect(rate, `"${name}" collapsed to ${(rate * 100).toFixed(1)}% under heavy noise`).toBeGreaterThanOrEqual(
          MIN_HEAVY_SUCCESS_RATE
        );
      }
    },
    90000
  );
});
