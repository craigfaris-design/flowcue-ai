/**
 * FlowCue AI -- Real-Time Speech-Following Sync Engine.
 *
 * Given a reference script (tokenized into words) and a live stream of recognized
 * speech tokens, tracks the speaker's current position in the script. Designed to
 * recover automatically from pauses, skips, repeats, backtracking, and minor
 * misrecognition, per the FlowCue AI PRD (section 5).
 *
 * TypeScript port of the original browser-JS reference implementation, with the
 * same windowed-alignment approach described in the Technical Architecture doc
 * (section 3). Runs entirely client-side (the "on-device" path of the hybrid
 * architecture) -- no network dependency.
 */

export interface ScriptToken {
  raw: string;
  norm: string;
  sentenceIndex: number;
  globalIndex: number;
}

export interface TokenizedScript {
  sentences: string[];
  tokens: ScriptToken[];
}

export interface SyncEngineOptions {
  nearWindowBefore?: number;
  nearWindowAfter?: number;
  matchWindowSize?: number;
  confidenceThreshold?: number;
  freezeAfterMs?: number;
}

export interface SyncState {
  cursorTokenIndex: number;
  sentenceIndex: number;
  frozen: boolean;
  totalTokens: number;
  totalSentences: number;
  /**
   * The match ratio (0-1) of the most recent successful match -- 0 before
   * any match has ever happened. Powers the "Confidence colors" visual
   * mode, giving the presenter direct feedback on how cleanly they're
   * being tracked rather than just a binary "frozen or not."
   */
  confidence: number;
}

const DEFAULT_OPTIONS: Required<SyncEngineOptions> = {
  nearWindowBefore: 4,
  nearWindowAfter: 45,
  matchWindowSize: 6,
  // The baseline bar a candidate's overall match ratio must clear.
  // scoreCandidate() relaxes this dynamically for windows containing a
  // long/distinctive word (see hasDistinctiveToken) -- lowering it flatly
  // here was tried and reverted: it let ad-lib content built from short,
  // high-frequency words (see the dedicated ad-lib-drift test) coincidentally
  // clear it too, which this threshold exists specifically to prevent.
  confidenceThreshold: 0.6,
  // How long words can arrive without a confident match before the UI
  // shows "holding position." Silence itself never starts this clock (see
  // unmatchedStreakStartAt), but a real-world pattern this was still too
  // quick for: starting a new paragraph after a natural breath/pause --
  // the recognizer finalizing a fresh utterance there sometimes mismatches
  // the first word or two before locking on, which used to be enough to
  // cross 2000ms and flash the notice on essentially every paragraph
  // (reported directly from live use). Raised to give that self-correcting
  // hiccup room to resolve before the UI says anything, while still
  // catching sustained drift (real ad-libs) within a few seconds.
  freezeAfterMs: 3200,
};

