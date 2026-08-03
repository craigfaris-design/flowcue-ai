import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createScript,
  getScripts,
  getScript,
  updateScript,
  deleteScript,
  setScriptOfflineCache,
  addSession,
  getSessionsForScript,
  getRecentSessions,
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

  it("getRecentSessions returns the most recent sessions across all scripts, newest first, capped at the limit", () => {
    const a = createScript("A", "body");
    const b = createScript("B", "body");
    addSession({ scriptId: a.id, date: "2026-01-01T00:00:00.000Z", durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 90 });
    addSession({ scriptId: b.id, date: "2026-01-03T00:00:00.000Z", durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 90 });
    addSession({ scriptId: a.id, date: "2026-01-02T00:00:00.000Z", durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 90 });

    const recent = getRecentSessions(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].date).toBe("2026-01-03T00:00:00.000Z");
    expect(recent[1].date).toBe("2026-01-02T00:00:00.000Z");
  });

  it("persists settings", () => {
    expect(getSettings().onboardingComplete).toBe(false);
    saveSettings({ onboardingComplete: true, visualMode: "word" });
    expect(getSettings().onboardingComplete).toBe(true);
    expect(getSettings().visualMode).toBe("word");
  });

  // ---------- QuotaExceededError / write failures ----------

  describe("when localStorage.setItem throws (quota exceeded / private browsing)", () => {
    it("createScript does not crash when the write fails", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      });
      expect(() => createScript("Won't fit", "body")).not.toThrow();
      spy.mockRestore();
    });

    it("returns the in-memory script from createScript even though persistence silently failed", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      const script = createScript("Won't fit", "body");
      // The function still hands back a well-formed script object for the current
      // render, per the "degrade, don't crash" contract in write(); it just won't
      // survive a reload because the underlying setItem never succeeded.
      expect(script.title).toBe("Won't fit");
      spy.mockRestore();
      expect(getScripts()).toHaveLength(0);
    });

    it("updateScript does not crash and does not corrupt in-memory state when write fails", () => {
      const s = createScript("Toast", "v1");
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      expect(() => updateScript(s.id, { body: "v2" })).not.toThrow();
      spy.mockRestore();
      // Write failed, so the persisted copy should still be the original body.
      expect(getScript(s.id)?.body).toBe("v1");
    });

    it("addSession does not crash when write fails", () => {
      const s = createScript("Toast", "body");
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      expect(() =>
        addSession({ scriptId: s.id, date: new Date().toISOString(), durationSec: 30, wordCount: 80, fillerCount: 2, wpm: 140, fillerRate: 2.5, confidence: 90 }),
      ).not.toThrow();
      spy.mockRestore();
    });

    it("saveSettings does not crash when write fails", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      expect(() => saveSettings({ onboardingComplete: true })).not.toThrow();
      spy.mockRestore();
    });
  });

  // ---------- Concurrent-tab-like scenarios ----------

  describe("concurrent-tab-like sequences", () => {
    it("a second call sequence that reads stale state can clobber the first tab's write (last write wins)", () => {
      // Simulate tab A and tab B both loading the script list before either writes.
      const s = createScript("Original", "body");
      const tabASnapshot = getScripts();
      const tabBSnapshot = getScripts();
      expect(tabASnapshot).toHaveLength(1);
      expect(tabBSnapshot).toHaveLength(1);

      // Tab A updates the title.
      updateScript(s.id, { title: "Renamed by A" });

      // Tab B, unaware of A's change, updates the body based on its stale snapshot.
      // Because updateScript() re-reads getScripts() internally rather than trusting
      // a stale snapshot, B's write still merges onto A's latest state (not a full
      // overwrite of the whole list), so A's title survives.
      updateScript(s.id, { body: "Changed by B" });

      const finalState = getScript(s.id);
      expect(finalState?.title).toBe("Renamed by A");
      expect(finalState?.body).toBe("Changed by B");
    });

    it("two tabs creating scripts back-to-back both persist (no lost writes for distinct records)", () => {
      createScript("From tab A", "a");
      createScript("From tab B", "b");
      const titles = getScripts().map((s) => s.title).sort();
      expect(titles).toEqual(["From tab A", "From tab B"]);
    });

    it("a tab that saves settings after another tab's settings change does not wipe unrelated fields", () => {
      saveSettings({ visualMode: "word" });
      // Second "tab" only intends to flip onboarding, unaware of the visualMode change.
      saveSettings({ onboardingComplete: true });
      const settings = getSettings();
      expect(settings.visualMode).toBe("word");
      expect(settings.onboardingComplete).toBe(true);
    });
  });

  // ---------- Malformed / corrupted localStorage contents ----------

  describe("corrupted or malformed localStorage contents", () => {
    it("recovers to an empty script list when scripts key holds invalid JSON", () => {
      localStorage.setItem("flowcue.scripts.v1", "{not valid json!!!");
      expect(() => getScripts()).not.toThrow();
      expect(getScripts()).toEqual([]);
    });

    it("recovers when scripts key holds valid JSON of the wrong shape (object instead of array)", () => {
      // e.g. a future/older schema version that stored scripts keyed by id.
      localStorage.setItem("flowcue.scripts.v1", JSON.stringify({ notAnArray: true }));
      expect(() => getScripts()).not.toThrow();
      expect(getScripts()).toEqual([]);
    });

    it("recovers when scripts key holds a bare JSON string or number", () => {
      localStorage.setItem("flowcue.scripts.v1", JSON.stringify("just a string"));
      expect(() => getScripts()).not.toThrow();
      expect(getScripts()).toEqual([]);

      localStorage.setItem("flowcue.scripts.v1", JSON.stringify(42));
      expect(() => getScripts()).not.toThrow();
      expect(getScripts()).toEqual([]);
    });

    it("recovers when sessions key holds valid JSON of the wrong shape", () => {
      const s = createScript("Toast", "body");
      localStorage.setItem("flowcue.sessions.v1", JSON.stringify({ foo: "bar" }));
      expect(() => getSessionsForScript(s.id)).not.toThrow();
      expect(getSessionsForScript(s.id)).toEqual([]);
    });

    it("recovers to default settings when settings key holds invalid JSON", () => {
      localStorage.setItem("flowcue.settings.v1", "{{{broken");
      expect(() => getSettings()).not.toThrow();
      expect(getSettings().visualMode).toBe("sentence");
    });

    it("allows creating a new script after corrupted data is encountered (does not get stuck)", () => {
      localStorage.setItem("flowcue.scripts.v1", "not json");
      createScript("Fresh Start", "body");
      expect(getScripts()).toHaveLength(1);
      expect(getScripts()[0].title).toBe("Fresh Start");
    });

    it("does not crash when an individual script entry in an otherwise-valid array is missing expected fields", () => {
      localStorage.setItem(
        "flowcue.scripts.v1",
        JSON.stringify([{ id: "abc", updatedAt: "2026-01-01T00:00:00.000Z" }]),
      );
      // getScripts() sorts by updatedAt, which exists here, so this should not throw
      // even though title/body/createdAt are absent (as could happen after a schema change).
      expect(() => getScripts()).not.toThrow();
      expect(getScripts()).toHaveLength(1);
    });
  });

  // ---------- Very large scripts ----------

  describe("large scripts", () => {
    it("stores and retrieves a script with tens of thousands of words", () => {
      const bigBody = Array.from({ length: 50000 }, (_, i) => `word${i}`).join(" ");
      const s = createScript("Giant Script", bigBody);
      const fetched = getScript(s.id);
      expect(fetched?.body.length).toBe(bigBody.length);
      expect(fetched?.body.split(" ")).toHaveLength(50000);
    });

    it("can update a large script's body without truncation", () => {
      const bigBody = "word ".repeat(60000);
      const s = createScript("Giant", "small");
      const updated = updateScript(s.id, { body: bigBody });
      expect(updated?.body.length).toBe(bigBody.length);
    });
  });

  // ---------- Special characters, emoji, very long titles ----------

  describe("special characters, emoji, and long titles", () => {
    it("round-trips emoji and multi-byte unicode in title and body", () => {
      const s = createScript("Toast 🎉🥂 for the happy couple 💍", "Cheers! 你好世界 🚀 café naïve");
      const fetched = getScript(s.id);
      expect(fetched?.title).toBe("Toast 🎉🥂 for the happy couple 💍");
      expect(fetched?.body).toBe("Cheers! 你好世界 🚀 café naïve");
    });

    it("round-trips quotes, backslashes, and newlines that could break naive JSON handling", () => {
      const tricky = 'He said "hello" \\ and then\nnewline\tand tab';
      const s = createScript("Quote \"Test\"", tricky);
      const fetched = getScript(s.id);
      expect(fetched?.body).toBe(tricky);
      expect(fetched?.title).toBe('Quote "Test"');
    });

    it("handles a very long title (thousands of characters)", () => {
      const longTitle = "A".repeat(5000);
      const s = createScript(longTitle, "body");
      expect(getScript(s.id)?.title).toBe(longTitle);
      expect(getScript(s.id)?.title.length).toBe(5000);
    });

    it("handles an empty-string title and body", () => {
      const s = createScript("", "");
      expect(getScript(s.id)?.title).toBe("");
      expect(getScript(s.id)?.body).toBe("");
    });
  });

  // ---------- Script ID collisions ----------

  describe("script id collisions", () => {
    it("updateScript only affects the first matching id if two scripts somehow share an id", () => {
      const s = createScript("First", "body1");
      // Simulate a duplicate id sneaking in (e.g. from a buggy import), bypassing uid().
      const all = getScripts();
      all.push({ ...all[0], title: "Duplicate", body: "body2" });
      localStorage.setItem("flowcue.scripts.v1", JSON.stringify(all));

      updateScript(s.id, { body: "updated" });
      const matches = getScripts().filter((sc) => sc.id === s.id);
      expect(matches).toHaveLength(2);
      // findIndex takes the first match; only that one should reflect the update.
      const updatedCount = matches.filter((sc) => sc.body === "updated").length;
      expect(updatedCount).toBe(1);
    });

    it("deleteScript removes ALL entries sharing a duplicated id (filter, not findIndex)", () => {
      const s = createScript("First", "body1");
      const all = getScripts();
      all.push({ ...all[0], title: "Duplicate" });
      localStorage.setItem("flowcue.scripts.v1", JSON.stringify(all));
      expect(getScripts()).toHaveLength(2);

      deleteScript(s.id);
      expect(getScripts()).toHaveLength(0);
    });
  });

  // ---------- Cascading delete with session history ----------

  describe("deleting a script with session history", () => {
    it("removes all sessions belonging to the deleted script, leaving other scripts' sessions intact", () => {
      const a = createScript("Script A", "body a");
      const b = createScript("Script B", "body b");
      addSession({ scriptId: a.id, date: "2026-01-01T00:00:00.000Z", durationSec: 10, wordCount: 5, fillerCount: 0, wpm: 100, fillerRate: 0, confidence: 95 });
      addSession({ scriptId: a.id, date: "2026-01-02T00:00:00.000Z", durationSec: 20, wordCount: 10, fillerCount: 1, wpm: 110, fillerRate: 1, confidence: 90 });
      addSession({ scriptId: b.id, date: "2026-01-01T00:00:00.000Z", durationSec: 15, wordCount: 8, fillerCount: 0, wpm: 90, fillerRate: 0, confidence: 92 });

      deleteScript(a.id);

      expect(getSessionsForScript(a.id)).toHaveLength(0);
      expect(getSessionsForScript(b.id)).toHaveLength(1);
      expect(getScripts()).toHaveLength(1);
      expect(getScripts()[0].id).toBe(b.id);
    });

    it("deleting a script with no sessions is a no-op for the sessions store", () => {
      const a = createScript("Lonely Script", "body");
      const b = createScript("Has Sessions", "body");
      addSession({ scriptId: b.id, date: "2026-01-01T00:00:00.000Z", durationSec: 10, wordCount: 5, fillerCount: 0, wpm: 100, fillerRate: 0, confidence: 95 });

      deleteScript(a.id);

      expect(getSessionsForScript(b.id)).toHaveLength(1);
    });

    it("deleting a script id that does not exist does not throw and leaves data untouched", () => {
      const a = createScript("Real Script", "body");
      addSession({ scriptId: a.id, date: "2026-01-01T00:00:00.000Z", durationSec: 10, wordCount: 5, fillerCount: 0, wpm: 100, fillerRate: 0, confidence: 95 });

      expect(() => deleteScript("nonexistent-id")).not.toThrow();
      expect(getScripts()).toHaveLength(1);
      expect(getSessionsForScript(a.id)).toHaveLength(1);
    });
  });

  // ---------- Missing / nonexistent script operations ----------

  describe("operations on nonexistent scripts", () => {
    it("updateScript returns undefined for an unknown id and does not create a new entry", () => {
      expect(updateScript("nonexistent", { title: "x" })).toBeUndefined();
      expect(getScripts()).toHaveLength(0);
    });

    it("setScriptOfflineCache returns undefined for an unknown id", () => {
      expect(setScriptOfflineCache("nonexistent", true)).toBeUndefined();
    });

    it("getScript returns undefined for an unknown id", () => {
      expect(getScript("nonexistent")).toBeUndefined();
    });
  });

  // ---------- Settings: empty-string vs missing fields ----------

  describe("settings edge cases", () => {
    it("treats an explicit empty-string patch value as a real value, not as 'unset'", () => {
      // visualMode is typed as a union, but saveSettings takes Partial<Settings> and
      // merges shallowly -- verify a patch actually lands rather than being skipped.
      saveSettings({ visualMode: "focus" });
      expect(getSettings().visualMode).toBe("focus");
    });

    it("merges a partial patch onto existing settings without dropping untouched fields", () => {
      saveSettings({ offlineModeEnabled: true });
      saveSettings({ visualMode: "confidence" });
      const settings = getSettings();
      expect(settings.offlineModeEnabled).toBe(true);
      expect(settings.visualMode).toBe("confidence");
    });

    it("fills in DEFAULT_SETTINGS values for fields missing from a partial/legacy settings object in localStorage", () => {
      // Simulate a settings blob saved by an older app version missing fields
      // that were added later (offlineModeEnabled, syllabifyLongWords).
      localStorage.setItem("flowcue.settings.v1", JSON.stringify({ visualMode: "word", onboardingComplete: true }));
      const settings = getSettings();
      expect(settings.visualMode).toBe("word");
      expect(settings.onboardingComplete).toBe(true);
      // getSettings() merges onto DEFAULT_SETTINGS, so a field missing from
      // what was actually saved falls back to its shipped default (false)
      // rather than coming back undefined -- found while adding
      // syllabifyLongWords: without this, every existing user's saved
      // settings would read that new field as undefined instead of off.
      expect(settings.offlineModeEnabled).toBe(false);
      expect(settings.syllabifyLongWords).toBe(false);
    });

    it("an empty object in localStorage for settings falls back to DEFAULT_SETTINGS entirely", () => {
      localStorage.setItem("flowcue.settings.v1", JSON.stringify({}));
      expect(() => getSettings()).not.toThrow();
      expect(getSettings().visualMode).toBe("sentence");
      expect(getSettings().offlineModeEnabled).toBe(false);
      expect(getSettings().syllabifyLongWords).toBe(false);
    });
  });
});
