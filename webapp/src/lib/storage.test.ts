import { describe, it, expect, beforeEach } from "vitest";
import {
  createScript,
  getScripts,
  updateScript,
  deleteScript,
  setScriptOfflineCache,
  addSession,
  getSessionsForScript,
  getSettings,
  saveSettings,
} from "./storage";

beforeEach(() => {
  localStorage.clear();
});

describe("storage", () => {
  it("creates and retrieves scripts", () => {
    createScript("Wedding Toast", "Hello everyone.");
    const scripts = getScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].title).toBe("Wedding Toast");
  });

  it("updates a script's body and bumps updatedAt", async () => {
    const s = createScript("Toast", "v1");
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateScript(s.id, { body: "v2" });
    expect(updated?.body).toBe("v2");
    expect(updated?.updatedAt).not.toBe(s.updatedAt);
  });

  it("deletes a script and its sessions", () => {
    const s = createScript("Toast", "body");
    addSession({ scriptId: s.id, date: new Date().toISOString(), durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 90 });
    deleteScript(s.id);
    expect(getScripts()).toHaveLength(0);
    expect(getSessionsForScript(s.id)).toHaveLength(0);
  });

  it("toggles offline cache flag", () => {
    const s = createScript("Toast", "body");
    const cached = setScriptOfflineCache(s.id, true);
    expect(cached?.cachedOffline).toBe(true);
    expect(cached?.cachedAt).toBeDefined();
  });

  it("stores sessions per script and sorts by date", () => {
    const s = createScript("Toast", "body");
    addSession({ scriptId: s.id, date: "2026-01-02T00:00:00.000Z", durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 90 });
    addSession({ scriptId: s.id, date: "2026-01-01T00:00:00.000Z", durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 85 });
    const sessions = getSessionsForScript(s.id);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].date).toBe("2026-01-01T00:00:00.000Z");
  });

  it("persists settings", () => {
    expect(getSettings().onboardingComplete).toBe(false);
    saveSettings({ onboardingComplete: true, visualMode: "word" });
    expect(getSettings().onboardingComplete).toBe(true);
    expect(getSettings().visualMode).toBe("word");
  });
});