// Was `[^a-z0-9']`, which silently deleted every character of a non-Latin
// word (Hebrew, Arabic, CJK, etc.) down to an empty string -- and
// tokenizeScript() drops any token whose normalized form is empty, so
// those words were permanently invisible to the matcher even though the
// script still displayed them (found via accessibility review). Widened
// to any Unicode letter or digit (needs the `u` flag for \p{L}/\p{N}) so
// they survive as their own token instead of vanishing outright.
const NON_WORD_CHARS = /[^\p{L}\p{N}']/gu;
// Matches the Unicode "Combining Diacritical Marks" block (U+0300-U+036F)
// that NFD decomposition below splits accented Latin letters into --
// e.g. "e" + U+0301 (combining acute accent) instead of the single
// precomposed "é". Stripping this range after NFD is what turns "café"
// into plain "cafe".
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalize(word: string): string {
  // Diacritics on Latin letters (café, naïve, José, François) are stripped
  // to their plain-ASCII base letter -- separate from widening the filter
  // above -- since STT commonly transliterates proper nouns/loanwords to
  // plain ASCII, and wordsMatch's fuzzy prefix/suffix comparison works
  // better against the same plain form on both sides than comparing an
  // accented script literal to an unaccented recognizer guess.
  const deaccented = word.normalize("NFD").replace(COMBINING_MARKS, "");
  return deaccented.toLowerCase().replace(NON_WORD_CHARS, "").trim();
}

// Found via live testing: a script written in full form ("did not", "she
// is") can get transcribed as its contraction ("didn't", "she's") --
// either the speaker naturally contracted it, or Deepgram's smart_format
// rendered it that way. Either way, that's one spoken token where the
// script has two, which shifts every following word out of alignment
// exactly like the duplicate-word case already fixed, just in reverse.
// Expanding common contractions in the *spoken* stream (not the script)
// before it reaches the buffer keeps token counts aligned with scripts
// written in full form, which is the common case for prepared
// speeches/toasts. This is an explicit lookup table, not a generic "any
// word ending in 's/'d/'ll" rule, specifically so it never touches a
// genuine possessive ("Sarah's", "James's") -- those aren't contractions
// and must stay as one token, matching the script.
//
// A few of these ('s, 'd) are genuinely ambiguous (is/has, would/had) --
// picking the more common spoken-English reading is still strictly better
// than leaving the token count wrong, since the fuzzy matcher only needs
// one of the two guessed words to land.
const CONTRACTION_EXPANSIONS: Record<string, [string, string]> = {
  // negation
  "didn't": ["did", "not"],
  "doesn't": ["does", "not"],
  "don't": ["do", "not"],
  "wasn't": ["was", "not"],
  "weren't": ["were", "not"],
  "isn't": ["is", "not"],
  "aren't": ["are", "not"],
  "haven't": ["have", "not"],
  "hasn't": ["has", "not"],
  "hadn't": ["had", "not"],
  "won't": ["will", "not"],
  "can't": ["can", "not"],
  "couldn't": ["could", "not"],
  "shouldn't": ["should", "not"],
  "wouldn't": ["would", "not"],
  "mightn't": ["might", "not"],
  "mustn't": ["must", "not"],
  // 's -- "is" (far more common in speech than the possessive-free "has" reading)
  "he's": ["he", "is"],
  "she's": ["she", "is"],
  "it's": ["it", "is"],
  "that's": ["that", "is"],
  "there's": ["there", "is"],
  "here's": ["here", "is"],
  "who's": ["who", "is"],
  "what's": ["what", "is"],
  "where's": ["where", "is"],
  "when's": ["when", "is"],
  "how's": ["how", "is"],
  "let's": ["let", "us"],
  // am/are
  "i'm": ["i", "am"],
  "we're": ["we", "are"],
  "you're": ["you", "are"],
  "they're": ["they", "are"],
  // will
  "i'll": ["i", "will"],
  "you'll": ["you", "will"],
  "he'll": ["he", "will"],
  "she'll": ["she", "will"],
  "it'll": ["it", "will"],
  "we'll": ["we", "will"],
  "they'll": ["they", "will"],
  "that'll": ["that", "will"],
  // 'd -- "would" (far more common in speech than "had")
  "i'd": ["i", "would"],
  "you'd": ["you", "would"],
  "he'd": ["he", "would"],
  "she'd": ["she", "would"],
  "it'd": ["it", "would"],
  "we'd": ["we", "would"],
  "they'd": ["they", "would"],
  // have
  "i've": ["i", "have"],
  "you've": ["you", "have"],
  "we've": ["we", "have"],
  "they've": ["they", "have"],
  "could've": ["could", "have"],
  "should've": ["should", "have"],
  "would've": ["would", "have"],
  "might've": ["might", "have"],
};

/** Splits a spoken contraction into its full-form parts (e.g. "didn't" -> ["did", "not"]) so it aligns with a script written in full form; returns the word unchanged if it isn't a known contraction. */
export function expandSpokenWord(rawWord: string): string[] {
  const expansion = CONTRACTION_EXPANSIONS[normalize(rawWord)];
  return expansion ? [...expansion] : [rawWord];
}

export function tokenizeScript(scriptText: string): TokenizedScript {
  const sentenceChunks = scriptText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const tokens: ScriptToken[] = [];
  sentenceChunks.forEach((sentence, sentenceIndex) => {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw) => {
      const norm = normalize(raw);
      if (!norm) return;
      tokens.push({ raw, norm, sentenceIndex, globalIndex: tokens.length });
    });
  });

  return { sentences: sentenceChunks, tokens };
}

