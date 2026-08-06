> **DRAFT — NEEDS LEGAL REVIEW BEFORE PUBLISHING.** This document was written
> by auditing what the FlowCue AI code actually does (see the fact-finding
> notes at the bottom of this file) as of 2026-07-28, not copied from a
> template. It is not a substitute for review by a lawyer, particularly for
> GDPR/CCPA-style jurisdictional obligations, before this is linked from a
> live app or a Play Store listing. If the app's behavior changes (e.g. real
> user accounts are added, the server-side Script Service is wired up, an
> analytics SDK is added), **this document must be updated to match** —
> it describes today's code, not a promise about the future.

# FlowCue AI — Privacy Policy

**Last updated:** [fill in on publish]

FlowCue AI ("we," "our," "the app") is a real-time speech-following
teleprompter. This policy explains what happens to your data when you use it.

## The short version

- Your scripts and rehearsal history are stored **only in your browser**
  (localStorage), not on our servers.
- Your microphone audio is streamed live for transcription and is **not
  recorded or saved** by FlowCue AI, anywhere.
- We don't have user accounts, we don't use analytics or advertising, and
  we don't use cookies.

## Microphone audio

FlowCue AI needs microphone access to follow along as you speak. Depending on
which speech recognizer is active:

- **AssemblyAI (default, when configured):** your microphone audio is
  streamed from your browser to FlowCue AI's own relay server, which
  forwards it directly to AssemblyAI's real-time transcription API and
  streams the resulting text back to your browser. FlowCue AI's server does
  not write this audio to disk or a database at any point — it is forwarded
  in memory, chunk by chunk, and discarded. AssemblyAI processes the audio
  as our subprocessor to provide transcription; see
  [AssemblyAI's privacy policy](https://www.assemblyai.com/legal/privacy-policy)
  for how they handle audio sent to their API.
- **Browser fallback (used if AssemblyAI is unavailable):** your browser's
  built-in speech recognition is used instead, which sends audio directly to
  your browser vendor's own speech-recognition service (for example,
  Google's, in Chrome) — entirely outside FlowCue AI's servers or control.
  That happens under your browser vendor's own privacy policy, not this one.

In neither case does FlowCue AI itself store, record, or retain your audio.

## What we store, and where

FlowCue AI currently stores data **only in your browser's local storage** —
not in a database we operate. This includes:

- **Scripts** you paste in (title and body text).
- **Rehearsal session stats** — duration, word count, words-per-minute,
  filler-word count, a tracking-confidence score, and how many times live
  cueing lost your place. We do **not** store a transcript of what you said
  or any audio, only these aggregate numbers.
- **Settings** — your preferred visual reading mode and a couple of
  on/off preferences.

This data stays on your device, tied to your browser. It is not transmitted
to us, synced to any account, or shared with anyone. If you clear your
browser's site data for FlowCue AI, or use the in-app **"Clear all local
data"** button in Settings, it's gone.

We do not currently offer account-based sync across devices. (FlowCue AI has
early backend infrastructure for this planned for a future version — if and
when that ships, this policy will be updated before it's turned on, and it
will describe what changes.)

## Third-party services

- **AssemblyAI** — receives streamed audio for transcription, as described
  above, when AssemblyAI-based recognition is active.
- **Google Fonts** — this app loads its typeface from Google's font CDN.
  Loading a font this way exposes your IP address and browser details to
  Google, the same as visiting any page that embeds a Google-hosted
  resource, under [Google's privacy policy](https://policies.google.com/privacy).

We do not use analytics, advertising, tracking pixels, or cookies of any
kind. We have no crash-reporting or telemetry SDK integrated.

## Children's privacy

FlowCue AI does not knowingly collect data from children under 13 (or the
relevant minimum age in your jurisdiction). The app has no age verification
today, consistent with the fact that it does not collect any account or
personal-profile data in the first place — see above.

## Your choices

- **Deny microphone access** and the app simply can't offer live cueing —
  everything else (writing/editing scripts) still works.
- **Clear all local data** at any time from Settings, or clear your
  browser's site data directly.
- **Uninstall/stop using the app** at any time; nothing persists once your
  local browser storage for it is cleared, since we don't hold a copy
  elsewhere.

## Changes to this policy

If how FlowCue AI handles data changes — for example, if we launch real user
accounts, cross-device sync, or add any analytics — we'll update this policy
before that change ships, not after.

## Contact

[Fill in a real contact — support email or similar — before publishing.]

---

<details>
<summary>Fact-finding basis for this draft (for Craig/legal reviewer, not end users)</summary>

Verified directly against the code on 2026-07-28, re-verified 2026-08-06
after switching STT providers from Deepgram to AssemblyAI (cost -- see
`server/README.md`):

- Audio is forwarded byte-for-byte over WebSocket to AssemblyAI by
  `server/src/sttRelay.ts`; no `fs`/file-write/DB-write calls exist in that
  file or elsewhere in `server/src` for audio or transcript content. Only
  `console.error(err)` exists server-side, for exceptions, not content.
- `webapp/src/lib/storage.ts` persists exclusively to three `localStorage`
  keys (`flowcue.scripts.v1`, `flowcue.sessions.v1`, `flowcue.settings.v1`)
  and makes no network calls. There are zero `fetch`/`axios` calls anywhere
  in `webapp/src`.
- The Postgres-backed "Script Service" in `server/src/routes/*` is real,
  tested code but is **not called by the shipped webapp at all** — it's
  scoped to a single hardcoded placeholder user ID
  (`server/src/devUser.ts`) and exists for a future account system, not
  today's data flow. This policy describes today's flow (localStorage only).
- No analytics/tracking/cookie/ads code found anywhere in the repo (grepped
  for common SDK names — Sentry, Mixpanel, GA, Amplitude, Segment, PostHog,
  Hotjar, etc. — zero matches).
- The `craig.faris@gmail.com` shown in the sidebar is hardcoded placeholder
  UI text, not a real account/login system — there is no signup/login flow.
- Only permission requested: microphone (`getUserMedia({ audio: true })`).
  No location, camera, notifications, Bluetooth, or clipboard access.
- "Clear all local data" calls `localStorage.clear()` client-side only; it
  never touches the server.

If any of this changes (real auth, server-side storage actually wired up,
any SDK added), the policy above needs a matching update — it is not
future-proofed against those changes on its own.
</details>
