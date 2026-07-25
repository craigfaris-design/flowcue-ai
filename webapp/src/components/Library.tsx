import { useState } from "react";
import type { Script } from "../lib/types";
import "./Library.css";

interface LibraryProps {
  scripts: Script[];
  onOpen: (id: string) => void;
  onCreate: (title: string, body: string) => void;
  onDelete: (id: string) => void;
}

const SAMPLE_BODY = `Good evening, everyone, and thank you for being here tonight.
When Sarah first told me she was getting married, I honestly did not believe her.
We have been best friends since the third grade, and I have seen her through everything.
Tonight is not about the past, though. It is about the future she is building with James.
So please raise your glass and join me in wishing them a lifetime of happiness.`;

function wordCount(body: string): number {
  return body.trim() ? body.trim().split(/\s+/).length : 0;
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Library({ scripts, onOpen, onCreate, onDelete }: LibraryProps) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function startCreate(useSample: boolean) {
    setTitle(useSample ? "Sarah's Wedding Toast" : "");
    setBody(useSample ? SAMPLE_BODY : "");
    setCreating(true);
  }

  function submitCreate() {
    const finalTitle = title.trim() || "Untitled script";
    onCreate(finalTitle, body);
    setCreating(false);
    setTitle("");
    setBody("");
  }

  return (
    <div className="library">
      <div className="library__header">
        <h1>Your Scripts</h1>
        <div className="library__actions">
          <button className="btn btn--secondary" onClick={() => startCreate(true)}>
            Try a sample script
          </button>
          <button className="btn btn--primary" onClick={() => startCreate(false)}>
            + New Script
          </button>
        </div>
      </div>

      {scripts.length === 0 && !creating && (
        <div className="library__empty">
          No scripts yet. Paste a speech to start rehearsing — FlowCue AI will follow along as you
          speak, even if you pause, skip ahead, or go off-script.
        </div>
      )}

      {!creating && (
        <div className="library__grid">
          {scripts.map((s) => (
            <div
              key={s.id}
              className="scriptCard"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(s.id);
                }
              }}
              aria-label={`Open ${s.title}`}
            >
              <div className="scriptCard__title">{s.title}</div>
              <div className="scriptCard__meta">
                {wordCount(s.body)} words · updated {relativeDate(s.updatedAt)}
              </div>
              {s.cachedOffline && <div className="scriptCard__badge">Cached offline</div>}
              <button
                className="scriptCard__delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${s.title}"? This also removes its rehearsal history.`)) {
                    onDelete(s.id);
                  }
                }}
                aria-label={`Delete ${s.title}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="scriptForm">
          <input
            className="scriptForm__title"
            placeholder="Script title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <textarea
            className="scriptForm__body"
            placeholder="Paste your speech here..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="scriptForm__actions">
            <button className="btn btn--secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={submitCreate} disabled={!body.trim()}>
              Save Script
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
