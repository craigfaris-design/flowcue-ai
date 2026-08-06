# FlowCue AI — Play Store Launch Checklist

Last updated: 2026-08-06. This is the master list tying together everything
built for Play Store readiness across `webapp/`, `server/`, `android/`, and
`legal/`. Organized by who can actually move each item forward — most of
what's left is not code.

## ✅ Done (engineering)

- **PWA manifest + full icon set** — `webapp/public/manifest.json`,
  `webapp/public/icons/*`, wired into `index.html` and the service worker
  precache list.
- **Webapp deployed live** — `https://flowcue-ai.netlify.app`, real HTTPS,
  verified reachable by an anonymous visitor (not just an authenticated
  session — see `webapp/DEPLOYMENT.md`'s note on the SSO gotcha that was
  found and fixed).
- **Backend STT relay deployed live** — `https://flowcue-backend.onrender.com`
  (Render, free tier), running AssemblyAI (switched from Deepgram for cost —
  roughly a third of the per-minute rate). Verified end-to-end by connecting
  directly to the deployed relay and confirming a real AssemblyAI session
  opens, not just that the health check responds. Everything else (scripts,
  session history, settings) still works via `localStorage` client-side with
  no backend dependency — only live low-latency cueing needs the relay, and
  it degrades gracefully to the browser's built-in recognizer if the relay
  is ever unreachable.
- **Native app splash screen** — matches the brand (black background,
  pulsing logo via a JS-driven in-app loading screen; the native Android
  splash frame itself is a static black-background-with-logo image, since
  TWA's native splash can't animate without ejecting to custom native code).
- **Android signing keystore generated** — `flowcue-upload` alias, stored
  outside this repo at `C:\Users\Craig\flowcue-android-keystore\`, with
  `*.keystore`/`*.jks` also gitignored as a backup safeguard.
- **`assetlinks.json` deployed with the real SHA256 fingerprint** — verified
  live at `https://flowcue-ai.netlify.app/.well-known/assetlinks.json`.
- **`android/twa-manifest.json`** points at the real domain, not a
  placeholder.
- **`.aab` built and signed** — `android/app-release-bundle.aab`, verified
  with `jarsigner -verify` ("jar verified", signed by the real keystore).
  This is the exact file to upload in Play Console. See `android/README.md`
  for the Windows-specific build gotchas hit getting here (all fixed, all
  documented for next time).
- **Privacy Policy draft** — `legal/PRIVACY_POLICY.md`.
- **Terms of Service draft** — `legal/TERMS_OF_SERVICE.md`.
- **Play Store Data Safety disclosure draft** — `legal/PLAY_STORE_DATA_SAFETY.md`
  (names AssemblyAI as the transcription subprocessor, matches current code).
- All three legal/compliance docs kept in sync with the Deepgram->AssemblyAI
  switch — verified no stale references to the old provider remain anywhere
  a real user or Google reviewer would see them.

## 🔲 Blocked on Craig (money, accounts, decisions only he can make)

1. **Create a Google Play Console account** ($25 one-time fee) — required to
   create the listing and upload `android/app-release-bundle.aab` at all.
   This is the one remaining hard blocker to actually submitting.
2. **Store listing assets** — app description/marketing copy, screenshots
   (from a real device install — `android/app-release-signed.apk` can be
   sideloaded for this), and a final choice of which generated
   icon/feature-graphic set to use.
3. **A real support contact** (email or URL) — both legal drafts and the
   Play Console listing itself need one; currently a placeholder.
4. **Consider upgrading the Render free tier** ($7/month Starter) if the
   ~50-second cold-start delay after idle periods turns out to be annoying
   in real use — not required, purely a UX-vs-cost tradeoff for Craig to
   decide once there's real usage data.

## 🔲 Blocked on legal review

1. **`legal/PRIVACY_POLICY.md`** and **`legal/TERMS_OF_SERVICE.md`** are
   fact-checked against the actual code (see each file's appendix) but are
   not lawyer-reviewed. In particular: the liability/warranty/governing-law
   sections in the ToS are explicitly marked as placeholders needing real
   legal language, and GDPR/CCPA-style obligations (if targeting those
   users) haven't been assessed at all.
2. Once reviewed and finalized, these need to be **hosted at real URLs**
   (not just sitting in this repo) and linked from both the Play Store
   listing and, ideally, somewhere in the app itself (e.g. Settings) —
   deliberately not wired into the live app yet, since linking a
   not-yet-reviewed legal document from the product would effectively
   publish it as if final.
3. **`legal/PLAY_STORE_DATA_SAFETY.md`** must be submitted by Craig directly
   in Play Console (Google requires the account owner to do this) — the
   draft's "before submitting this for real" checks are down to one: read
   AssemblyAI's current data retention/subprocessor terms before answering
   the "ephemeral processing" question with full confidence (TLS-in-transit
   is now confirmed true against the real deployment, not conditional).

## Suggested order

1. Legal review of the two policy drafts.
2. Play Console account → store listing assets (screenshots from a real
   device install, description, support contact) → submit, with the Data
   Safety form filled in against the deployed app's real behavior.

Nothing left on the engineering side is blocking step 2 — the webapp and
backend are both live, the signed `.aab` exists, and the only remaining
gate is Craig creating the Play Console account himself.
