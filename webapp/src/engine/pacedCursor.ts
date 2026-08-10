/**
 * FlowCue AI -- Offline Paced Reading Cursor.
 *
 * Neither of this beta's speech recognizers is on-device (AssemblyAI is
 * cloud-only by design; its fallback, the browser's Web Speech API, streams
 * audio to the browser vendor's cloud) -- so with no wifi/cellular
 * connection, SyncEngine's speech-driven cursor has nothing to listen to.
 * This is the alternative: advances the cursor on a timer at a set pace
 * (words per minute) instead of matching recognized speech, so a presenter
 * can still rehearse with no connection at all. Reuses SyncState's exact
 * shape so RehearsalStage renders either cursor identically.
 *
 * Deliberately not "smart" the way SyncEngine is -- there's no audio to
 * correct against, so drift from the presenter's actual pace is expected.
 * jumpToSentence() (wired to tapping any line in RehearsalStage) is the
 * recovery mechanism instead: an instant, always-available manual resync,
 * rather than trying to guess intent from a timer alone.
 */
import { tokenizeScript, type ScriptToken, type SyncState } from "./syncEngine";

// Centered on the same 140wpm assumption sessionMetrics.ts's confidence
// score already uses as "ideal" pace, so a first-time user with no session
// history yet gets a pace that matches what the rest of the app already
// considers normal, rather than a second, disconnected default.
export const DEFAULT_WPM = 140;
export const MIN_WPM = 80;
export const MAX_WPM = 220;

export class PacedCursor {
  readonly sentences: string[];
  readonly tokens: ScriptToken[];
  private wpm: number;
  private playing = false;
  // Fractional token position -- not just an integer -- so the timer can
  // advance smoothly between ticks instead of visibly jumping one whole
  // word at a time. -1 mirrors SyncEngine's "nothing read yet" convention.
  private baselinePosition = -1;
  private baselineTime: number | null = null;
  // First token index of each sentence, so jumpToSentence() is O(1) instead
  // of scanning `tokens` on every tap.
  private sentenceStartIndex: number[];

  constructor(scriptText: string, wpm: number = DEFAULT_WPM) {
    const { sentences, tokens } = tokenizeScript(scriptText);
    this.sentences = sentences;
    this.tokens = tokens;
    this.wpm = wpm;
    this.sentenceStartIndex = sentences.map(() => -1);
    tokens.forEach((t) => {
      if (this.sentenceStartIndex[t.sentenceIndex] === -1) this.sentenceStartIndex[t.sentenceIndex] = t.globalIndex;
    });
  }

  private currentPosition(): number {
    if (!this.playing || this.baselineTime === null) return this.baselinePosition;
    const wordsPerMs = this.wpm / 60000;
    return this.baselinePosition + (Date.now() - this.baselineTime) * wordsPerMs;
  }

  // Snapshots the live-computed position back into baselinePosition and
  // clears baselineTime -- the shared first step behind pause(), setWpm(),
  // and jumpToSentence(), all of which need to rebase from wherever the
  // cursor actually is *right now* rather than wherever it started playing
  // from, or the next getState() would jump or accelerate unexpectedly.
  private rebase(): void {
    this.baselinePosition = this.currentPosition();
    this.baselineTime = this.playing ? Date.now() : null;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.baselineTime = Date.now();
  }

  pause(): void {
    if (!this.playing) return;
    this.baselinePosition = this.currentPosition();
    this.playing = false;
    this.baselineTime = null;
  }

  setWpm(wpm: number): void {
    this.rebase();
    this.wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));
  }

  getWpm(): number {
    return this.wpm;
  }

  /** Jumps straight to the start of a sentence -- the tap-anywhere-to-resync
   * gesture RehearsalStage wires to clicking any line in offline mode. Kept
   * separate from play/pause state: tapping while paused stages the new
   * position without resuming, tapping while playing keeps it moving from
   * there, so a tap never has a surprising side effect on top of moving the
   * cursor. */
  jumpToSentence(sentenceIndex: number): void {
    const target = this.sentenceStartIndex[sentenceIndex];
    if (target === undefined || target < 0) return;
    this.baselinePosition = target;
    this.baselineTime = this.playing ? Date.now() : null;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  reset(): void {
    this.baselinePosition = -1;
    this.baselineTime = null;
    this.playing = false;
  }

  getState(): SyncState {
    const raw = this.currentPosition();
    const cursorTokenIndex = Math.max(-1, Math.min(this.tokens.length - 1, Math.floor(raw)));
    const currentToken = this.tokens[Math.max(cursorTokenIndex, 0)];
    const sentenceIndex = currentToken ? currentToken.sentenceIndex : 0;
    return {
      cursorTokenIndex,
      sentenceIndex,
      // There's no matching to lose confidence in -- this cursor is either
      // moving at the set pace or it isn't, nothing in between. `confidence:
      // 1` keeps "Confidence colors" mode rendering a steady, honest green
      // rather than an undefined/zero value that would misread as "barely
      // tracking."
      frozen: false,
      totalTokens: this.tokens.length,
      totalSentences: this.sentences.length,
      confidence: 1,
    };
  }

  /** True once the cursor has advanced past the script's last token -- lets
   * the caller stop the reading timer at the end instead of counting up
   * forever past a script that's already finished. */
  reachedEnd(): boolean {
    return this.tokens.length > 0 && this.currentPosition() >= this.tokens.length - 1;
  }
}
