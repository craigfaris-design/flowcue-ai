import type { Settings } from "../lib/types";
import { VISUAL_MODE_LABELS } from "../lib/types";
import "./SettingsView.css";

interface SettingsViewProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClearAllData: () => void;
}

export function SettingsView({ settings, onChange, onClearAllData }: SettingsViewProps) {
  return (
    <div className="settingsView">
      <div className="settingsView__header">
        <h1 className="gradientText">Settings</h1>
      </div>

      <div className="settingsCard">
        <h3>Default Visual Reading Mode</h3>
        <p>Applies to newly opened scripts. You can still override it per-session.</p>
        <div className="toggleGroup toggleGroup--light" role="group" aria-label="Default visual reading mode">
          {VISUAL_MODE_LABELS.map(({ mode: m, label }) => (
            <button
              key={m}
              className={"toggle toggle--light" + (settings.visualMode === m ? " toggle--active" : "")}
              onClick={() => onChange({ visualMode: m })}
              aria-pressed={settings.visualMode === m}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="settingsCard">
        <h3>Syllable Breaks</h3>
        <p>
          Inserts a middle-dot between syllables of long or complicated words in the reading text
          (e.g. "com·mu·ni·ca·tion"), so they're easier to read out loud at a glance. Display only
          -- it doesn't change the script itself or how live cueing tracks your speech.
        </p>
        <label className="switchRow switchRow--light">
          <input
            type="checkbox"
            checked={settings.syllabifyLongWords}
            onChange={(e) => onChange({ syllabifyLongWords: e.target.checked })}
          />
          <span>Break up long words into syllables</span>
        </label>
      </div>

      <div className="settingsCard">
        <h3>Offline Mode</h3>
        <p>
          For privacy-sensitive rehearsals, restricts FlowCue AI to on-device-only speech
          recognition (see the Technical Architecture doc's hybrid on-device/cloud plan). Not yet
          available in this beta build: this build's only recognizer isn't guaranteed on-device, so
          enabling this turns off live cueing entirely rather than silently sending audio to the
          cloud anyway.
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
