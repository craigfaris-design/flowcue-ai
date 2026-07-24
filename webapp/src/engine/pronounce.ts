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
  if (w.length <= 3) return [w || word];

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
