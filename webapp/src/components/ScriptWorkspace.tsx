import { useEffect, useMemo, useRef, useState } from "react";
import { SyncEngine, expandSpokenWord, type SyncState } from "../engine/syncEngine";
import { PacedCursor, DEFAULT_WPM, MIN_WPM, MAX_WPM } from "../engine/pacedCursor";
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

  // Offline Reading: neither speech recognizer here is on-device (AssemblyAI
  // is cloud-only by design, its fallback streams to the browser vendor's
  // cloud too), so with no wifi/cellular there's nothing for SyncEngine to
  // listen to. This is the alternative path -- see pacedCursor.ts -- that
  // needs no network or mic at all. `offlineReadingActive` is the session-
  // only manual opt-in (via the "Read offline instead" link below); the
  // Settings toggle `offlineModeEnabled` forces it on unconditionally, same
  // intent that toggle already had ("don't let this app touch the network"),
  // just actually usable now instead of a dead end.
  const [offlineReadingActive, setOfflineReadingActive] = useState(false);
  const showOfflineReading = offlineModeEnabled || offlineReadingActive;

  // Personalizes the starting pace from this device's own rehearsal history
  // (same source adaptiveTuning.ts already reads), falling back to the same
  // 140wpm center sessionMetrics.ts treats as "ideal" when there isn't any
  // yet -- computed once per mount, like adaptiveTuning above, so it can't
  // shift under the presenter mid-session.
  const defaultWpm = useMemo(() => {
    const recent = storage.getRecentSessions(10).filter((s) => s.wordCount > 0);
    if (!recent.length) return DEFAULT_WPM;
    const avg = recent.reduce((sum, s) => sum + s.wpm, 0) / recent.length;
    return Math.round(Math.max(MIN_WPM, Math.min(MAX_WPM, avg)));
  }, []);
  const [wpm, setWpm] = useState(defaultWpm);
  // Recreated only when the script body changes (mirrors `engine` above),
  // deliberately NOT when `wpm` changes -- a pace adjustment should glide,
  // not reset the reader back to the start. setWpm() (the method) is the
  // only thing allowed to change pace after creation; see handleWpmChange.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pacedCursor = useMemo(() => new PacedCursor(script.body, wpm), [script.body]);
  const [pacedSyncState, setPacedSyncState] = useState<SyncState>(() => pacedCursor.getState());
  const [offlinePlaying, setOfflinePlaying] = useState(false);

  useEffect(() => {
    // Reset whenever we switch to a freshly (re)created cursor, same as the
    // SyncEngine reset effect below.
    setOfflinePlaying(false);
    setPacedSyncState(pacedCursor.getState());
  }, [pacedCursor]);

  useEffect(() => {
    if (!offlinePlaying) return;
    const id = setInterval(() => {
      setPacedSyncState(pacedCursor.getState());
      if (pacedCursor.reachedEnd()) {
        pacedCursor.pause();
        setOfflinePlaying(false);
      }
    }, 300);
    return () => clearInterval(id);
  }, [offlinePlaying, pacedCursor]);

  function handleOfflineStart() {
    pacedCursor.start();
    setOfflinePlaying(true);
    setPacedSyncState(pacedCursor.getState());
    for (const selector of [".rehearsalStage", ".app__main"]) {
      const el = document.querySelector(selector);
      if (el && typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "auto" });
    }
  }
  function handleOfflinePause() {
    pacedCursor.pause();
    setOfflinePlaying(false);
    setPacedSyncState(pacedCursor.getState());
  }
  function handleOfflineReset() {
    pacedCursor.reset();
    setOfflinePlaying(false);
    setPacedSyncState(pacedCursor.getState());
  }
  function handleOfflineJump(sentenceIndex: number) {
    pacedCursor.jumpToSentence(sentenceIndex);
    setPacedSyncState(pacedCursor.getState());
  }
  function handleWpmChange(nextWpm: number) {
    const clamped = Math.max(MIN_WPM, Math.min(MAX_WPM, nextWpm));
    pacedCursor.setWpm(clamped);
    setWpm(clamped);
  }

  // Drives the "no internet connection" proactive suggestion below --
  // `navigator.onLine` false is reliable (a real offline signal); true
  // doesn't guarantee real connectivity (e.g. wifi with no internet), so
  // this only ever *offers* Offline Reading, never blocks live cueing.
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    function goOnline() {
      setIsOnline(true);
    }
    function goOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

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

  const { listening, supported, error: recognitionError, usingFallback, ready, start, stop } = useLiveRecognition({
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

  // Elapsed time since Start was pressed, while still connecting -- counts
  // up (not a fake countdown to a guessed number, since actual connect time
  // varies) so a nervous presenter has something concrete to look at
  // instead of a static "Connecting…" that might as well be frozen.
  const [connectingSeconds, setConnectingSeconds] = useState(0);
  const connectStartRef = useRef<number | null>(null);

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
      if (connectStartRef.current !== null) {
        setConnectingSeconds(Math.floor((Date.now() - connectStartRef.current) / 1000));
      }
      if (practiceMode) {
        const { startedAt, wordCount, fillerCount } = sessionRef.current;
        const durationSec = (Date.now() - startedAt) / 1000;
        const { wpm, fillerRate } = computeSessionMetrics(wordCount, fillerCount, durationSec);
        setLiveNudge(practiceNudge(wordCount, fillerRate, wpm, adaptiveTuning.paceRange));
      }
    }, 300);
    return () => clearInterval(id);
  }, [listening, engine, practiceMode]);

  useEffect(() => {
    // Stop ticking the moment we're actually ready -- connectStartRef being
    // non-null is exactly what gates the tick above, so clearing it here
    // (rather than in the interval itself) is the single place that turns
    // the counter off regardless of which path got here (ready, stopped, or
    // an error mid-connect).
    if (ready || !listening) connectStartRef.current = null;
  }, [ready, listening]);

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
    // into Offline Mode (privacy-sensitive use cases, or genuinely no
    // connection -- see PacedCursor/showOfflineReading above), silently
    // starting cloud-dependent recognition anyway would violate that
    // choice, so refuse rather than guess. Defensive only: the Start
    // Listening button itself isn't rendered at all while
    // showOfflineReading is true (see the panel below), so this shouldn't
    // be reachable through the UI.
    if (showOfflineReading) return;
    sessionRef.current = { startedAt: Date.now(), wordCount: 0, fillerCount: 0, freezeCount: 0 };
    wasFrozenRef.current = false;
    setLatestSession(null);
    setLatestWasPractice(false);
    setLiveNudge(null);
    lastHeardWordsRef.current = [];
    setLastHeard("");
    connectStartRef.current = Date.now();
    setConnectingSeconds(0);
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
              <h3>{showOfflineReading ? "Offline Reading" : "Live Cueing"}</h3>
              {showOfflineReading ? (
                <>
                  <div className="panelCard__row">
                    {!offlinePlaying ? (
                      <button className="btn btn--primary" onClick={handleOfflineStart}>
                        ▶ {pacedSyncState.cursorTokenIndex === -1 ? "Start Reading" : "Resume"}
                      </button>
                    ) : (
                      <button className="btn btn--danger" onClick={handleOfflinePause}>
                        ⏸ Pause
                      </button>
                    )}
                    <button className="btn btn--secondary" onClick={handleOfflineReset}>
                      Reset
                    </button>
                  </div>
                  <div className="panelCard__row panelCard__wpmRow">
                    <span className="panelCard__wpmLabel">Pace</span>
                    <button
                      className="btn btn--secondary btn--small"
                      onClick={() => handleWpmChange(wpm - 10)}
                      aria-label="Slower"
                      disabled={wpm <= MIN_WPM}
                    >
                      −
                    </button>
                    <span className="panelCard__wpmValue">{wpm} wpm</span>
                    <button
                      className="btn btn--secondary btn--small"
                      onClick={() => handleWpmChange(wpm + 10)}
                      aria-label="Faster"
                      disabled={wpm >= MAX_WPM}
                    >
                      +
                    </button>
                  </div>
                  <div className={"panelCard__status" + (offlinePlaying ? " panelCard__status--live" : "")}>
                    {offlinePlaying ? "● Reading (paced, offline)" : "Stopped"}
                  </div>
                  <div className="panelCard__disclosure">
                    No mic or internet connection is used here -- the script advances on its own at the
                    pace above. Tap any line (or a word, same as pronunciation help) to jump straight
                    there if it gets ahead of or behind your actual speaking.
                  </div>
                  {!offlineModeEnabled && (
                    <button className="btn--link" onClick={() => setOfflineReadingActive(false)}>
                      Switch back to live cueing
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="panelCard__row">
                    {!listening ? (
                      <button className="btn btn--primary" onClick={handleStart} disabled={!supported}>
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
                  {!isOnline && (
                    <div className="panelCard__warning" role="alert">
                      No internet connection detected -- live cueing needs one.{" "}
                      <button className="btn--link" onClick={() => setOfflineReadingActive(true)}>
                        Read offline instead
                      </button>
                    </div>
                  )}
                  {supported && recognitionError && (
                    <div className="panelCard__warning" role="alert">
                      {recognitionError}{" "}
                      <button className="btn--link" onClick={() => setOfflineReadingActive(true)}>
                        Read offline instead
                      </button>
                    </div>
                  )}
                  <div className={"panelCard__status" + (listening && ready ? " panelCard__status--live" : "")}>
                    {listening ? (ready ? "● Listening" : `Connecting${connectingSeconds > 0 ? ` (${connectingSeconds}s)` : ""}…`) : "Stopped"}
                    {listening && ready && usingFallback && " (browser fallback)"}
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
                    FlowCue AI itself does not store audio.
                  </div>
                  {adaptiveTuning.isPersonalized && (
                    <div className="panelCard__disclosure">
                      Personalized to how live cueing has tracked you -- and, in Practice Mode, to your own
                      natural pace ({adaptiveTuning.paceRange.slowWpm}-{adaptiveTuning.paceRange.fastWpm} wpm)
                      -- based on your last {adaptiveTuning.sessionsUsed} sessions on this device. Entirely
                      local; nothing about your speech is sent anywhere to compute this.
                    </div>
                  )}
                  <button className="btn--link" onClick={() => setOfflineReadingActive(true)}>
                    Read offline instead (no mic or internet needed)
                  </button>
                </>
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
              <h3>Offline Script Storage</h3>
              <label className="switchRow">
                <input type="checkbox" checked={script.cachedOffline} onChange={toggleOfflineCache} />
                <span>{script.cachedOffline ? "Cached for offline rehearsal" : "Not cached for offline use"}</span>
              </label>
              <p className="panelCard__hint">
                Every script already lives on this device (there's no server dependency for the script
                text itself) -- this just badges it in your Library as one you've deliberately kept for
                offline use.
              </p>
            </div>

            <CoachReport latest={latestSession} history={history} isPractice={latestWasPractice} />
          </div>

          <RehearsalStage
            sentences={engine.sentences}
            tokens={engine.tokens}
            state={showOfflineReading ? pacedSyncState : syncState}
            visualMode={visualMode}
            listening={showOfflineReading ? true : listening}
            ready={showOfflineReading ? true : ready}
            connectingSeconds={connectingSeconds}
            mirrorFlip={mirrorFlip}
            syllabifyLongWords={syllabifyLongWords}
            onSentenceTap={showOfflineReading ? handleOfflineJump : undefined}
          />
        </div>
      )}
    </div>
  );
}
