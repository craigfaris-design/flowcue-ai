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
}

const DEFAULT_OPTIONS: Required<SyncEngineOptions> = {
  nearWindowBefore: 4,
  nearWindowAfter: 45,
  matchWindowSize: 6,
  confidenceThreshold: 0.6,
  freezeAfterMs: 2000,
};

const VOWEL_CHECK = /[^a-z0-9']/g;

export function normalize(word: string): string {
  return word.toLowerCase().replace(VOWEL_CHECK, "").trim();
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

export class SyncEngine {
  readonly sentences: string[];
  readonly tokens: ScriptToken[];
  private opts: Required<SyncEngineOptions>;
  private cursor = -1;
  private lastConfidentMatchAt = Date.now();
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

  private scoreCandidate(startIdx: number): number {
    const n = this.spokenBuffer.length;

    // The most recently spoken word must plausibly match this candidate's
    // implied position, or the candidate is disqualified outright. Without
    // this, a candidate can look "confident" purely from stale words earlier
    // in the rolling buffer -- e.g. the tail end of words spoken before an
    // ad-lib began -- letting the cursor creep forward one token per ad-lib
    // word even though nothing new was actually recognized there (up to
    // ceil(matchWindowSize * confidenceThreshold) - 1 stale words can still
    // out-vote a single fresh mismatch). Anchoring on the newest word ties
    // the score to what the speaker is saying right now, not what they said
    // several words ago that happens to still be sitting in the buffer.
    const lastToken = this.tokens[startIdx + n - 1];
    if (!lastToken || !wordsMatch(this.spokenBuffer[n - 1], lastToken.norm)) return 0;

    let matches = 0;
    for (let i = 0; i < n; i++) {
      const t = this.tokens[startIdx + i];
      if (!t) break;
      if (wordsMatch(this.spokenBuffer[i], t.norm)) matches++;
    }
    return matches / n;
  }

  private searchRange(lo: number, hi: number): { idx: number; score: number } {
    let best = { idx: -1, score: 0 };
    const from = Math.max(0, lo);
    const to = Math.min(this.tokens.length - this.spokenBuffer.length, hi);
    for (let s = from; s <= to; s++) {
      const score = this.scoreCandidate(s);
      if (score > best.score) best = { idx: s, score };
    }
    return best;
  }

  ingestWord(word: string): SyncState {
    const norm = normalize(word);
    if (!norm) return this.getState();

    this.spokenBuffer.push(norm);
    if (this.spokenBuffer.length > this.opts.matchWindowSize) this.spokenBuffer.shift();
    if (this.spokenBuffer.length < Math.min(3, this.opts.matchWindowSize)) return this.getState();

    const nearLo = this.cursor - this.opts.nearWindowBefore;
    const nearHi = this.cursor + this.opts.nearWindowAfter;
    let best = this.searchRange(nearLo, nearHi);

    if (best.score < this.opts.confidenceThreshold) {
      const full = this.searchRange(0, this.tokens.length - this.spokenBuffer.length);
      if (full.score > best.score) best = full;
    }

    if (best.score >= this.opts.confidenceThreshold && best.idx >= 0) {
      this.cursor = best.idx + this.spokenBuffer.length - 1;
      this.lastConfidentMatchAt = Date.now();
    }

    return this.getState();
  }

  getState(): SyncState {
    const frozen = Date.now() - this.lastConfidentMatchAt > this.opts.freezeAfterMs;
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
    };
  }

  reset(): void {
    this.cursor = -1;
    this.spokenBuffer = [];
    this.lastConfidentMatchAt = Date.now();
  }
}
