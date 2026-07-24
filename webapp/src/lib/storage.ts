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
    return JSON.parse(raw) as T;
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

export function addSession(record: Omit<SessionRecord, "id">): SessionRecord {
  const withId: SessionRecord = { ...record, id: uid() };
  const all = getAllSessions();
  all.push(withId);
  write(KEYS.sessions, all);
  return withId;
}

// ---------- Settings ----------

export function getSettings(): Settings {
  return read<Settings>(KEYS.settings, DEFAULT_SETTINGS);
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}
