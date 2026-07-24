# FlowCue AI — Web App (v0.2, production-grade MVP)

A React + TypeScript rebuild of the FlowCue AI teleprompter, per the Technical
Architecture doc's frontend stack recommendation. This replaces the earlier
single-file vanilla-JS MVP (still available in `../app/` for reference) with a
real multi-script product: a script library, a rehearsal workspace, richer AI
coach analytics with session history, settings, first-run onboarding, and a
minimal offline-capable app shell.

## What's real vs. simulated

- **Real:** the speech-following sync engine (`src/engine/syncEngine.ts`), the
  pronunciation assistant (`src/engine/pronounce.ts`), all UI and state
  management, and a service worker that caches the app shell for offline use.
- **Simulated (no backend yet):** scripts, session history, and settings are
  stored in the browser's `localStorage` rather than a real account/API — see
  `src/lib/storage.ts`, which is written behind the same interface a real API
  client would expose, so swapping in the Script/Auth services from the
  Technical Architecture doc later is a backend swap, not a rewrite.
- Live speech recognition uses the browser's built-in Web Speech API (Chrome/
  Edge), same caveat as the original MVP: production should use the hybrid
  on-device + Deepgram/AssemblyAI pipeline described in the architecture doc.

## Running it

```bash
npm install
npm run dev       # starts a local dev server, prints a URL to open
```

Then open the printed URL (typically http://localhost:5173) in Chrome or Edge.

## Testing

```bash
npm run test       # vitest: engine unit tests, storage tests, and a React
                    # Testing Library smoke test of the core user flows
npm run build       # typecheck + production build
```

23 tests currently pass: 7 sync-engine scenarios (linear reading, skip-ahead,
repeated line, backtrack, misrecognition, off-script freeze, reset), 4
pronunciation-assistant tests, 6 storage/persistence tests, and 6 end-to-end
UI smoke tests (onboarding, script creation, rehearsal stage rendering,
pronunciation popover, settings, deletion).

## Project layout

```
src/
  engine/       sync engine + pronunciation assistant (pure logic, unit tested)
  lib/          types + localStorage-backed persistence layer
  hooks/        useSpeechRecognition (Web Speech API wrapper)
  components/   Sidebar, Library, ScriptWorkspace, RehearsalStage,
                PronunciationPopover, CoachReport, SessionHistoryChart,
                SettingsView, Onboarding
  App.tsx       top-level view routing (Library / Script Workspace / Settings)
public/
  sw.js         minimal offline app-shell service worker
```
