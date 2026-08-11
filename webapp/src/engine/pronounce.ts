/**
 * FlowCue AI -- Pronunciation Assistant.
 *
 * Per the PRD (section 7): syllable breakdown, a simplified phonetic respelling,
 * and stress-marker placement for any tapped word. Rule-based heuristic suitable
 * for an MVP/v1; production should back this with a pronunciation dictionary
 * (CMUdict-class) plus a grapheme-to-phoneme fallback model, per the Technical
 * Architecture doc's Pronunciation Service.
 */

const VOWELS = "aeiouy";

export interface PronunciationInfo {
  word: string;
  syllables: string[];
  stressIndex: number;
  syllableBreakdown: string;
  simplifiedRespelling: string;
}

function cleanWord(word: string): string {
  return word.replace(/[^a-zA-Z']/g, "");
}

interface VowelRun {
  start: number;
  end: number;
}

// Finds maximal vowel runs, then places a split boundary between each pair of
// adjacent vowel runs using the classic "maximal onset" heuristic: a single
// intervocalic consonant joins the following syllable (pho-to, not phot-o);
// two or more consonants split roughly down the middle (en-tre, not entr-e).
export function splitSyllables(word: string): string[] {
  const w = cleanWord(word).toLowerCase();
  // Note: previously this fell back to the raw, uncleaned `word` when `w` was
  // empty (e.g. a purely numeric/symbolic/emoji "word" like a page number or
  // bullet). That leaked untouched digits/punctuation into the syllable list
  // while `analyze()`'s `word` field (which is always cleanWord-based) showed
  // empty -- the popover would display a syllable breakdown with content next
  // to a blank headword and a blank respelling. Falling back to `w` (empty)
  // keeps all three PronunciationInfo fields consistent for non-alphabetic input.
  if (w.length <= 3) return [w];

  const isVowel = (ch: string) => VOWELS.includes(ch);
  const runs: VowelRun[] = [];
  let i = 0;
  while (i < w.length) {
    if (isVowel(w[i])) {
      const start = i;
      while (i < w.length && isVowel(w[i])) i++;
      runs.push({ start, end: i });
    } else {
      i++;
    }
  }

  if (runs.length < 2) return [w];

  const splitPoints: number[] = [];
  for (let r = 0; r < runs.length - 1; r++) {
    const gapStart = runs[r].end;
    const gapEnd = runs[r + 1].start;
    const gapLen = gapEnd - gapStart;
    if (gapLen <= 0) continue;
    if (gapLen === 1) {
      splitPoints.push(gapStart);
    } else {
      splitPoints.push(gapStart + Math.ceil(gapLen / 2));
    }
  }

  const groups: string[] = [];
  let last = 0;
  splitPoints.forEach((sp) => {
    groups.push(w.slice(last, sp));
    last = sp;
  });
  groups.push(w.slice(last));

  const merged: string[] = [];
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    if (g === groups.length - 1 && grp === "e" && merged.length) {
      merged[merged.length - 1] += grp;
    } else if (grp.length === 0) {
      continue;
    } else {
      merged.push(grp);
    }
  }
  return merged.length ? merged : [w];
}

const RESPELL_MAP: Array<[RegExp, string]> = [
  [/tion\b/g, "shun"],
  [/sion\b/g, "zhun"],
  [/ough/g, "uff"],
  [/eigh/g, "ay"],
  [/ph/g, "f"],
  [/ck/g, "k"],
  [/qu/g, "kw"],
  [/x/g, "ks"],
  [/c(?=[eiy])/g, "s"],
  [/c/g, "k"],
  [/j/g, "j"],
  [/y$/g, "ee"],
];

export function respell(word: string): string {
  let w = cleanWord(word).toLowerCase();
  RESPELL_MAP.forEach(([pattern, replacement]) => {
    w = w.replace(pattern, replacement);
  });
  return w;
}

function guessStressIndex(syllableCount: number): number {
  if (syllableCount <= 1) return 0;
  if (syllableCount === 2) return 0;
  return 1;
}

// Word length in real syllables (not characters) beyond which a word counts
// as "long/complicated" for the reading-view syllable-break setting -- short
// words never need the help, and splitSyllables() already declines to split
// anything <=3 letters at all.
//
// Was 3, raised to 4: reported directly as splitting ordinary everyday
// words, not just genuinely long/complicated ones. Plenty of common words
// land at exactly 3 syllables under this same vowel-run heuristic --
// "yesterday," "wonderful," "beautiful," "together" all do -- so a
// threshold of 3 caught nearly every multi-syllable word in normal speech,
// not the rarer "com·mu·ni·ca·tion"-class word this feature exists for.
const LONG_WORD_SYLLABLE_THRESHOLD = 4;

// Inserts a middle-dot between syllables for display in the actual
// rehearsal reading text (e.g. "com·mu·ni·ca·tion") -- distinct from
// analyze()'s syllableBreakdown, which is lowercase and drops punctuation
// (fine for a tap-to-reveal popover, not fine for the reading text itself,
// where original casing and trailing punctuation like a period or comma
// still need to read correctly). Returns the word unchanged if it isn't
// long enough to bother, or has no letters to split at all.
export function syllabifyForDisplay(word: string): string {
  // Deliberately only [a-zA-Z'] in the core, matching cleanWord()'s exact
  // character set (used internally by splitSyllables) -- a hyphenated word
  // like "well-known" won't decompose into prefix+core+suffix this way (the
  // internal hyphen breaks the match) and safely falls through to the
  // unchanged-word return below, rather than being sliced against syllable
  // lengths that summed a hyphen-stripped string and would misalign.
  const match = word.match(/^([^a-zA-Z']*)([a-zA-Z']+)?([^a-zA-Z']*)$/);
  const core = match?.[2];
  if (!core) return word;

  const syllables = splitSyllables(core);
  if (syllables.length < LONG_WORD_SYLLABLE_THRESHOLD) return word;

  // splitSyllables lowercases internally and works off cleanWord() (which
  // strips the same non-letter/apostrophe characters `core` already
  // excludes), so its returned groups' lengths sum to exactly core.length --
  // slicing the ORIGINAL-cased `core` at those same lengths reconstructs the
  // split with casing intact instead of using the lowercased groups as-is.
  const prefix = match?.[1] ?? "";
  const suffix = match?.[3] ?? "";
  const parts: string[] = [];
  let pos = 0;
  for (const syllable of syllables) {
    parts.push(core.slice(pos, pos + syllable.length));
    pos += syllable.length;
  }
  return prefix + parts.join("·") + suffix;
}

export function analyze(word: string): PronunciationInfo {
  const syllables = splitSyllables(word);
  const stressIndex = guessStressIndex(syllables.length);
  const displaySyllables = syllables.map((s, i) => (i === stressIndex ? s.toUpperCase() : s));
  return {
    word: cleanWord(word),
    syllables,
    stressIndex,
    syllableBreakdown: displaySyllables.join(" • "),
    simplifiedRespelling: syllables
      .map((s, i) => (i === stressIndex ? respell(s).toUpperCase() : respell(s)))
      .join("-"),
  };
}
