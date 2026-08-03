/**
 * Local persistence layer. There is no backend yet (see Technical Architecture
 * doc -- the Script Service / Postgres layer is a later milestone), so this
 * wraps localStorage behind the same interface a real API client would expose,
 * making it a low-cost swap later rather than a rewrite.
 */
import type { Script, SessionRecord, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const KEYS = {
  scripts: "flowcue.scripts.v1",
  sessions: "flowcue.sessions.v1",
  settings: "flowcue.settings.v1",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    // Guard against shape mismatches, not just invalid JSON: data left behind
    // by an older schema (or hand-edited in devtools) can still be valid JSON
    // of the wrong type -- e.g. an object where an array is expected. Without
    // this check, an array-backed fallback (Script[]/SessionRecord[]) would
    // parse fine but crash the first time callers call .sort()/.filter() on it.
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (e.g. private browsing) -- fail silently,
    // the app still functions for the current session.
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- Scripts ----------

export function getScripts(): Script[] {
  return read<Script[]>(KEYS.scripts, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getScript(id: string): Script | undefined {
  return getScripts().find((s) => s.id === id);
}

export function createScript(title: string, body: string): Script {
  const now = new Date().toISOString();
  const script: Script = { id: uid(), title, body, createdAt: now, updatedAt: now, cachedOffline: false };
  const all = getScripts();
  all.push(script);
  write(KEYS.scripts, all);
  return script;
}

export function updateScript(id: string, patch: Partial<Pick<Script, "title" | "body">>): Script | undefined {
  const all = getScripts();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  write(KEYS.scripts, all);
  return all[idx];
}

export function deleteScript(id: string): void {
  const all = getScripts().filter((s) => s.id !== id);
  write(KEYS.scripts, all);
  const sessions = getAllSessions().filter((s) => s.scriptId !== id);
  write(KEYS.sessions, sessions);
}

export function setScriptOfflineCache(id: string, cached: boolean): Script | undefined {
  const all = getScripts();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], cachedOffline: cached, cachedAt: cached ? new Date().toISOString() : undefined };
  write(KEYS.scripts, all);
  return all[idx];
}

// ---------- Sessions ----------

function getAllSessions(): SessionRecord[] {
  return read<SessionRecord[]>(KEYS.sessions, []);
}

export function getSessionsForScript(scriptId: string): SessionRecord[] {
  return getAllSessions()
    .filter((s) => s.scriptId === scriptId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Most recent sessions across *all* scripts, newest first -- used by
 * adaptiveTuning.ts to build a general profile of how well live cueing
 * tracks this device's user, not just their history with one script.
 */
export function getRecentSessions(limit: number): SessionRecord[] {
  return getAllSessions()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function addSession(record: Omit<SessionRecord, "id">): SessionRecord {
  const withId: SessionRecord = { ...record, id: uid() };
  const all = getAllSessions();
  all.push(withId);
  write(KEYS.sessions, all);
  return withId;
}

// ---------- Settings ----------

export function getSettings(): Settings {
  // Merged with DEFAULT_SETTINGS, not returned as-is -- read() gives back
  // whatever shape was actually saved, so a settings object saved before a
  // newer field existed (e.g. syllabifyLongWords) would otherwise come back
  // with that field simply missing/undefined rather than its default.
  return { ...DEFAULT_SETTINGS, ...read<Settings>(KEYS.settings, DEFAULT_SETTINGS) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}
