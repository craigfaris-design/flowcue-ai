import { useRef, useState, type ChangeEvent } from "react";
import type { Script } from "../lib/types";
import { extractScriptFromFile } from "../lib/importScript";
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startCreate(useSample: boolean) {
    setTitle(useSample ? "Sarah's Wedding Toast" : "");
    setBody(useSample ? SAMPLE_BODY : "");
    setCreating(true);
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately (not after the async work below) so choosing the
    // exact same file again still fires this handler -- browsers don't
    // re-fire onChange for an unchanged file list otherwise.
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    setImporting(true);
    try {
      const imported = await extractScriptFromFile(file);
      setTitle(imported.title);
      setBody(imported.body);
      setCreating(true);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not import that file.");
    } finally {
      setImporting(false);
    }
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
        <h1 className="gradientText">Your Scripts</h1>
        <div className="library__actions">
          <button className="btn btn--secondary" onClick={() => startCreate(true)}>
            Try a sample script
          </button>
          <button className="btn btn--primary" onClick={() => startCreate(false)}>
            + New Script
          </button>
          <button
            className="btn btn--secondary"
            onClick={() => {
              setImportError(null);
              fileInputRef.current?.click();
            }}
            disabled={importing}
          >
            {importing ? "Importing…" : "+ Import File"}
          </button>
          {/* Hidden -- the visible control is the button above, which just
              forwards the click so the native file-picker UI can be styled
              consistently with every other button instead of showing the
              browser's own unstyled "Choose File" input. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileSelected}
            style={{ display: "none" }}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      </div>

      {importError && (
        <div className="library__importError" role="alert">
          {importError}
        </div>
      )}

      {scripts.length === 0 && !creating && (
        <div className="library__empty">
          <span className="logoGlow logoGlow--lg">
            {/* Icon-only asset here, not the full icon+wordmark lockup (logo.png)
                -- that lockup's wordmark is white text designed for a dark
                background and reads as barely-visible on this light card. */}
            <img src="/logo-icon.png" alt="" className="library__emptyLogo" />
          </span>
          <h2>Nothing rehearsed yet</h2>
          <p>
            Paste a speech to start rehearsing — FlowCue AI will follow along as you speak, even if
            you pause, skip ahead, or go off-script.
          </p>
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