// Cheap similarity check so minor misrecognition ("entrepreneur" vs "entreprenur")
// doesn't break alignment. Not a full edit-distance implementation -- just a fast,
// good-enough heuristic for short words.
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a.length < 4 || b.length < 4) return false;
  let prefix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(a.length, b.length) - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  return prefix + suffix >= Math.min(a.length, b.length) - 2;
}

// Signals an invented/brand/technical term ("MirrorID", "mirror_id") as
// opposed to an ordinary English word that just happens to be long
// ("though," "trademark") -- camelCase transitions, underscores, digits,
// and acronym-style all-caps runs are all things a generic word almost
// never has, but a made-up product/API name routinely does.
export function isDistinctiveToken(raw: string): boolean {
  if (/\d/.test(raw)) return true;
  if (raw.includes("_")) return true;
  if (/[a-z][A-Z]/.test(raw)) return true;
  const lettersOnly = raw.replace(/[^A-Za-z]/g, "");
  if (lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase()) return true;
  return false;
}

export class SyncEngine {
  readonly sentences: string[];
  readonly tokens: ScriptToken[];
  private opts: Required<SyncEngineOptions>;
  private cursor = -1;
  // Tracks how long words have been arriving *without* a confident match --
  // null means "not currently in an unmatched streak" (either nothing's
  // been spoken recently, or the last thing spoken matched fine). Freezing
  // is deliberately keyed off this, not off wall-clock silence: found via
  // live testing that a plain silence-duration freeze (the original design)
  // fires during completely ordinary pauses between sentences/paragraphs --
  // a reader taking a breath or a beat hasn't done anything wrong, so
  // nothing should look "lost" until they actually resume speaking and the
  // engine genuinely can't place the words.
  private unmatchedStreakStartAt: number | null = null;
  private lastMatchScore = 0;
  private spokenBuffer: string[] = [];
  // Last token's globalIndex per sentence, so getState() can tell "the
  // cursor just landed on the final word of its sentence" in O(1).
  private sentenceEndIndex: number[];

  constructor(scriptText: string, options?: SyncEngineOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    const { sentences, tokens } = tokenizeScript(scriptText);
    this.sentences = sentences;
    this.tokens = tokens;
    this.sentenceEndIndex = sentences.map(() => -1);
    tokens.forEach((t) => {
      this.sentenceEndIndex[t.sentenceIndex] = t.globalIndex;
    });
  }

  // All k-element index combinations from [0, n) -- n is at most
  // matchWindowSize (a handful of words), so this is always cheap.
  private static combinations(n: number, k: number): number[][] {
    const result: number[][] = [];
    const combo: number[] = [];
    function backtrack(start: number) {
      if (combo.length === k) {
        result.push([...combo]);
        return;
      }
      for (let i = start; i < n; i++) {
        combo.push(i);
        backtrack(i + 1);
        combo.pop();
      }
    }
    backtrack(0);
    return result;
  }

  // Scores one candidate alignment of the whole spoken buffer against
  // tokens starting at startIdx, given a mapping from buffer index to
  // token index (null means "this spoken word isn't compared to any
  // token" -- used for the single-stray-word case below).
  private alignmentScore(
    startIdx: number,
    tokenIndexFor: (i: number) => number | null
  ): { matches: number; recentMatches: number; lastTokenIdx: number } {
    const n = this.spokenBuffer.length;
    const recentCount = Math.min(3, n);
    let matches = 0;
    let recentMatches = 0;
    for (let i = 0; i < n; i++) {
      const tIdx = tokenIndexFor(i);
      const t = tIdx === null ? undefined : this.tokens[tIdx];
      const isMatch = !!t && wordsMatch(this.spokenBuffer[i], t.norm);
      if (isMatch) matches++;
      if (i >= n - recentCount && isMatch) recentMatches++;
    }
    return { matches, recentMatches, lastTokenIdx: tokenIndexFor(n - 1) ?? startIdx + n - 1 };
  }

