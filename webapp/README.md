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
- **Real:** on-device adaptive tuning (`src/engine/adaptiveTuning.ts`) --
  the sync engine's tolerance (how long it waits before showing "Holding
  position," how strict its confidence bar is) gets personalized once a
  device has enough of its own rehearsal history, based on how often live
  cueing actually lost tracking in past sessions. Entirely local: it only
  reads this browser's own session history via `storage.getRecentSessions`,
  never sends anything anywhere. Deliberately NOT a crowd-sourced/global
  model that learns across all users -- that would mean collecting speech
  data on a server, which is a privacy/consent decision (and would
  contradict the "FlowCue AI itself does not store audio" disclosure
  already shown in the app), not something to build unilaterally.

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
npm run test       # vitest: engine unit + fuzz tests, storage tests, and a
                    # React Testing Library smoke test of the core user flows
npm run build       # typecheck + production build
```

The fuzz suite (`syncEngine.fuzz.test.ts`) runs 100-150 randomized noisy
read-throughs per reference script (fewer for the longer ones, plus a
heavier-noise degradation check across all of them), so `npm run test`
takes noticeably longer than the unit tests alone (~2 minutes extra) --
that's expected, not a hang.

186 tests currently pass:

- **20 core sync-engine tests** (`syncEngine.test.ts`) -- linear/anticipatory-highlight
  scenarios, backtrack/repeat handling, the contraction-expansion and
  distinctive-token (jargon-tolerance) logic found via live testing, and
  the non-Latin-script/accented-Latin normalization fix found via
  accessibility review (a foreign-language word used to normalize to an
  empty string and vanish from the token stream entirely).
- **8 adaptive-tuning tests** (`adaptiveTuning.test.ts`) -- personalization
  stays at the shipped defaults with too little history or a well-tracked
  user, scales proportionally to a genuinely high freeze rate, and never
  relaxes tolerance beyond the validated-safe bounds however bad the
  history is.
- **18 adversarial stress tests** (`syncEngine.stress.test.ts`) -- real-world
  speech patterns found through live phone/desktop testing: stutters,
  double-fired words, a genuine Deepgram word-duplication hallucination, a
  fabricated extra word, a two-stray-word self-correction, large jumps,
  punctuation/contractions, a full linear read-through, repeated-refrain
  bias, ad-libs that must not cause silent drift, ordinary pauses that must
  not falsely freeze, and two regressions the fuzz suite below found: a
  trailing stray word wrongly yanking the cursor back to an earlier
  occurrence of a repeated refrain once the cursor is near the script's
  end, and a stray word inserted within the last match window stalling the
  cursor one word short of the true end.
- **13 fuzz tests** (`syncEngine.fuzz.test.ts`) -- generates hundreds of
  randomized combinations of real-world artifact types (drops, duplicates,
  stray insertions, misrecognition-like substitutions, contraction-merging,
  and adjacent word-order swaps/stutters) against eleven reference
  scripts -- a plain one, two jargon-heavy ones (tech and legal/medical
  terminology), a ~300-word long-form one, a screenplay with speaker-name
  prefixes and stage directions, one full of spoken numbers/dates/times/
  addresses, a multicultural-names wedding toast, a repeated-refrain
  poem/lyric, a script under 20 words (smaller than the match window), and
  one full of abbreviations/acronyms and unusual punctuation -- asserting
  the engine still reaches the end at a high success rate; a heavier-noise
  pass across all of them checking for catastrophic (not just partial)
  degradation; and a check that pure unrelated noise never produces a false
  match. Deterministic (seeded) so failures are always reproducible and CI
  never flakes; a failing run prints the exact corrupted word sequence and
  seed for turning into a dedicated regression test -- as the two new
  stress-test regressions above were.
- **31 pronunciation-assistant tests** (`pronounce.test.ts`) -- syllable/respelling
  edge cases (numbers-in-words, acronyms, non-English/emoji input, very
  long words) added under a dedicated review pass, including a fix for an
  inconsistent popover (blank headword/respelling but a non-empty syllable
  row) on input with no ASCII letters at all.
- **40 storage/persistence tests** (`storage.test.ts`) -- localStorage edge
  cases (quota errors, corrupted/malformed JSON, huge scripts, concurrent-tab-like
  sequences, cascading deletes) added under a dedicated review pass, including
  a fix for a hard crash on valid-JSON-but-wrong-shape data left behind by
  an older version, plus `getRecentSessions` (cross-script history, newest
  first) added for adaptive tuning.
- **7 Web-Speech-API tests** (mic-error handling plus interim/final word
  streaming without duplication).
- **14 Deepgram-hook tests** -- the same interim/final streaming correctness,
  the audio-buffering fix so nothing spoken during the connection handshake
  is lost, low-confidence word filtering, relay-error surfacing, mic-denial,
  and (found via code review) the unmount-cleanup, "zombie restart," and
  overlapping-start() leak fixes.
- **3 useLiveRecognition tests** -- the fallback-to-browser-recognizer path
  now correctly engages on an unexpected connection drop (not just an
  initial unreachable/unconfigured relay), and `start()` is a no-op while
  already listening.
- **8 ScriptWorkspace UI tests** (offline mode, Deepgram/fallback disclosure
  text, the "last heard" readout, the adaptive-tuning personalization
  disclosure appearing only with enough real local history, and a
  session's freeze count being recorded and shown in the coach report).
- **11 RehearsalStage tests** -- the two new visual reading modes (Focus
  zone's distance-based dimming, Confidence colors' green/amber/red
  states with a non-color icon backup for colorblind accessibility), Mirror
  flip for physical teleprompter hardware, keyboard access to the
  pronunciation popover, and skipping punctuation-only sentence chunks.
- **5 PronunciationPopover tests** -- ARIA dialog role, Escape-to-close,
  and focus management (moves in on open, restores to the triggering word
  on close), added under an accessibility review pass.
- **8 end-to-end UI smoke tests** (onboarding incl. Escape-to-dismiss,
  keyboard script-card navigation, script creation, rehearsal stage
  rendering, pronunciation popover, settings, deletion).

## Project layout

```
src/
  engine/       sync engine + pronunciation assistant + on-device adaptive
                tuning (pure logic, unit tested)
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
