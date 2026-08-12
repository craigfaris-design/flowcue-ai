import type { SyncEngineOptions } from "./syncEngine";
import type { SessionRecord } from "../lib/types";

/**
 * On-device personalization: the more a specific user rehearses, the more
 * FlowCue AI learns how live cueing tends to behave *for them specifically*
 * (their voice, accent, mic, typical pacing), and adapts accordingly --
 * both the sync engine's match tolerance (`options`) and Practice Mode's
 * live pace-coaching band (`paceRange`). Entirely local -- reads only this
 * browser's own session history (see storage.getRecentSessions), never
 * sends anything anywhere. Deliberately NOT a crowd-sourced/global learning
 * system: that would mean collecting speech data across users on a server,
 * which is a privacy/consent decision, not an engineering one, and would
 * contradict the app's existing "does not store audio" disclosure. (Raised
 * directly: the ask was for FlowCue AI to "constantly evolve" the more it's
 * used -- this is the privacy-respecting version of that, learning per
 * device from that device's own history, not pooling data across users
 * without their explicit, informed consent.)
 *
 * Deliberately one-directional and narrowly bounded on the sync-tolerance
 * side: `options` only ever RELAXES tolerance for a user who's genuinely
 * triggering more freezes than the defaults expect, within a range already
 * validated safe by extensive live testing (see syncEngine.ts's own option
 * comments). It never tightens below the shipped defaults -- those were
 * already tuned against a real ad-lib-drift false-positive risk, and a
 * well-tracked user having an unusual session shouldn't make the app *more*
 * trigger-happy about freezing than the baseline everyone starts on.
 * `paceRange` has no such asymmetry -- it's coaching feedback, not a
 * correctness-critical matching parameter, so it simply centers on this
 * device's own recent average pace either direction.
 */

const MIN_SESSIONS_TO_PERSONALIZE = 5;
const SESSIONS_CONSIDERED = 10;

// How many freezes-per-100-words counts as "a lot" -- beyond this, further
// increases in freeze rate don't relax tolerance any further. Chosen well
// above what a well-tracked session produces (typically 0-1 per 100 words
// per this session's live testing) without being so high it never triggers.
const HIGH_FREEZE_RATE_PER_100_WORDS = 3;

// Kept in sync with syncEngine.ts's own DEFAULT_OPTIONS.freezeAfterMs -- if
// this drifted lower, a *personalized* well-tracked user (severity near 0)
// would end up with a tighter threshold than someone with no history at all,
// which is backwards. MAX scaled up by the same amount so the adaptive
// range (how much a high freeze-rate user can relax it) stays the same
// 2000ms window as before, though this new ceiling itself isn't
// independently live-tested the way the original 4000 was.
const DEFAULT_FREEZE_AFTER_MS = 3200;
const MAX_FREEZE_AFTER_MS = 5200;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
const MIN_CONFIDENCE_THRESHOLD = 0.55; // floor: stays well clear of the ad-lib-drift regression test's margin

// How far above/below this device's own historical average pace still
// counts as "comfortable" for Practice Mode's live coaching nudge --
// +/-15%, same spread the generic 110-165wpm fallback band has around its
// own 140wpm center ((165-110)/140 ~= 0.39 total width vs this band's 0.30,
// intentionally a bit tighter since a personalized center is a more
// specific target than a one-size-fits-all guess). Absolute bounds match
// PacedCursor's MIN_WPM/MAX_WPM (Offline Reading's own pace slider) so
// every pace-related feature in the app agrees on the same sane range,
// rather than three independently-chosen limits.
const PACE_BAND_FRACTION = 0.15;
const ABSOLUTE_MIN_WPM = 80;
const ABSOLUTE_MAX_WPM = 220;
const FALLBACK_PACE_RANGE = { slowWpm: 110, fastWpm: 165 };

export interface AdaptiveTuningResult {
  options: Partial<SyncEngineOptions>;
  /** Whether personalization is actually active (enough history exists) -- false means `options` is just the defaults. */
  isPersonalized: boolean;
  sessionsUsed: number;
  freezesPer100Words: number;
  /** Practice Mode's live pace-coaching band -- this device's own recent
   * average wpm +/-15% once personalized, else the generic 110-165wpm
   * fallback every device starts on. See practiceNudge() in
   * sessionMetrics.ts, which is what actually consumes this. */
  paceRange: { slowWpm: number; fastWpm: number };
}

export function computeAdaptiveOptions(sessions: SessionRecord[]): AdaptiveTuningResult {
  const usable = sessions
    .slice(0, SESSIONS_CONSIDERED)
    .filter((s) => typeof s.freezeCount === "number" && s.wordCount > 0);

  if (usable.length < MIN_SESSIONS_TO_PERSONALIZE) {
    return { options: {}, isPersonalized: false, sessionsUsed: usable.length, freezesPer100Words: 0, paceRange: FALLBACK_PACE_RANGE };
  }

  const totalWords = usable.reduce((sum, s) => sum + s.wordCount, 0);
  const totalFreezes = usable.reduce((sum, s) => sum + (s.freezeCount ?? 0), 0);
  const freezesPer100Words = totalWords > 0 ? (totalFreezes / totalWords) * 100 : 0;

  // 0 at/below a well-tracked baseline, ramping linearly to 1 at the "a lot
  // of freezes" rate defined above -- clamped to [0, 1] so a single rough
  // session (or a long history of them) can't push tuning past the
  // validated-safe range in either direction.
  const severity = Math.max(0, Math.min(1, freezesPer100Words / HIGH_FREEZE_RATE_PER_100_WORDS));

  const freezeAfterMs = Math.round(DEFAULT_FREEZE_AFTER_MS + severity * (MAX_FREEZE_AFTER_MS - DEFAULT_FREEZE_AFTER_MS));
  const confidenceThreshold =
    DEFAULT_CONFIDENCE_THRESHOLD - severity * (DEFAULT_CONFIDENCE_THRESHOLD - MIN_CONFIDENCE_THRESHOLD);

  const avgWpm = usable.reduce((sum, s) => sum + s.wpm, 0) / usable.length;
  const paceRange = {
    slowWpm: Math.round(Math.max(ABSOLUTE_MIN_WPM, avgWpm * (1 - PACE_BAND_FRACTION))),
    fastWpm: Math.round(Math.min(ABSOLUTE_MAX_WPM, avgWpm * (1 + PACE_BAND_FRACTION))),
  };

  return {
    options: { freezeAfterMs, confidenceThreshold },
    isPersonalized: true,
    sessionsUsed: usable.length,
    freezesPer100Words: Math.round(freezesPer100Words * 10) / 10,
    paceRange,
  };
}