  private scoreCandidate(startIdx: number): { score: number; lastTokenIdx: number } {
    const n = this.spokenBuffer.length;

    // At least 2 of the most recent 3 words spoken (or all-but-one, for a
    // shorter buffer) must plausibly match this candidate's implied
    // position, or it's disqualified outright. Without some recency
    // requirement, a candidate can look "confident" purely from stale words
    // earlier in the rolling buffer -- e.g. the tail end of words spoken
    // before an ad-lib began -- letting the cursor creep forward on an
    // ad-lib with nothing new actually recognized there. An earlier version
    // of this required literally the single freshest word to match, which
    // turned out too strict against ordinary speech-recognition noise: real
    // recognizers regularly misrecognize one isolated word even mid-sentence
    // (found via live testing -- it was disqualifying every candidate,
    // including the correct one, often enough to visibly freeze during
    // completely normal speech). Requiring 2-of-3 tolerates one isolated
    // miss without tolerating a genuine stretch of new/unrelated words.
    const recentCount = Math.min(3, n);
    const recentNeeded = Math.max(1, recentCount - 1);

    // Try the straightforward alignment, plus -- for every combination of
    // up to two positions -- spoken words skipped (stray/fabricated words,
    // e.g. a hallucinated "built" wedged in mid-sentence, or a stumbled
    // false start like "it is, isn't, isn't called") or script words
    // skipped (words the audio never actually produced clearly enough to
    // recognize), keeping whichever alignment matches the most overall.
    // Found via live testing to recur under several different-looking
    // guises (a duplicated word, a merged contraction, a fabricated extra
    // word, a real multi-word self-correction) often enough that waiting
    // for the culprit words to age out of the buffer -- which real speech,
    // unlike synthetic tests, doesn't do instantly -- can outlast the
    // freeze threshold. Tolerating up to two such skips handles all of
    // those the same way, instead of enumerating each pattern by hand as
    // new ones turn up.
    let best = this.alignmentScore(startIdx, (i) => startIdx + i);
    const maxSkips = Math.min(2, n - 1);
    for (let skipCount = 1; skipCount <= maxSkips; skipCount++) {
      for (const combo of SyncEngine.combinations(n, skipCount)) {
        const skipSet = new Set(combo);

        const skipSpoken = this.alignmentScore(startIdx, (i) => {
          if (skipSet.has(i)) return null;
          let before = 0;
          for (const k of skipSet) if (k < i) before++;
          return startIdx + i - before;
        });
        if (skipSpoken.matches > best.matches) best = skipSpoken;

        const skipScript = this.alignmentScore(startIdx, (i) => {
          let atOrBefore = 0;
          for (const k of skipSet) if (k <= i) atOrBefore++;
          return startIdx + i + atOrBefore;
        });
        if (skipScript.matches > best.matches) best = skipScript;
      }
    }

    if (best.recentMatches < recentNeeded) return { score: 0, lastTokenIdx: startIdx + n - 1 };

    // A generic-purpose STT model is far more likely to mangle an
    // uncommon/invented term (a brand name, technical jargon) than
    // ordinary words -- confirmed via live testing on a script full of
    // invented terms ("MirrorID") that got transcribed inconsistently
    // across repeats, with real console captures showing the recency gate
    // correctly passing at a genuine 0.5 overall ratio, only for the flat
    // 0.6 threshold to block it anyway. Relax the bar for a window that
    // contains such a term, since a coincidental match there is far less
    // likely than for short, high-frequency words -- and keep the full
    // threshold otherwise, since short common words matching by chance is
    // exactly the ad-lib-drift scenario this threshold guards against (see
    // the dedicated regression test for that). Tried a plain word-length
    // check first and reverted it: ordinary words ("though," "trademark")
    // are routinely 6+ letters too, so length alone re-triggered the
    // ad-lib false-positive -- see isDistinctiveToken for the actual signal.
    const threshold = this.hasDistinctiveToken(startIdx, n)
      ? Math.min(this.opts.confidenceThreshold, 0.5)
      : this.opts.confidenceThreshold;

    const score = best.matches / n;
    if (score < threshold) return { score: 0, lastTokenIdx: startIdx + n - 1 };
    return { score, lastTokenIdx: best.lastTokenIdx };
  }

