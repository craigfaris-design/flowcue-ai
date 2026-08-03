export interface Script {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  cachedOffline: boolean;
  cachedAt?: string;
}

export interface SessionRecord {
  id: string;
  scriptId: string;
  date: string;
  durationSec: number;
  wordCount: number;
  fillerCount: number;
  wpm: number;
  fillerRate: number;
  confidence: number;
  /**
   * How many times live cueing lost confident tracking during this session
   * (the "Holding position" indicator turning on). Powers adaptiveTuning.ts,
   * which personalizes the sync engine's tolerance for future sessions
   * based on this device's own rehearsal history -- optional so older
   * session records saved before this field existed still read back fine.
   */
  freezeCount?: number;
}

export type VisualMode = "sentence" | "word" | "focus" | "confidence";

export const VISUAL_MODE_LABELS: Array<{ mode: VisualMode; label: string }> = [
  { mode: "sentence", label: "Sentence glow" },
  { mode: "word", label: "Word karaoke" },
  { mode: "focus", label: "Focus zone" },
  { mode: "confidence", label: "Confidence colors" },
];

export interface Settings {
  visualMode: VisualMode;
  onboardingComplete: boolean;
  offlineModeEnabled: boolean;
  /** Inserts a middle-dot between syllables of long/complicated words in
   * the rehearsal reading text (e.g. "com·mu·ni·ca·tion"), purely a display
   * aid -- doesn't touch the underlying script text or the sync engine's
   * word matching, which still operate on the plain word either way. */
  syllabifyLongWords: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  visualMode: "sentence",
  onboardingComplete: false,
  offlineModeEnabled: false,
  syllabifyLongWords: false,
};
