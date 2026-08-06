import { useEffect, useMemo, useRef, useState } from "react";
import { SyncEngine, expandSpokenWord, type SyncState } from "../engine/syncEngine";
import { computeAdaptiveOptions } from "../engine/adaptiveTuning";
import { useLiveRecognition } from "../hooks/useLiveRecognition";
import type { Script, SessionRecord, VisualMode } from "../lib/types";
import { VISUAL_MODE_LABELS } from "../lib/types";
import { computeSessionMetrics, practiceNudge } from "../lib/sessionMetrics";
import * as storage from "../lib/storage";
import { RehearsalStage } from "./RehearsalStage";
import { CoachReport } from "./CoachReport";
import "./ScriptWorkspace.css";

interface ScriptWorkspaceProps {
  script: Script;
  defaultVisualMode: VisualMode;
  offlineModeEnabled: boolean;
  syllabifyLongWords: boolean;
  speechLanguage: string;
  onBack: () => void;
  onScriptUpdated: (script: Script) => void;
  onScriptDeleted: (id: string) => void;
}

const FILLER_WORDS = new Set(["um", "uh", "like", "actually", "basically", "literally", "sort", "kind"]);

type Mode = "edit" | "rehearse";

export function ScriptWorkspace({
  script,
  defaultVisualMode,
  offlineModeEnabled,
  syllabifyLongWords,
  speechLanguage,
  onBack,
  onScriptUpdated,
  onScriptDeleted,
}: ScriptWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("rehearse");
  const [title, setTitle] = useState(script.title);
  const [body, setBody] = useState(script.body);
  const [visualMode, setVisualMode] = useState<VisualMode>(defaultVisualMode);
  // For real teleprompter hardware (beam-splitter glass) -- session-only,
  // not persisted, since it depends on the physical rig in use that moment
  // rather than a per-user reading preference like visualMode.
  const [mirrorFlip, setMirrorFlip] = useState(false);
  const [history, setHistory] = useState<SessionRecord[]>(() => storage.getSessionsForScript(script.id));
  const [latestSession, setLatestSession] = useState<SessionRecord | null>(null);
  // Whether `latestSession` is an ephemeral Practice Mode summary rather
  // than a real saved record -- tracked separately instead of inferred from
  // latestSession's id, so CoachReport's "was this saved?" framing never
  // depends on a fragile sentinel value coinciding with a real session id.
  const [latestWasPractice, setLatestWasPractice] = useState(false);
  // Session-only, like mirrorFlip -- a per-rehearsal choice, not a device
  // preference. Locked once listening starts (see the disabled checkbox
  // below) so a session's data never straddles both modes: a practice run
  // that got real-time nudges shouldn't suddenly start counting toward
  // adaptiveTuning's real-session history partway through.
  const [practiceMode, setPracticeMode] = useState(false);
  const [liveNudge, setLiveNudge] = useState<string | null>(null);

  // On-device personalization: the more this device's user has rehearsed,
  // the more FlowCue AI has learned how live cueing tends to behave for
  // them specifically, and relaxes the sync engine's tolerance accordingly
  // -- see adaptiveTuning.ts for exactly what this does and doesn't do
  // (nothing here is sent anywhere; it only reads this browser's own
  // session history). Computed once per mount, not re-derived mid-session,
  // so tuning can't shift under a presenter's feet while they're using it.
  const adaptiveTuning = useMemo(() => computeAdaptiveOptions(storage.getRecentSessions(10)), []);

  // The SyncEngine instance is recreated only when the *committed* script body
  // changes (i.e. after Save), not on every keystroke while editing.
  const engine = useMemo(
    () => new SyncEngine(script.body, adaptiveTuning.options),
    [script.body, adaptiveTuning.options]
  );
  const [syncState, setSyncState] = useState<SyncState>(() => engine.getState());

  const sessionRef = useRef({ startedAt: 0, wordCount: 0, fillerCount: 0, freezeCount: 0 });
  // Tracks the false->true edge of `frozen` (a session's freeze *count*,
  // not just its current state) so adaptiveTuning.ts has something to
  // learn from -- reset whenever a session starts/resets so a freeze
  // carried over from a previous engine/session is never double-counted.
  const wasFrozenRef = useRef(false);
  function updateSyncState(next: SyncState) {
    if (next.frozen && !wasFrozenRef.current) sessionRef.current.freezeCount++;
    wasFrozenRef.current = next.frozen;
    setSyncState(next);
  }

  // Surfaces exactly what the recognizer is actually hearing, independent of
  // whether it matches the script. Without this, "frozen" is ambiguous: is
  // the mic not picking up speech at all, or is it hearing words that just
  // aren't confidently matching? This makes that distinction visible instead
  // of leaving the presenter (or anyone debugging a report of it) to guess.
  const [lastHeard, setLastHeard] = useState("");
  const lastHeardWordsRef = useRef<string[]>([]);

  const { listening, supported, error: recognitionError, usingFallback, start, stop } = useLiveRecognition({
    language: speechLanguage,
    onWords: (words) => {
      words.forEach((w) => {
        sessionRef.current.wordCount++;
        if (FILLER_WORDS.has(w.toLowerCase())) sessionRef.current.fillerCount++;
        // Expand contractions ("didn't" -> "did", "not") so a script
        // written in full form still aligns token-for-token with speech
        // that gets transcribed in contracted form -- see expandSpokenWord.
        expandSpokenWord(w).forEach((piece) => engine.ingestWord(piece));
      });
      lastHeardWordsRef.current = [...lastHeardWordsRef.current, ...words].slice(-8);
      setLastHeard(lastHeardWordsRef.current.join(" "));
      updateSyncState(engine.getState());
    },
  });

  useEffect(() => {
    // Reset the stage whenever we switch to a freshly (re)created engine.
    wasFrozenRef.current = false;
    setSyncState(engine.getState());
  }, [engine]);

  useEffect(() => {
    // `frozen` is a function of wall-clock time (now - lastConfidentMatchAt),
    // but state only otherwise updates inside onWords. Without this tick, a
    // genuine silent pause never shows the freeze indicator -- the UI can
    // only re-read state at the exact moment new speech arrives, which is
    // also the moment freeze is about to become false again. That defeats
    // the freeze indicator's whole purpose: telling the presenter, in real
    // time, that the app is holding position and waiting for them.
    if (!listening) return;
    const id = setInterval(() => {
      updateSyncState(engine.getState());
      if (practiceMode) {
        const { startedAt, wordCount, fillerCount } = sessionRef.current;
        const durationSec = (Date.now() - startedAt) / 1000;
        const { wpm, fillerRate } = computeSessionMetrics(wordCount, fillerCount, durationSec);
        setLiveNudge(practiceNudge(wordCount, fillerRate, wpm));
      }
    }, 300);
    return () => clearInterval(id);
  }, [listening, engine, practiceMode]);

  useEffect(() => {
    // Keep the screen from dimming/locking for as long as this rehearsal
    // screen is open -- not just while `listening` is true. Reported
    // directly: a presenter often isn't reading yet the moment they open
    // this screen (chatting with the room, telling a story, waiting for
    // quiet) and may not press Start Listening at all for a while, or may
    // pause it mid-rehearsal for the same reason -- losing the screen
    // during any of that is far more disruptive here than the battery cost
    // of staying awake for one rehearsal session.
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Can be refused (low-power mode, permissions policy, etc.) -- live
        // cueing itself still works without it, so this fails silently
        // rather than surfacing an error over something non-essential.
      }
    }
    acquire();

    // The browser releases the lock whenever the tab is backgrounded --
    // reacquire it once we're back, rather than leaving the screen able to
    // sleep for the rest of the session.
    function handleVisibility() {
      if (document.visibilityState === "visible" && !cancelled) acquire();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      sentinel?.release().catch(() => {});
    };
    // Deliberately runs once for this screen's whole lifetime (mount to
    // unmount), not re-keyed on `listening` -- see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleStart() {
    // Neither of this beta's recognizers is on-device: AssemblyAI is cloud-only
    // by design, and its fallback (the browser's Web Speech API) streams
    // audio to the browser vendor's cloud service. If the user has opted
    // into Offline Mode (privacy-sensitive use cases per the Technical
    // Architecture doc), silently starting cloud-dependent recognition
    // anyway would violate that choice, so refuse rather than guess. See the
    // `!supported || offlineModeEnabled` guard on the Start button below.
    if (offlineModeEnabled) return;
    sessionRef.current = { startedAt: Date.now(), wordCount: 0, fillerCount: 0, freezeCount: 0 };
    wasFrozenRef.current = false;
    setLatestSession(null);
    setLatestWasPractice(false);
    setLiveNudge(null);
    lastHeardWordsRef.current = [];
    setLastHeard("");
    // Whatever was scrolled into view while reviewing the script/settings
    // (on mobile, the Start button itself sits below the script) shouldn't
    // be where the presenter lands the moment they start speaking -- jump
    // back to the top of the script. Both targets matter: the rehearsal
    // stage scrolls internally on desktop's side-by-side layout, while the
    // whole page scrolls on mobile's stacked one. Element.scrollTo isn't
    // implemented in jsdom (the test environment), so this checks for it
    // rather than assuming every DOM environment has it.
    for (const selector of [".rehearsalStage", ".app__main"]) {
      const el = document.querySelector(selector);
      if (el && typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "auto" });
    }
    start();
  }

  function handleStop() {
    stop();
    setLiveNudge(null);
    const { startedAt, wordCount, fillerCount, freezeCount } = sessionRef.current;
    if (!startedAt || wordCount === 0) return;
    const durationSec = Math.max(1, (Date.now() - startedAt) / 1000);
    const { wpm, fillerRate, confidence } = computeSessionMetrics(wordCount, fillerCount, durationSec);
    const sessionData = {
      scriptId: script.id,
      date: new Date().toISOString(),
      durationSec,
      wordCount,
      fillerCount,
      wpm,
      fillerRate,
      confidence,
      freezeCount,
    };
    if (practiceMode) {
      // Same shape as a real session record for CoachReport to render, but
      // never written to storage.addSession -- a practice run gives the
      // presenter feedback without silently counting toward the "official"
      // history that adaptiveTuning.ts and the trend chart draw on. Never
      // persisted, so this id is just a placeholder to satisfy the type,
      // not a real identifier -- latestWasPractice is the actual source of
      // truth for whether this was saved, not anything about the id.
      setLatestSession({ id: "practice-session", ...sessionData });
      setLatestWasPractice(true);
    } else {
      const record = storage.addSession(sessionData);
      setLatestSession(record);
      setLatestWasPractice(false);
      setHistory(storage.getSessionsForScript(script.id));
    }
  }

  function handleReset() {
    stop();
    engine.reset();
    wasFrozenRef.current = false;
    setSyncState(engine.getState());
    setLatestSession(null);
    setLatestWasPractice(false);
    setLiveNudge(null);
    lastHeardWordsRef.current = [];
    setLastHeard("");
  }

  function saveEdits() {
    const updated = storage.updateScript(script.id, { title: title.trim() || "Untitled script", body });
    if (updated) {
      onScriptUpdated(updated);
      setMode("rehearse");
    }
  }

  function toggleOfflineCache() {
    const updated = storage.setScriptOfflineCache(script.id, !script.cachedOffline);
    if (updated) onScriptUpdated(updated);
  }

  return (
    <div className="workspace">
      <div className="workspace__header">
        <button className="workspace__back" onClick={onBack}>
          ← Scripts
        </button>
        <div className="workspace__title">{script.title}</div>
        <div className="workspace__headerActions">
          <button
            className={"btn " + (mode === "edit" ? "btn--primary" : "btn--secondary")}
            onClick={() => setMode(mode === "edit" ? "rehearse" : "edit")}
          >
            {mode === "edit" ? "Done Editing" : "Edit Script"}
          </button>
          <button
            className="btn btn--danger"
            onClick={() => {
              if (confirm(`Delete "${script.title}"?`)) onScriptDeleted(script.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <div className="workspace__editor">
          <input className="scriptForm__title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="scriptForm__body" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="scriptForm__actions">
            <button className="btn btn--primary" onClick={saveEdits}>
              Save Script
            </button>
          </div>
        </div>
      ) : (
        <div className="workspace__body">
          <div className="workspace__panel">
            <div className="panelCard">
              <h3>Live Cueing</h3>
              <div className="panelCard__row">
                {!listening ? (
                  <button
                    className="btn btn--primary"
                    onClick={handleStart}
                    disabled={!supported || offlineModeEnabled}
                  >
                    ▶ Start Listening
                  </button>
                ) : (
                  <button className="btn btn--danger" onClick={handleStop}>
                    ■ Stop
                  </button>
                )}
                <button className="btn btn--secondary" onClick={handleReset}>
                  Reset
                </button>
              </div>
              <label className="switchRow">
                <input
                  type="checkbox"
                  checked={practiceMode}
                  disabled={listening}
                  onChange={(e) => setPracticeMode(e.target.checked)}
                />
                <span>Practice Mode -- live coaching tips, doesn't count toward your session history</span>
              </label>
              {!supported && (
                <div className="panelCard__warning">
                  This browser doesn't support live speech recognition (mic access, or Chrome/Edge for
                  the fallback recognizer, is required).
                </div>
              )}
              {supported && offlineModeEnabled && (
                <div className="panelCard__warning">
                  Live cueing is off while Offline Mode is on. This beta build's only recognizer isn't
                  guaranteed on-device yet, so it won't run rather than silently break that choice.
                  Turn off Offline Mode in Settings to rehearse now.
                </div>
              )}
              {supported && !offlineModeEnabled && recognitionError && (
                <div className="panelCard__warning" role="alert">
                  {recognitionError}
                </div>
              )}
              <div className={"panelCard__status" + (listening ? " panelCard__status--live" : "")}>
                {listening ? "● Listening" : "Stopped"}
                {listening && usingFallback && " (browser fallback)"}
              </div>
              {listening && (
                <div className="panelCard__lastHeard" aria-live="polite">
                  Last heard: <span>{lastHeard || "(nothing yet -- check mic input)"}</span>
                </div>
              )}
              {listening && practiceMode && liveNudge && (
                <div className="panelCard__nudge" aria-live="polite">
                  💬 {liveNudge}
                </div>
              )}
              <div className="panelCard__disclosure">
                {usingFallback
                  ? "AssemblyAI (this beta's low-latency recognizer) isn't reachable right now, so this session fell back to your browser's built-in speech recognition. In most browsers (e.g. Chrome), that means audio is sent to the browser vendor's cloud service for transcription."
                  : "Audio streams to AssemblyAI for low-latency transcription via FlowCue AI's own relay -- the AssemblyAI API key stays on that server and never reaches this page."}{" "}
                FlowCue AI itself does not store audio. Fully on-device recognition is planned but not
                yet available (see Offline Mode in Settings).
              </div>
              {adaptiveTuning.isPersonalized && (
                <div className="panelCard__disclosure">
                  Personalized to how live cueing has tracked you on this device over your last{" "}
                  {adaptiveTuning.sessionsUsed} sessions -- entirely local, nothing about your speech is
                  sent anywhere to compute this.
                </div>
              )}
            </div>

            <div className="panelCard">
              <h3>Visual Reading Mode</h3>
              <div className="toggleGroup" role="group" aria-label="Visual reading mode">
                {VISUAL_MODE_LABELS.map(({ mode: m, label }) => (
                  <button
                    key={m}
                    className={"toggle" + (visualMode === m ? " toggle--active" : "")}
                    onClick={() => setVisualMode(m)}
                    aria-pressed={visualMode === m}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visualMode === "focus" && (
                <p className="panelCard__hint">
                  Only the current line and its neighbors stay legible -- a narrow reading window like
                  physical teleprompter hardware, to cut down on eye movement.
                </p>
              )}
              {visualMode === "confidence" && (
                <p className="panelCard__hint">
                  The active line's color reflects how confidently the engine is tracking you right
                  now, not just a binary frozen/not.
                </p>
              )}
              <label className="switchRow">
                <input type="checkbox" checked={mirrorFlip} onChange={(e) => setMirrorFlip(e.target.checked)} />
                <span>Mirror flip (for physical teleprompter glass rigs)</span>
              </label>
            </div>

            <div className="panelCard">
              <h3>Offline</h3>
              <label className="switchRow">
                <input type="checkbox" checked={script.cachedOffline} onChange={toggleOfflineCache} />
                <span>{script.cachedOffline ? "Cached for offline rehearsal" : "Not cached for offline use"}</span>
              </label>
            </div>

            <CoachReport latest={latestSession} history={history} isPractice={latestWasPractice} />
          </div>

          <RehearsalStage
            sentences={engine.sentences}
            tokens={engine.tokens}
            state={syncState}
            visualMode={visualMode}
            listening={listening}
            mirrorFlip={mirrorFlip}
            syllabifyLongWords={syllabifyLongWords}
          />
        </div>
      )}
    </div>
  );
}
