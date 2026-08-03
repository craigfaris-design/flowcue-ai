# FlowCue AI — Play Store Launch Checklist

Last updated: 2026-07-28. This is the master list tying together everything
built for Play Store readiness across `webapp/`, `server/`, `android/`, and
`legal/`. Organized by who can actually move each item forward — most of
what's left is not code.

## ✅ Done (engineering)

- **PWA manifest + full icon set** — `webapp/public/manifest.json`,
  `webapp/public/icons/*`, wired into `index.html` and the service worker
  precache list. Original artwork (no third-party logo resemblance —
  see the logo-options review currently in progress with Craig for the
  final direction).
- **Android TWA scaffold** — `android/twa-manifest.json`,
  `webapp/public/.well-known/assetlinks.json`, `android/README.md`
  explaining the remaining steps. Placeholder domain/package id/signing
  key references throughout, clearly marked.
- **Production deployment scaffolding** — `server/Dockerfile`,
  `server/docker-compose.yml` (`--profile full`), `webapp/DEPLOYMENT.md`.
  Build + runtime stages verified locally (compiles, boots, serves).
  Fixed a real cross-domain bug in the Deepgram relay URL resolution
  (`VITE_STT_RELAY_URL`) that would've silently broken live cueing the
  moment webapp and server ended up on different hosts.
- **Privacy Policy draft** — `legal/PRIVACY_POLICY.md`.
- **Terms of Service draft** — `legal/TERMS_OF_SERVICE.md`.
- **Play Store Data Safety disclosure draft** — `legal/PLAY_STORE_DATA_SAFETY.md`.
- **186/186 webapp tests passing**, **12/12 server tests passing** as of
  this writing — see `webapp/README.md` / `server/README.md`.

## 🔲 Blocked on Craig (money, accounts, decisions only he can make)

None of this can be done on his behalf — see the standing note in
`webapp/DEPLOYMENT.md` and `android/README.md` for why.

1. **Pick and buy a real production domain**, or confirm using a free host's
   subdomain (Netlify/Vercel) for launch. Needed before anything below can
   be finalized with real values instead of placeholders.
2. **Deploy the server somewhere real** (Render, Fly.io, Railway, a VM —
   `server/Dockerfile` is ready for any of these) with a real Postgres
   instance and `DEEPGRAM_API_KEY` set. Currently nothing is deployed —
   everything runs on localhost only.
3. **Deploy the webapp** to that domain (`webapp/DEPLOYMENT.md` has three
   ready options), and set `VITE_STT_RELAY_URL` in its build environment to
   the real server URL if they're on different domains.
4. **Generate an Android signing keystore** (`keytool` command is in
   `android/README.md`) and keep it somewhere safe outside this repo —
   losing it means never being able to update the Play Store listing again
   under the same app identity.
5. **Get the real SHA256 fingerprint** from that keystore into
   `webapp/public/.well-known/assetlinks.json`, replacing the placeholder,
   and redeploy the webapp.
6. **Build the `.aab`** via `bubblewrap build` (`android/README.md`) once
   1–5 are done.
7. **Create a Google Play Console account** ($25 one-time fee) — required
   to create the listing and upload the `.aab` at all.
8. **Decide on the Deepgram production plan** — confirm the API key used in
   production is on a plan that can handle real usage/cost, not just a free
   dev-tier key.
9. **Store listing assets** — app description/marketing copy, screenshots
   (from a real build, not this dev environment), and a final choice of
   which generated icon/feature-graphic set to use — see the logo-options
   review currently underway.
10. **A real support contact** (email or URL) — both legal drafts and the
    Play Console listing itself need one; currently a placeholder.

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
   draft has three explicit "before submitting this for real" checks at the
   bottom (TLS actually live in production, Deepgram's current retention
   terms, re-verify nothing has changed in the codebase since this was
   written).

## Suggested order

1. Finish the logo direction (in progress).
2. Domain + hosting decisions (Craig) → deploy webapp + server for real.
3. Legal review of the two policy drafts, in parallel with step 2.
4. Signing keystore + assetlinks.json real values → build the `.aab`.
5. Play Console account → store listing assets → submit, with the
   Data Safety form filled in against the *deployed* app's real behavior.

Nothing left on the engineering side is blocking steps 2–5 — the scaffolding
for all of it already exists and is tested.
