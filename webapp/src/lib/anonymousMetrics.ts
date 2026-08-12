/**
 * FlowCue AI -- Optional anonymous session metrics.
 *
 * Sends a session's numeric summary to FlowCue AI's backend when (and only
 * when) Settings.shareAnonymousMetrics is on -- see
 * legal/PRIVACY_POLICY.md's "Optional: help improve FlowCue AI" section for
 * the exact commitment this code has to keep. Two hard rules that section
 * promises and this file must never violate:
 *
 * 1. Every field sent is a number, a duration, or a value from a small
 *    fixed set (language code, visual mode, boolean) -- never free text,
 *    never script content, never a transcript, never audio.
 * 2. No account/device identifier is attached, and nothing here is
 *    persisted locally about what's been sent -- each call is a one-shot,
 *    unlinkable submission. Best-effort (fire-and-forget): failure to send
 *    must never surface an error to the presenter or block anything else,
 *    since this is entirely incidental to actually using the app.
 */
import type { VisualMode } from "./types";

export interface AnonymousSessionMetrics {
  durationSec: number;
  wordCount: number;
  wpm: number;
  fillerRate: number;
  confidence: number;
  freezeCount: number;
  language: string;
  visualMode: VisualMode;
  usingFallback: boolean;
}

// Matches useAssemblyAIRecognition.ts/defaultRelayUrl()'s own env var --
// reusing it (rather than a second env var) keeps "where the backend is"
// defined in exactly one place per deploy target.
function metricsEndpoint(): string | null {
  const explicitUrl = import.meta.env.VITE_STT_RELAY_URL as string | undefined;
  if (explicitUrl) {
    return `${explicitUrl.replace(/\/$/, "").replace(/^wss:/, "https:").replace(/^ws:/, "http:")}/api/metrics`;
  }
  if (typeof window === "undefined") return null;
  // Local dev without an explicit relay URL: same-origin dev proxy, same
  // reasoning as defaultRelayUrl()'s DEV branch.
  if (import.meta.env.DEV) return `${window.location.origin}/api/metrics`;
  return null;
}

/** Fire-and-forget -- never throws, never blocks the caller. Exported
 * separately from the ScriptWorkspace call site so it's independently
 * testable without rendering the component. */
export function sendAnonymousMetrics(metrics: AnonymousSessionMetrics): void {
  const endpoint = metricsEndpoint();
  if (!endpoint || typeof fetch === "undefined") return;
  try {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metrics),
      // Never send cookies/credentials -- this is an anonymous, unlinkable
      // submission by design (see this file's own header comment).
      credentials: "omit",
      keepalive: true, // survives the page/tab closing right after Stop is pressed
    }).catch(() => {
      // Best-effort only -- a failed submission (offline, backend down)
      // must never surface as an error to the presenter.
    });
  } catch {
    // Synchronous failure (e.g. fetch throwing on a malformed URL) -- same
    // best-effort contract as the async .catch above.
  }
}
