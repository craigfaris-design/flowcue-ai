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

export type VisualMode = "sentence" | "focus" | "confidence";

export const VISUAL_MODE_LABELS: Array<{ mode: VisualMode; label: string }> = [
  { mode: "sentence", label: "Sentence glow" },
  { mode: "focus", label: "Focus zone" },
  { mode: "confidence", label: "Confidence colors" },
];

// BCP-47 tags used by the Web Speech API's `recognition.lang`
// (useSpeechRecognition.ts) as-is, and by the relay's `language` query
// param (server/src/sttRelay.ts) which maps each one down to the bare
// language code AssemblyAI's streaming API expects. Deliberately limited to
// languages whose writing system uses spaces between words -- the sync
// engine's tokenizer (syncEngine.ts's tokenizeScript) splits words on
// whitespace, which silently collapses an entire unspaced sentence (e.g.
// Chinese, Japanese) into a single "word" token, breaking word-level
// tracking rather than just degrading it. Adding a CJK language here needs a
// real per-script tokenization strategy first, not just a new list entry.
export const SPEECH_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en-US", label: "English (US)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it-IT", label: "Italian" },
  { code: "nl-NL", label: "Dutch" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ko-KR", label: "Korean" },
  { code: "ru-RU", label: "Russian" },
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
  /** BCP-47 tag (one of SPEECH_LANGUAGES) sent to both speech recognition
   * providers. Only affects what language the recognizer listens for --
   * the UI itself and the script text are unaffected. */
  speechLanguage: string;
}

export const DEFAULT_SETTINGS: Settings = {
  visualMode: "sentence",
  onboardingComplete: false,
  offlineModeEnabled: false,
  syllabifyLongWords: false,
  speechLanguage: "en-US",
};
