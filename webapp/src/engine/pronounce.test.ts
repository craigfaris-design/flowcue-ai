import { describe, it, expect } from "vitest";
import { analyze, splitSyllables } from "./pronounce";

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
});
