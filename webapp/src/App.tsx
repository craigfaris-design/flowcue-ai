import { useEffect, useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { Library } from "./components/Library";
import { ScriptWorkspace } from "./components/ScriptWorkspace";
import { SettingsView } from "./components/SettingsView";
import { Onboarding } from "./components/Onboarding";
import * as storage from "./lib/storage";
import type { Script, Settings } from "./lib/types";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [scripts, setScripts] = useState<Script[]>(() => storage.getScripts());
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => storage.getSettings());
  const [showOnboarding, setShowOnboarding] = useState(() => !storage.getSettings().onboardingComplete);

  useEffect(() => {
    document.title = "FlowCue AI";
  }, []);

  useEffect(() => {
    // Removes the static pulsing-logo splash (index.html) now that the real
    // app has actually painted -- runs after this component's first commit,
    // which is the right moment (not a fixed timer, which could cut the
    // splash before content is ready or leave it lingering after).
    document.getElementById("flowcueSplash")?.remove();
  }, []);

  function refreshScripts() {
    setScripts(storage.getScripts());
  }

  function handleCreate(title: string, body: string) {
    const script = storage.createScript(title, body);
    refreshScripts();
    setActiveScriptId(script.id);
  }

  function handleDelete(id: string) {
    storage.deleteScript(id);
    refreshScripts();
    if (activeScriptId === id) setActiveScriptId(null);
  }

  function handleScriptUpdated(updated: Script) {
    refreshScripts();
    if (activeScriptId === updated.id) {
      // no-op: ScriptWorkspace reads the fresh copy via `scripts` on next render
    }
  }

  function dismissOnboarding() {
    setShowOnboarding(false);
    setSettings(storage.saveSettings({ onboardingComplete: true }));
  }

  function handleSettingsChange(patch: Partial<Settings>) {
    setSettings(storage.saveSettings(patch));
  }

  function handleClearAllData() {
    localStorage.clear();
    setScripts([]);
    setActiveScriptId(null);
    setSettings(storage.getSettings());
    setView("library");
  }

  const activeScript = scripts.find((s) => s.id === activeScriptId) || null;

  return (
    <div className="app">
      <Sidebar
        view={activeScript ? "library" : view}
        onNavigate={(v) => {
          setActiveScriptId(null);
          setView(v);
        }}
      />
      <main className="app__main">
        {activeScript ? (
          <ScriptWorkspace
            script={activeScript}
            defaultVisualMode={settings.visualMode}
            offlineModeEnabled={settings.offlineModeEnabled}
            syllabifyLongWords={settings.syllabifyLongWords}
            speechLanguage={settings.speechLanguage}
            shareAnonymousMetrics={settings.shareAnonymousMetrics}
            onBack={() => setActiveScriptId(null)}
            onScriptUpdated={handleScriptUpdated}
            onScriptDeleted={handleDelete}
          />
        ) : view === "library" ? (
          <Library scripts={scripts} onOpen={setActiveScriptId} onCreate={handleCreate} onDelete={handleDelete} />
        ) : (
          <SettingsView settings={settings} onChange={handleSettingsChange} onClearAllData={handleClearAllData} />
        )}
      </main>
      {showOnboarding && <Onboarding onDismiss={dismissOnboarding} />}
    </div>
  );
}
