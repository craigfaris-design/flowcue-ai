import { useEffect, useMemo, useRef, useState } from "react";
import { SyncEngine, type SyncState } from "../engine/syncEngine";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import type { Script, SessionRecord, VisualMode } from "../lib/types";
import * as storage from "../lib/storage";
import { RehearsalStage } from "./RehearsalStage";
import { CoachReport } from "./CoachReport";
import "./ScriptWorkspace.css";

interface ScriptWorkspaceProps {
  script: Script;
  defaultVisualMode: VisualMode;
  onBack: () => void;
  onScriptUpdated: (script: Script) => void;
  onScriptDeleted: (id: string) => void;
}

const FILLER_WORDS = new Set(["um", "uh", "like", "actually", "basically", "literally", "sort", "kind"]);

type Mode = "edit" | "rehearse";

export function ScriptWorkspace({ script, defaultVisualMode, onBack, onScriptUpdated, onScriptDeleted }: ScriptWorkspaceProps) {
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

  const { listening, supported, error: recognitionError, start, stop } = useSpeechRecognition({
    onWords: (words) => {
      words.forEach((w) => {
        sessionRef.current.wordCount++;
        if (FILLER_WORDS.has(w.toLowerCase())) sessionRef.current.fillerCount++;
        engine.ingestWord(w);
      });
      setSyncState(engine.getState());
    },
  });

  useEffect(() => {
    // Reset the stage whenever we switch to a freshly (re)created engine.
    setSyncState(engine.getState());
  }, [engine]);

  function handleStart() {
    sessionRef.current = { startedAt: Date.now(), wordCount: 0, fillerCount: 0 };
    setLatestSession(null);
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
              {!supported && (
                <div className="panelCard__warning">
                  This browser doesn't support live speech recognition (Chrome/Edge recommended).
                </div>
              )}
              {supported && recognitionError && (
                <div className="panelCard__warning" role="alert">
                  {recognitionError}
                </div>
              )}
              <div className={"panelCard__status" + (listening ? " panelCard__status--live" : "")}>
                {listening ? "● Listening" : "Stopped"}
              </div>
              <div className="panelCard__disclosure">
                Audio is processed locally in your browser. It is not stored or sent anywhere by
                default.
              </div>
            </div>

            <div className="panelCard">
              <h3>Visual Reading Mode</h3>
              <div className="toggleGroup">
                <button
                  className={"toggle" + (visualMode === "sentence" ? " toggle--active" : "")}
                  onClick={() => setVisualMode("sentence")}
                >
                  Sentence glow
                </button>
                <button
                  className={"toggle" + (visualMode === "word" ? " toggle--active" : "")}
                  onClick={() => setVisualMode("word")}
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
