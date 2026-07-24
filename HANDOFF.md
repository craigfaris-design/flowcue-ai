# FlowCue AI — Handoff to Claude Code

Read this first. It's the fastest way to get productive without re-deriving decisions already made.

## What this is

FlowCue AI is a public-speaking teleprompter whose core differentiator is a real-time
speech-following engine — it tracks a speaker's actual position in a script live (via STT),
and recovers gracefully from pauses, skips, repeats, and ad-libs, instead of scrolling at a
fixed speed like traditional teleprompters. Pronunciation assistance and an AI rehearsal coach
are secondary features (explicitly — never let them overshadow the live cueing engine).

Full context lives in `docs/`:
- `FlowCue_AI_PRD.docx` — product requirements, target users, feature priority order
- `FlowCue_AI_Technical_Architecture.docx` — system design, STT provider choice, sync algorithm
- `FlowCue_AI_Decision_Log.docx` — **read this before making any product/business call.** Every
  decision already made (with rationale) and every decision still open, in one place. Update
  it, don't relitigate it.
- `FlowCue_AI_Risk_Register.docx`, `FlowCue_AI_Business_Plan.docx`, `FlowCue_AI_Financial_Model.xlsx`

## What's already built

`webapp/` is a working React + TypeScript + Vite app (source only in this package — run
`npm install` to regenerate `node_modules`, don't expect it to be here). It has:

- `src/engine/syncEngine.ts` — the windowed local-alignment sync algorithm. This is the product's
  core IP. It tracks position with a confidence score and **freezes rather than guesses** when
  confidence drops, per the PRD's "never lose position silently" requirement. Don't casually
  refactor this without re-running its test suite — the behavior around ad-libs and backtracking
  is intentionally specific and was tuned against 7+ scripted test scenarios.
- `src/engine/pronounce.ts` — pronunciation lookups.
- `src/components/` — RehearsalStage (live cueing UI), ScriptWorkspace, CoachReport, etc.
- `src/lib/storage.ts` — persistence layer using `localStorage`, written **behind an interface**
  so swapping in a real backend later is a substitution, not a rewrite. When you build the real
  backend, implement the same interface rather than scattering `localStorage` calls elsewhere.
- `src/hooks/useSpeechRecognition.ts` — currently wraps the browser's Web Speech API. This is a
  **known stopgap for beta only** — Technical Architecture calls for a hybrid on-device + cloud
  STT setup (Deepgram Nova-3 / AssemblyAI) for production, because Web Speech API has no offline
  mode, no SLA, and sends audio to Google. Don't treat the current implementation as final.
- Tests: `vitest` + React Testing Library, 23/23 passing as of last run (`App.smoke.test.tsx`,
  `engine/syncEngine.test.ts`, `lib/storage.test.ts`, `engine/pronounce.test.ts`).

Run it: `npm install && npm run dev`. Test: `npm test`. Build: `npm run build`.
See `webapp/DEPLOYMENT.md` for static hosting notes (Netlify/Vercel/GitHub Pages) — none of that
has been deployed publicly yet.

## Environment note

This was built in a sandboxed environment with a flaky mounted filesystem — some earlier commits
worth knowing about if you see odd artifacts: files occasionally got silently truncated on write
and had to be manually repaired. If anything in this bundle looks structurally broken (a `.ts`
file that doesn't parse, a component missing its closing braces), that's almost certainly a
leftover from that, not an intentional design choice — just fix it forward. A real local repo
with git shouldn't have this problem going forward, which is a big part of why this handoff
is happening.

## Open decisions — do not silently resolve these

Pulled from the Decision Log, still open as of this handoff:

1. **Naming conflict**: a live competing product exists at flowcue.app. No exact "FlowCue AI"
   trademark found, but no clearance either. Beta use only, low-visibility, pending a lawyer.
   Don't expand branding/marketing surface area until this resolves.
2. Founder bio/photo for investor materials — blocks external deck sharing.
3. Pricing table approval (drafted, in Business Plan).
4. Cloud provider confirmation (AWS recommended, not yet confirmed) — relevant once you start the
   real backend/STT integration.
5. Full legal review of audio-recording consent laws — an interim plain-language disclosure is
   live in the app UI as a stopgap, not a substitute for real review.
6. Hiring timeline — follows the funding decision, not urgent for code work.

## Suggested next engineering steps (not decisions, just sequencing)

1. Set up a real git repo, `npm install`, confirm the existing test suite still passes locally.
2. Stand up the real backend behind the `storage.ts` interface (a small API + database swap).
3. Replace the Web Speech API stopgap with the hybrid on-device/cloud STT architecture from the
   Technical Architecture doc.
4. iOS app (v1 platform per PRD) — not started.
5. Wire up real deployment (Netlify or similar) once the naming decision is resolved.

Everything above is a recommendation, not a mandate — re-derive priority from the PRD and
Decision Log if circumstances have changed since this handoff.
