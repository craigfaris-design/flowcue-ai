import type { Settings, VisualMode } from "../lib/types";
import "./SettingsView.css";

interface SettingsViewProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClearAllData: () => void;
}

export function SettingsView({ settings, onChange, onClearAllData }: SettingsViewProps) {
  return (
    <div className="settingsView">
      <h1>Settings</h1>

      <div className="settingsCard">
        <h3>Default Visual Reading Mode</h3>
        <p>Applies to newly opened scripts. You can still override it per-session.</p>
        <div className="toggleGroup toggleGroup--light">
          {(["sentence", "word"] as VisualMode[]).map((m) => (
            <button
              key={m}
              className={"toggle toggle--light" + (settings.visualMode === m ? " toggle--active" : "")}
              onClick={() => onChange({ visualMode: m })}
            >
              {m === "sentence" ? "Sentence glow" : "Word karaoke"}
            </button>
          ))}
        </div>
      </div>

      <div className="settingsCard">
        <h3>Offline Mode</h3>
        <p>
          When enabled, scripts you mark "Cached for offline rehearsal" pre-load their text and
          rely only on on-device recognition, so a bad venue Wi-Fi never breaks the cue (see the
          Technical Architecture doc's hybrid on-device/cloud plan).
        </p>
        <label className="switchRow switchRow--light">
          <input
            type="checkbox"
            checked={settings.offlineModeEnabled}
            onChange={(e) => onChange({ offlineModeEnabled: e.target.checked })}
          />
          <span>Offline mode enabled</span>
        </label>
      </div>

      <div className="settingsCard">
        <h3>Data</h3>
        <p>
          Scripts, session history, and preferences are currently stored locally in this browser
          (see the Technical Architecture doc for the planned account-based sync service).
        </p>
        <button
          className="btn btn--danger"
          onClick={() => {
            if (confirm("This deletes all scripts and rehearsal history stored in this browser. Continue?")) {
              onClearAllData();
            }
          }}
        >
          Clear all local data
        </button>
      </div>
    </div>
  );
}
