# FlowCue AI — Android (Trusted Web Activity)

FlowCue AI ships to the Play Store as a **Trusted Web Activity (TWA)** — Google's
recommended path for a PWA, wrapping the real hosted web app in a thin native shell
rather than a separate React Native/native rewrite. Same codebase, same deploys.

This directory holds the Bubblewrap config (`twa-manifest.json`). It currently has
**placeholder values** that only Craig can finalize:

## What's done
- `twa-manifest.json` — TWA config (package id, colors, icon URLs) pointed at a
  placeholder domain `app.flowcue.ai`.
- `webapp/public/.well-known/assetlinks.json` — Digital Asset Links file that proves
  the Android app and the website are owned by the same person, so the OS shows the
  app with no browser UI (no address bar). Currently has a placeholder SHA256
  fingerprint.
- `webapp/public/manifest.json` + full icon set (`webapp/public/icons/`) — the PWA
  manifest Bubblewrap reads from, already wired into `index.html`.

## What Craig needs to do (can't be done on his behalf)
1. **Pick and own the real production domain.** Replace `app.flowcue.ai` in
   `twa-manifest.json` and the two `iconUrl`/`maskableIconUrl` fields with wherever
   the app actually ends up hosted (see [webapp/DEPLOYMENT.md](../webapp/DEPLOYMENT.md)
   — nothing is deployed yet, this is the same blocker).
2. **Generate an Android signing keystore.** This is the identity of the app on the
   Play Store forever — if it's lost, FlowCue AI can never be updated again under the
   same listing. Only Craig should hold this file/password, not stored in this repo:
   ```
   keytool -genkey -v -keystore android.keystore -alias flowcue-upload \
     -keyalg RSA -keysize 2048 -validity 9125
   ```
3. **Get the real SHA256 fingerprint** from that keystore and paste it into
   `webapp/public/.well-known/assetlinks.json` (replacing the placeholder), then
   redeploy the webapp so `https://<your-domain>/.well-known/assetlinks.json` serves
   the real value:
   ```
   keytool -list -v -keystore android.keystore -alias flowcue-upload
   ```
4. **Build the app bundle** once the domain is live and assetlinks.json is verified
   reachable over HTTPS:
   ```
   npm install -g @bubblewrap/cli
   cd android
   bubblewrap build
   ```
   This produces the `.aab` file to upload in Play Console.
5. **Play Console account** ($25 one-time fee, Google account) — needed to actually
   create the store listing and upload the `.aab`. See
   [Task #14 checklist] for the full submission list (data safety form, privacy
   policy URL, screenshots, feature graphic).

Everything above step 1 is blocked until there's a real hosted URL, since the TWA
just points at the live website — there's no separate Android build to "finish" ahead
of that.
