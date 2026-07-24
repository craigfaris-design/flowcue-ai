// Row shapes as returned by `pg` (snake_case columns) mapped to the exact
// same camelCase contract webapp/src/lib/types.ts already defines -- the
// frontend's storage.ts client can target this API without the app-level
// data model changing.

interface ScriptRow {
  id: string;
  title: string;
  body: string;
  cached_offline: boolean;
  cached_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface SessionRecordRow {
  id: string;
  script_id: string;
  date: string | Date;
  duration_sec: number | string;
  word_count: number;
  filler_count: number;
  wpm: number;
  filler_rate: number | string;
  confidence: number | string;
}

interface SettingsRow {
  visual_mode: string;
  onboarding_complete: boolean;
  offline_mode_enabled: boolean;
}

export function toScript(row: ScriptRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    cachedOffline: row.cached_offline,
    cachedAt: row.cached_at ? new Date(row.cached_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function toSessionRecord(row: SessionRecordRow) {
  return {
    id: row.id,
    scriptId: row.script_id,
    date: new Date(row.date).toISOString(),
    durationSec: Number(row.duration_sec),
    wordCount: row.word_count,
    fillerCount: row.filler_count,
    wpm: row.wpm,
    fillerRate: Number(row.filler_rate),
    confidence: Number(row.confidence),
  };
}

export function toSettings(row: SettingsRow) {
  return {
    visualMode: row.visual_mode as "sentence" | "word",
    onboardingComplete: row.onboarding_complete,
    offlineModeEnabled: row.offline_mode_enabled,
  };
}