  private hasDistinctiveToken(startIdx: number, n: number): boolean {
    for (let i = 0; i < n; i++) {
      const t = this.tokens[startIdx + i];
      if (t && isDistinctiveToken(t.raw)) return true;
    }
    return false;
  }

  // preferNear: when scores tie, keep whichever candidate is closer to this
  // token index rather than whichever was found first (i.e. earliest).
  // Matters specifically for the *full-script* fallback search below: found
  // via fuzz testing on a script with a repeated refrain ("we rise again...")
  // that a single stray/noise word arriving right as the cursor nears the
  // very end of the script collapses the near-window search to an empty
  // range (see the comment at the ingestWord() call site), which falls
  // through to this full-range search -- and without a nearest bias here,
  // an equally-good match against an *earlier* occurrence of the refrain won
  // out just because the scan reaches it first, yanking the cursor
  // backward by dozens of tokens on one bit of trailing noise. The
  // near-window search already has this bias implicitly, by construction
  // (it only ever looks near the cursor); this makes the same "nearer
  // occurrence wins" policy the Technical Architecture doc describes hold
  // for the full-script fallback too, instead of silently reverting to
  // "first occurrence" whenever that fallback is the one that fires.
  private searchRange(
    lo: number,
    hi: number,
    preferNear?: number
  ): { idx: number; score: number; lastTokenIdx: number } {
    let best = { idx: -1, score: 0, lastTokenIdx: -1 };
    const from = Math.max(0, lo);
    // Deliberately NOT clamped to `tokens.length - spokenBuffer.length` (a
    // full buffer-sized window fitting before the script ends) -- found via
    // fuzz testing on the tail of a script with a stray/inserted word within
    // matchWindowSize of the very end (e.g. "...classes and GPT4
    // jurisdictions, especially software." with "GPT4" fabricated): the
    // correct alignment there needs startIdx=50 with only 5 real tokens
    // remaining (50..54) for a 6-word buffer, which the stricter bound
    // excluded outright, so the true final words were never even considered
    // as a candidate and the cursor stalled one word short of the end.
    // scoreCandidate's skip-tolerant search already produces token indices
    // past the nominal `startIdx + n - 1` window in the skip-script case,
    // and alignmentScore already treats an out-of-range token index as "no
    // match" (this.tokens[tIdx] is safely undefined) rather than throwing --
    // so allowing startIdx up to the last valid token only widens what gets
    // *tried*, without changing how a bad candidate scores.
    const to = Math.min(this.tokens.length - 1, hi);
    for (let s = from; s <= to; s++) {
      const result = this.scoreCandidate(s);
      if (result.score <= 0) continue;
      const better =
        result.score > best.score ||
        (result.score === best.score &&
          preferNear !== undefined &&
          best.idx >= 0 &&
          Math.abs(s - preferNear) < Math.abs(best.idx - preferNear));
      if (better) best = { idx: s, score: result.score, lastTokenIdx: result.lastTokenIdx };
    }
    return best;
  }

