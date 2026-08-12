/**
 * Shared math behind both the post-session "AI Coach" report and the
 * during-session live nudges in Practice Mode -- pulled out of
 * ScriptWorkspace.tsx so the same formula backs both instead of two copies
 * drifting apart, and so it's independently testable without rendering the
 * component.
 */

export interface SessionMetrics {
  wpm: number;
  fillerRate: number;
  confidence: number;
}

export function computeSessionMetrics(wordCount: number, fillerCount: number, durationSec: number): SessionMetrics {
  const safeDuration = Math.max(1, durationSec);
  const wpm = Math.round((wordCount / safeDuration) * 60);
  const fillerRate = wordCount ? (fillerCount / wordCount) * 100 : 0;
  const confidence = Math.max(0, Math.min(100, 100 - fillerRate * 4 - Math.abs(wpm - 140) / 2));
  return { wpm, fillerRate, confidence };
}

// Below this many words, pace/filler-rate numbers are too noisy to coach
// against yet (e.g. one filler word out of three spoken looks like a 33%
// filler rate) -- found via reasoning about the math, not live use: a fixed
// floor avoids a discouraging false-alarm nudge in the first second of
// speech, before there's enough signal to say anything useful.
const MIN_WORDS_FOR_FEEDBACK = 8;

// Centered on the same 140wpm/8%-filler assumptions computeSessionMetrics's
// confidence score already uses, so the live nudge and the end-of-session
// score never contradict each other (e.g. a nudge saying "great pace" right
// before the summary docks points for that same pace). This is the
// fallback band for a device with no rehearsal history yet -- see
// adaptiveTuning.ts's `paceRange`, which replaces it with this specific
// presenter's own historical average once there's enough of one. Kept as
// the fallback (not deleted) rather than folded entirely into
// adaptiveTuning, since practiceNudge() must still say something sensible
// on someone's very first session.
const FILLER_RATE_WARNING = 8;
const PACE_FAST_WPM = 165;
const PACE_SLOW_WPM = 110;

export interface PaceRange {
  slowWpm: number;
  fastWpm: number;
}

/** A short, single live coaching tip for Practice Mode -- prioritized so
 * only the single most useful thing is shown at once, not a checklist.
 * `paceRange` overrides the generic 110-165wpm band with a personalized one
 * (see adaptiveTuning.ts) -- optional so a device with no history yet still
 * gets sensible feedback against the generic band. */
export function practiceNudge(wordCount: number, fillerRate: number, wpm: number, paceRange?: PaceRange): string {
  const fastWpm = paceRange?.fastWpm ?? PACE_FAST_WPM;
  const slowWpm = paceRange?.slowWpm ?? PACE_SLOW_WPM;
  if (wordCount < MIN_WORDS_FOR_FEEDBACK) return "Keep going -- feedback will appear as you speak.";
  if (fillerRate > FILLER_RATE_WARNING) return "Watch the filler words (um, uh, like...).";
  if (wpm > fastWpm) return "You're speaking quickly -- try slowing down a touch.";
  if (wpm < slowWpm) return "You can pick up the pace a little.";
  return "Good pace and clarity -- keep going.";
}
