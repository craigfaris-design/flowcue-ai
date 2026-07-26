import { useEffect, useMemo, useRef, useState } from "react";
import { SyncEngine, type SyncState } from "../engine/syncEngine";
import { useLiveRecognition } from "../hooks/useLiveRecognition";
import type { Script, SessionRecord, VisualMode } from "../lib/types";
import * as storage from "../lib/storage";
import { RehearsalStage } from "./RehearsalStage";
import { CoachReport } from "./CoachReport";
import "./ScriptWorkspace.css";

interface ScriptWorkspaceProps {
  script: Script;
  defaultVisualMode: VisualMode;
  offlineModeEnabled: boolean;
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
  onBack,
  onScriptUpdated,
  onScriptDeleted,
}: ScriptWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("rehearse");
  const [title, setTitle] = useState(script.title);
  const [body, setBody] = useState(script.body);
  const [visualMode, setVisualMode] = useState<VisualMode>(defaultVisualMode);
  const [history, setHistory] = useState<SessionRecord[]>(() => storage.getSessionsForScript(script.id));
  const [latestSession, setLatestSession] = useState<SessionRecord | null>(null);

  // The SyncEngine instance is recreated only when the *committed* script body
  // changes (i.e. after Save), not on every keystroke while editing.
  const engine = useMemo(() => new SyncEngine(script.body), [script.body]);
  const [syncState, setSyncState] = useState<SyncState>(() => engine.getState());

  const sessionRef = useRef({ startedAt: 0, wordCount: 0, fillerCount: 0 });
  // Surfaces exactly what the recognizer is actually hearing, independent of
  // whether it matches the script. Without this, "frozen" is ambiguous: is
  // the mic not picking up speech at all, or is it hearing words that just
  // aren't confidently matching? This makes that distinction visible instead
  // of leaving the presenter (or anyone debugging a report of it) to guess.
  const [lastHeard, setLastHeard] = useState("");
  const lastHeardWordsRef = useRef<string[]>([]);

  const { listening, supported, error: recognitionError, usingFallback, start, stop } = useLiveRecognition({
    onWords: (words) => {
      words.forEach((w) => {
        sessionRef.current.wordCount++;
        if (FILLER_WORDS.has(w.toLowerCase())) sessionRef.current.fillerCount++;
        engine.ingestWord(w);
      });
      lastHeardWordsRef.current = [...lastHeardWordsRef.current, ...words].slice(-8);
      setLastHeard(lastHeardWordsRef.current.join(" "));
      setSyncState(engine.getState());
    },
  });

  useEffect(() => {
    // Reset the stage whenever we switch to a freshly (re)created engine.
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
    const id = setInterval(() => setSyncState(engine.getState()), 300);
    return () => clearInterval(id);
  }, [listening, engine]);

  function handleStart() {
    // Neither of this beta's recognizers is on-device: Deepgram is cloud-only
    // by design, and its fallback (the browser's Web Speech API) streams
    // audio to the browser vendor's cloud service. If the user has opted
    // into Offline Mode (privacy-sensitive use cases per the Technical
    // Architecture doc), silently starting cloud-dependent recognition
    // anyway would violate that choice, so refuse rather than guess. See the
    // `!supported || offlineModeEnabled` guard on the Start button below.
    if (offlineModeEnabled) return;
    sessionRef.current = { startedAt: Date.now(), wordCount: 0, fillerCount: 0 };
    setLatestSession(null);
    lastHeardWordsRef.current = [];
    setLastHeard("");
    start();
  }

  function handleStop() {
    stop();
    const { startedAt, wordCount, fillerCount } = sessionRef.current;
    if (!startedAt || wordCount === 0) return;
    const durationSec = Math.max(1, (Date.now() - startedAt) / 1000);
    const wpm = Math.round((wordCount / durationSec) * 60);
    const fillerRate = wordCount ? (fillerCount / wordCount) * 100 : 0;
    const confidence = Math.max(0, Math.min(100, 100 - fillerRate * 4 - Math.abs(wpm - 140) / 2));
    const record = storage.addSession({
      scriptId: script.id,
      date: new Date().toISOString(),
      durationSec,
      wordCount,
      fillerCount,
      wpm,
      fillerRate,
      confidence,
    });
    setLatestSession(record);
    setHistory(storage.getSessionsForScript(script.id));
  }

  function handleReset() {
    stop();
    engine.reset();
    setSyncState(engine.getState());
    setLatestSession(null);
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
              <div className="panelCard__disclosure">
                {usingFallback
                  ? "Deepgram (this beta's low-latency recognizer) isn't reachable right now, so this session fell back to your browser's built-in speech recognition. In most browsers (e.g. Chrome), that means audio is sent to the browser vendor's cloud service for transcription."
                  : "Audio streams to Deepgram for low-latency transcription via FlowCue AI's own relay -- the Deepgram API key stays on that server and never reaches this page."}{" "}
                FlowCue AI itself does not store audio. Fully on-device recognition is planned but not
                yet available (see Offline Mode in Settings).
              </div>
            </div>

            <div className="panelCard">
              <h3>Visual Reading Mode</h3>
              <div className="toggleGroup" role="group" aria-label="Visual reading mode">
                <button
                  className={"toggle" + (visualMode === "sentence" ? " toggle--active" : "")}
                  onClick={() => setVisualMode("sentence")}
                  aria-pressed={visualMode === "sentence"}
                >
                  Sentence glow
                </button>
                <button
                  className={"toggle" + (visualMode === "word" ? " toggle--active" : "")}
                  onClick={() => setVisualMode("word")}
                  aria-pressed={visualMode === "word"}
                >
                  Word karaoke
                </button>
              </div>
            </div>

            <div className="panelCard">
              <h3>Offline</h3>
              <label className="switchRow">
                <input type="checkbox" checked={script.cachedOffline} onChange={toggleOfflineCache} />
                <span>{script.cachedOffline ? "Cached for offline rehearsal" : "Not cached for offline use"}</span>
              </label>
            </div>

            <CoachReport latest={latestSession} history={history} />
          </div>

          <RehearsalStage
            sentences={engine.sentences}
            tokens={engine.tokens}
            state={syncState}
            visualMode={visualMode}
            listening={listening}
          />
        </div>
      )}
    </div>
  );
}