  ingestWord(word: string): SyncState {
    const norm = normalize(word);
    if (!norm) return this.getState();

    // A recognizer occasionally hallucinates an immediate repeat of a word
    // (confirmed via live testing: Deepgram sent "not" twice in a row for
    // one spoken "not"). Left in, that extra word shifts every subsequent
    // word in the buffer one position out of alignment with the script,
    // and unlike synthetic tests -- where recovery words all arrive in the
    // same tick -- real speech arrives over actual seconds, so recovering
    // by waiting for the glitch to age out of the buffer can take longer
    // than the freeze threshold and show up as a spurious "Holding
    // position." Dropping an immediate duplicate before it enters the
    // buffer prevents the misalignment instead of recovering from it.
    if (this.spokenBuffer.length > 0 && this.spokenBuffer[this.spokenBuffer.length - 1] === norm) {
      return this.getState();
    }

    this.spokenBuffer.push(norm);
    if (this.spokenBuffer.length > this.opts.matchWindowSize) this.spokenBuffer.shift();
    if (this.spokenBuffer.length < Math.min(3, this.opts.matchWindowSize)) return this.getState();

    const nearLo = this.cursor - this.opts.nearWindowBefore;
    const nearHi = this.cursor + this.opts.nearWindowAfter;
    let best = this.searchRange(nearLo, nearHi);

    // scoreCandidate() already enforces its own (possibly per-candidate
    // relaxed) threshold internally and returns exactly 0 when a candidate
    // doesn't clear it -- so 0 here means "nothing acceptable nearby,"
    // worth widening the search, not "below some threshold we should
    // re-check" (that threshold isn't a single fixed number anymore).
    if (best.score === 0) {
      // Found via a closer look at the widened-bound fix above: this call
      // still hardcoded the old `tokens.length - bufferSize` limit, which
      // is narrower than searchRange's own `tokens.length - 1` ceiling and
      // so silently defeated that widening whenever this full-script
      // fallback (as opposed to the near-window search) was the one that
      // needed it -- e.g. a large skip landing right where a stray word
      // sits within the last match window. Passing the same wide bound
      // here lets searchRange's own clamp be the single source of truth.
      const full = this.searchRange(0, this.tokens.length - 1, this.cursor);
      if (full.score > best.score) best = full;
    }

    if (best.score > 0 && best.idx >= 0) {
      // Only log the *transition* back into a match, not every successful
      // word -- this is meant to bracket a real "Holding position" report
      // in the browser console (what was heard, what it scored, what it
      // took to recover), not to spam on every word during normal reading.
      if (this.unmatchedStreakStartAt !== null) {
        console.log("[SyncEngine] re-matched after a streak of misses", {
          heard: [...this.spokenBuffer],
          matchedAt: best.idx,
          score: best.score,
        });
      }
      // lastTokenIdx can exceed the script's final token index -- searchRange
      // now deliberately allows candidates whose window runs past the end
      // (see its comment) so a stray/inserted word within matchWindowSize of
      // the real end doesn't stall the cursor one word short. Clamping here
      // keeps that an internal search-space widening only: the cursor itself
      // (and everything getState() derives from it) always stays a valid
      // index into this.tokens.
      this.cursor = Math.min(best.lastTokenIdx, this.tokens.length - 1);
      this.lastMatchScore = best.score;
      this.unmatchedStreakStartAt = null;
    } else if (this.unmatchedStreakStartAt === null) {
      console.log("[SyncEngine] match streak broken -- best candidate below confidence threshold", {
        heard: [...this.spokenBuffer],
        cursor: this.cursor,
        bestIdx: best.idx,
        bestScore: best.score,
        threshold: this.opts.confidenceThreshold,
      });
      this.unmatchedStreakStartAt = Date.now();
    }

    return this.getState();
  }

  getState(): SyncState {
    const frozen =
      this.unmatchedStreakStartAt !== null &&
      Date.now() - this.unmatchedStreakStartAt > this.opts.freezeAfterMs;
    const currentToken = this.tokens[Math.max(this.cursor, 0)];
    let sentenceIndex = currentToken ? currentToken.sentenceIndex : 0;

    // The instant the speaker's last confirmed word completes a sentence,
    // advance the *displayed* highlight to the next one immediately, rather
    // than waiting for words from that next sentence to arrive and confirm
    // it. That wait is what made the cue visibly lag a sentence behind a
    // speaker reading straight through -- the single most common case --
    // even though the engine already knows exactly where they're going
    // next. This only changes what's shown as "active" while otherwise
    // idle; the underlying cursor and search/correction logic (skips,
    // backtracks, ad-libs) is untouched, so a real deviation still corrects
    // itself the same way it always has.
    if (
      this.cursor >= 0 &&
      this.cursor === this.sentenceEndIndex[sentenceIndex] &&
      sentenceIndex < this.sentences.length - 1
    ) {
      sentenceIndex += 1;
    }

    return {
      cursorTokenIndex: this.cursor,
      sentenceIndex,
      frozen,
      totalTokens: this.tokens.length,
      totalSentences: this.sentences.length,
      confidence: this.lastMatchScore,
    };
  }

  reset(): void {
    this.cursor = -1;
    this.spokenBuffer = [];
    this.lastMatchScore = 0;
    this.unmatchedStreakStartAt = null;
  }
}
