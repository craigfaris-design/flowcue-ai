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
}

export type VisualMode = "sentence" | "word";

export interface Settings {
  visualMode: VisualMode;
  onboardingComplete: boolean;
  offlineModeEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  visualMode: "sentence",
  onboardingComplete: false,
  offlineModeEnabled: false,
};
