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
  Technical Architecture doc later is a backend swap, not a rewrite. A working
  scaffold of that backend already exists at `../server/` (Express +
  PostgreSQL) but is deliberately not wired up yet — the beta is staying on
  `localStorage` on purpose (see the Decision Log) until that's revisited.
- **Real:** low-latency speech recognition via Deepgram (`src/hooks/useDeepgramRecognition.ts`),
  streamed through FlowCue AI's own backend relay (`../server/src/sttRelay.ts`)
  so the API key never reaches the browser -- see `../server/README.md` to
  enable it (needs a free Deepgram account). Falls back automatically to the
  browser's built-in Web Speech API (`src/hooks/useSpeechRecognition.ts`,
  Chrome/Edge only, no SLA) if Deepgram isn't reachable/configured --
  `src/hooks/useLiveRecognition.ts` is the seam that picks between them and
  is what components actually use. On-device recognition (the other half of
  the hybrid architecture the Technical Architecture doc describes) isn't
  built yet.

## Running it

```bash
npm install
npm run dev       # starts a local dev server, prints a URL to open
```

Then open the printed URL (typically http://localhost:5173) in Chrome or Edge.

For low-latency cueing (Deepgram instead of the browser's built-in
recognizer), also run the backend relay -- see `../server/README.md`
("Enabling low-latency speech recognition"). Not required: without it, live
cueing still works via the browser fallback, and the UI says so.

To test on a real phone over the same Wi-Fi network, live speech recognition
needs a secure context (see "What's real vs. simulated" -- `localhost` is
exempt from that requirement, but a LAN address like `192.168.x.x` is not):

```bash
HTTPS=true npm run dev    # serves over a self-signed cert on the LAN address too
```

Expect a "connection is not private" warning on the phone/desktop browser on
first load -- that's the self-signed cert, not a real problem; proceed past
it. iPhone Safari doesn't support the Web Speech API at all (see below), so
the browser-fallback path specifically won't work there regardless (Deepgram
still would, if the relay is running).

If also running the backend relay for Deepgram, it needs `HTTPS=true` too in
that case (see `../server/README.md`) -- a page served over HTTPS can't open
a plain `ws://` connection to it (mixed content).

## Testing

```bash
npm run test       # vitest: engine unit tests, storage tests, and a React
                    # Testing Library smoke test of the core user flows
npm run build       # typecheck + production build
```

57 tests currently pass: 8 sync-engine linear/anticipatory-highlight
scenarios, 13 adversarial ones added under real-world stress testing
(stutters, double-fired words, large jumps, punctuation/contractions, a full
linear read-through, repeated-refrain bias, ad-libs that must not cause
silent drift, ordinary pauses that must not falsely freeze, and one isolated
misrecognized word that must not stall tracking), 4 pronunciation-assistant
tests, 6 storage/persistence tests, 7 Web-Speech-API tests (mic-error
handling plus interim/final word streaming without duplication), 6
Deepgram-hook tests (the same interim/final streaming correctness, plus
relay-error surfacing and mic-denial), 5 ScriptWorkspace UI tests (offline
mode, Deepgram/fallback disclosure text, the "last heard" readout), and 8
end-to-end UI smoke tests (onboarding incl. Escape-to-dismiss, keyboard
script-card navigation, script creation, rehearsal stage rendering,
pronunciation popover, settings, deletion).

## Project layout

```
src/
  engine/       sync engine + pronunciation assistant (pure logic, unit tested)
  lib/          types + localStorage-backed persistence layer
  hooks/        useLiveRecognition (picks a provider, used by components) ->
                useDeepgramRecognition (relay-streamed, low-latency) with
                automatic fallback to useSpeechRecognition (Web Speech API)
  components/   Sidebar, Library, ScriptWorkspace, RehearsalStage,
                PronunciationPopover, CoachReport, SessionHistoryChart,
                SettingsView, Onboarding
  App.tsx       top-level view routing (Library / Script Workspace / Settings)
public/
  sw.js         minimal offline app-shell service worker
```
