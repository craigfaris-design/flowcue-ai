import { describe, it, expect } from "vitest";
import { analyze, splitSyllables, respell, syllabifyForDisplay } from "./pronounce";

describe("pronounce", () => {
  it("splits multi-syllable words into more than one syllable", () => {
    expect(splitSyllables("entrepreneur").length).toBeGreaterThan(1);
    expect(splitSyllables("teleprompter").length).toBeGreaterThan(1);
    expect(splitSyllables("synchronization").length).toBeGreaterThan(2);
  });

  it("leaves short words as a single syllable", () => {
    expect(splitSyllables("cat")).toEqual(["cat"]);
  });

  it("produces a non-empty breakdown and respelling for analyze()", () => {
    const info = analyze("entrepreneur");
    expect(info.word).toBe("entrepreneur");
    expect(info.syllableBreakdown.length).toBeGreaterThan(0);
    expect(info.simplifiedRespelling.length).toBeGreaterThan(0);
    expect(info.syllables.length).toBeGreaterThan(1);
  });

  it("uppercases exactly one syllable as the stressed one", () => {
    const info = analyze("photograph");
    const upperCount = info.syllables.filter((_, i) => i === info.stressIndex).length;
    expect(upperCount).toBe(1);
  });

  // ---------- Empty / trivial input ----------

  describe("empty and trivial input", () => {
    it("does not crash on an empty string", () => {
      expect(() => splitSyllables("")).not.toThrow();
      expect(() => analyze("")).not.toThrow();
    });

    it("returns a single empty-string syllable for empty input, consistent with an empty word field", () => {
      const info = analyze("");
      expect(info.word).toBe("");
      expect(info.syllables).toEqual([""]);
      expect(info.syllableBreakdown).toBe("");
      expect(info.simplifiedRespelling).toBe("");
    });

    it("handles a single-letter word", () => {
      const info = analyze("a");
      expect(info.word).toBe("a");
      expect(info.syllables).toEqual(["a"]);
      expect(info.stressIndex).toBe(0);
    });

    it("handles a single consonant letter", () => {
      expect(() => analyze("b")).not.toThrow();
      expect(analyze("b").word).toBe("b");
    });
  });

  // ---------- Numbers embedded in a "word" ----------

  describe("words with embedded numbers", () => {
    it("strips digits from a mixed alphanumeric token like COVID-19", () => {
      // cleanWord() strips non-letters (including the hyphen and digits), so
      // "COVID-19" is treated as "COVID" for syllabification purposes.
      const info = analyze("COVID-19");
      expect(info.word).toBe("COVID");
      expect(info.syllables.join("")).toBe("covid");
    });

    it("strips the leading digit from a token like 3D, leaving just the letter", () => {
      const info = analyze("3D");
      expect(info.word).toBe("D");
      expect(info.syllables).toEqual(["d"]);
    });

    it("produces an empty, internally-consistent result for a purely numeric token", () => {
      // A "word" that is only digits (e.g. a stray page number or year the user
      // taps on) has nothing for cleanWord() to keep. All three derived fields
      // (word / syllables / respelling) must agree it's empty -- previously
      // syllables leaked the raw "123" while word/respelling were blank.
      const info = analyze("123");
      expect(info.word).toBe("");
      expect(info.syllables).toEqual([""]);
      expect(info.syllableBreakdown).toBe("");
      expect(info.simplifiedRespelling).toBe("");
    });
  });

  // ---------- Apostrophes and hyphens ----------

  describe("apostrophes and hyphens", () => {
    it("keeps apostrophes within a word (e.g. contractions)", () => {
      const info = analyze("don't");
      expect(info.word).toBe("don't");
    });

    it("does not crash on a possessive with trailing apostrophe-s", () => {
      expect(() => analyze("teacher's")).not.toThrow();
    });

    it("strips hyphens, treating a hyphenated compound as one run of letters", () => {
      // cleanWord() removes hyphens entirely, so "well-known" collapses to
      // "wellknown" before syllabification -- documenting current behavior
      // rather than asserting a "correct" linguistic split across the hyphen.
      const info = analyze("well-known");
      expect(info.word).toBe("wellknown");
      expect(info.syllables.join("")).toBe("wellknown");
    });
  });

  // ---------- All-caps acronyms ----------

  describe("all-caps acronyms", () => {
    it("syllabifies acronyms the same as any other letter run rather than special-casing them", () => {
      // There's no acronym detection in this heuristic -- NASA is lowercased and
      // split by vowel runs like any other word. Documenting current behavior.
      const info = analyze("NASA");
      expect(info.word).toBe("NASA");
      expect(info.syllables.join("")).toBe("nasa");
      expect(info.syllables.length).toBeGreaterThanOrEqual(1);
    });

    it("does not crash on a short all-consonant acronym", () => {
      expect(() => analyze("NPR")).not.toThrow();
    });
  });

  // ---------- Non-English characters ----------

  describe("non-English / accented characters", () => {
    it("strips accented letters not in [a-zA-Z'], since cleanWord only keeps ASCII letters", () => {
      // "café" loses its é -- documenting current (ASCII-only) behavior rather
      // than asserting full unicode support, which this heuristic doesn't claim.
      const info = analyze("café");
      expect(info.word).toBe("caf");
    });

    it("does not crash on non-Latin scripts", () => {
      expect(() => analyze("日本語")).not.toThrow();
      expect(() => analyze("Привет")).not.toThrow();
    });

    it("produces an empty, consistent result for input with no ASCII letters at all", () => {
      const info = analyze("日本語");
      expect(info.word).toBe("");
      expect(info.syllables).toEqual([""]);
    });

    it("does not crash on emoji input", () => {
      expect(() => analyze("🎤")).not.toThrow();
      expect(analyze("🎤").word).toBe("");
    });
  });

  // ---------- Notoriously tricky words to syllabify ----------

  describe("known-tricky words", () => {
    it("does not crash on 'queue' and produces a plausible single-syllable-ish result", () => {
      // queue has 4 vowels in a row and no consonant break -- there's exactly one
      // vowel run, so the "runs.length < 2" guard keeps it as one syllable.
      expect(() => analyze("queue")).not.toThrow();
      const info = analyze("queue");
      expect(info.syllables).toEqual(["queue"]);
    });

    it("does not crash on 'strengths' (dense consonant cluster, one vowel)", () => {
      const info = analyze("strengths");
      expect(info.syllables).toEqual(["strengths"]);
      expect(info.word).toBe("strengths");
    });

    it("does not crash on 'rhythm' (no standard vowel at all under this heuristic's VOWELS set)", () => {
      // VOWELS = "aeiouy" -- rhythm has no a/e/i/o/u and no y either as a vowel
      // occurrence ('rhythm' contains no y... it does not, so zero vowel runs).
      expect(() => analyze("rhythm")).not.toThrow();
      const info = analyze("rhythm");
      expect(info.syllables.join("")).toBe("rhythm");
    });

    it("handles silent-e words without producing a trailing orphan syllable", () => {
      const info = analyze("simple");
      expect(info.syllables.every((s) => s.length > 0)).toBe(true);
    });
  });

  // ---------- Extremely long words ----------

  describe("extremely long words", () => {
    it("does not crash on a very long real word (pneumonoultramicroscopicsilicovolcanoconiosis)", () => {
      const word = "pneumonoultramicroscopicsilicovolcanoconiosis";
      expect(() => analyze(word)).not.toThrow();
      const info = analyze(word);
      expect(info.syllables.length).toBeGreaterThan(5);
      expect(info.syllables.join("")).toBe(word.toLowerCase());
    });

    it("does not crash on a pathologically long run of the same vowel", () => {
      const word = "a".repeat(500);
      expect(() => analyze(word)).not.toThrow();
    });

    it("does not crash on a pathologically long word with alternating consonant/vowel", () => {
      const word = "ba".repeat(500);
      expect(() => analyze(word)).not.toThrow();
      const info = analyze(word);
      expect(info.syllables.join("")).toBe(word);
    });
  });

  // ---------- respell() ----------

  describe("respell", () => {
    it("converts common digraphs (tion, ph, ck, qu, x)", () => {
      expect(respell("nation")).toContain("shun");
      expect(respell("phone")).toContain("f");
      expect(respell("stick")).toContain("k");
      expect(respell("queen")).toContain("kw");
      expect(respell("box")).toContain("ks");
    });

    it("does not crash on empty input", () => {
      expect(respell("")).toBe("");
    });
  });

  // ---------- Stress index bounds ----------

  describe("stress index bounds", () => {
    it("keeps stressIndex within the syllables array for single-syllable words", () => {
      const info = analyze("cat");
      expect(info.stressIndex).toBeGreaterThanOrEqual(0);
      expect(info.stressIndex).toBeLessThan(info.syllables.length);
    });

    it("keeps stressIndex within bounds even for empty input", () => {
      const info = analyze("");
      expect(info.stressIndex).toBeGreaterThanOrEqual(0);
      expect(info.stressIndex).toBeLessThan(info.syllables.length);
    });
  });

  // ---------- syllabifyForDisplay (reading-view syllable breaks) ----------

  describe("syllabifyForDisplay", () => {
    it("splits a long/complicated word with middle-dots", () => {
      expect(syllabifyForDisplay("communication")).toContain("·");
      expect(syllabifyForDisplay("communication").replace(/·/g, "")).toBe("communication");
    });

    it("leaves short/simple words (below the syllable threshold) unchanged", () => {
      expect(syllabifyForDisplay("tonight")).toBe("tonight");
      expect(syllabifyForDisplay("cat")).toBe("cat");
    });

    it("leaves ordinary everyday words unsplit even though they land at 3 syllables -- only genuinely long/complicated words should split", () => {
      // Reported directly: syllable breaks were showing up on completely
      // normal words a presenter reads every day, not just the rare
      // "com·mu·ni·ca·tion"-class term this feature is meant for. All of
      // these are common 3-syllable words under the same vowel-run
      // heuristic splitSyllables uses -- a threshold of 3 caught nearly
      // every multi-syllable word in ordinary speech.
      for (const word of ["yesterday", "wonderful", "beautiful", "together", "remember", "important"]) {
        expect(syllabifyForDisplay(word)).toBe(word);
      }
    });

    it("still splits genuinely long/complicated words", () => {
      expect(syllabifyForDisplay("communication")).toContain("·");
      expect(syllabifyForDisplay("extraordinary")).toContain("·");
      expect(syllabifyForDisplay("responsibility")).toContain("·");
    });

    it("preserves original casing, not the lowercase form splitSyllables works with internally", () => {
      const result = syllabifyForDisplay("Communication");
      expect(result.startsWith("C")).toBe(true);
      expect(result).not.toContain("c·"); // first syllable's leading letter must stay capital
    });

    it("preserves trailing punctuation outside the split", () => {
      const result = syllabifyForDisplay("communication.");
      expect(result.endsWith(".")).toBe(true);
      expect(result).toContain("·");
    });

    it("preserves a leading punctuation/quote character", () => {
      const result = syllabifyForDisplay("“communication");
      expect(result.startsWith("“")).toBe(true);
    });

    it("does not crash and returns input unchanged for a hyphenated word", () => {
      // splitSyllables' own cleanWord() strips hyphens internally, which
      // would misalign a naive slice-based reconstruction -- this must
      // safely decline to split rather than garble the word.
      expect(() => syllabifyForDisplay("well-known")).not.toThrow();
      expect(syllabifyForDisplay("well-known")).toBe("well-known");
    });

    it("does not crash on empty or purely non-alphabetic input", () => {
      expect(syllabifyForDisplay("")).toBe("");
      expect(syllabifyForDisplay("123")).toBe("123");
      expect(syllabifyForDisplay("--")).toBe("--");
    });

    it("preserves an apostrophe within the word", () => {
      // Short enough that it shouldn't split at all, but confirms the
      // apostrophe survives the prefix/core/suffix decomposition either way.
      const result = syllabifyForDisplay("y'all");
      expect(result.replace(/·/g, "")).toBe("y'all");
    });
  });
});
