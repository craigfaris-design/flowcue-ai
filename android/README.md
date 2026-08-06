# FlowCue AI — Android (Trusted Web Activity)

FlowCue AI ships to the Play Store as a **Trusted Web Activity (TWA)** — Google's
recommended path for a PWA, wrapping the real hosted web app in a thin native shell
rather than a separate React Native/native rewrite. Same codebase, same deploys.

## Status: `.aab` built and signed, ready to upload

- `twa-manifest.json` points at the real live domain (`flowcue-ai.netlify.app`, see
  [webapp/DEPLOYMENT.md](../webapp/DEPLOYMENT.md)).
- The production signing keystore exists at
  `C:\Users\Craig\flowcue-android-keystore\android.keystore` (alias `flowcue-upload`)
  — deliberately **outside this repo** (also covered by root `.gitignore`'s
  `*.keystore`/`*.jks` as a backup) since losing it means losing the ability to ever
  publish an update under this Play Store listing again. Back this file up somewhere
  durable outside this machine. The keystore password was generated and shown once in
  chat when this was set up — save it in a password manager if you haven't already.
- `webapp/public/.well-known/assetlinks.json` has the real SHA256 fingerprint from
  that keystore, deployed and verified reachable at
  `https://flowcue-ai.netlify.app/.well-known/assetlinks.json`.
- **`android/app-release-bundle.aab`** is the signed app bundle — this is the exact
  file to upload in Play Console. (`app-release-signed.apk` also exists alongside it,
  useful for sideloading a test install on a physical device; Play Console wants the
  `.aab`, not the `.apk`.)

## Rebuilding after a change (e.g. bumping the version, new icons)

```bash
cd android
bubblewrap build
```

Two Windows-specific gotchas hit while getting this working the first time, neither
of them Bubblewrap bugs per se, both are `cmd.exe` not searching the current directory
for a bare executable name (a Windows security default, not new to this project):

1. **`'gradlew.bat' is not recognized...`** — Bubblewrap shells out to `gradlew.bat`
   by bare name, which `cmd.exe` won't resolve from the current directory alone.
   Fix: add this `android/` directory to `PATH` for the session before building.
2. **`'jarsigner' is not recognized...`** — same issue, for the JDK's `jarsigner`
   (used to sign the `.aab` specifically; `apksigner` for the `.apk` apparently
   resolves fine via Bubblewrap's own Android SDK path handling). Fix: also add the
   JDK's `bin` directory to `PATH` (Bubblewrap installs its own JDK at
   `C:\Users\Craig\.bubblewrap\jdk\jdk-17.0.11+9\bin` if you let it self-install one).

Also hit once: `Could not reserve enough space for 1572864KB object heap` — Gradle's
default heap request (1536MB) failed to reserve in this environment despite several
GB of free memory being reported, most likely a tighter effective memory limit than
Windows itself reports. Fixed by lowering `org.gradle.jvmargs` in `gradle.properties`
to `-Xmx768m` — a TWA wrapper project is tiny and doesn't need much heap to compile.

Putting it together, a full non-interactive rebuild from a fresh shell looks like:

```powershell
cd android
$env:Path = "$PWD;C:\Users\Craig\.bubblewrap\jdk\jdk-17.0.11+9\bin;" + $env:Path
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = "<the keystore password>"
$env:BUBBLEWRAP_KEY_PASSWORD = "<the same password>"
"n" | bubblewrap build   # "n" skips re-running the interactive manifest wizard
```

Answering the "apply twa-manifest.json changes?" prompt with **"n"** (not "y") matters
if you've hand-edited `twa-manifest.json` yourself, e.g. just to bump
`appVersionName`/`appVersionCode` — answering "y" re-runs Bubblewrap's full
interactive setup wizard, including free-text prompts (app name, version string,
etc.) that a blind `yes`-piped answer will silently fill with the literal string
`"y"` instead of a real value. Found this the hard way: it wrote `"appVersionName":
"y"` into the manifest, caught and fixed before it reached a real build. If you do
want the wizard (e.g. after a real manifest field change), run it in a real
interactive terminal instead of piping answers.

## What Craig still needs to do (can't be done on his behalf)

1. **Play Console account** ($25 one-time fee, Google account) — needed to actually
   create the store listing and upload `app-release-bundle.aab`.
2. **Store listing assets** — description, screenshots (from a real device/build),
   feature graphic. See `PLAY_STORE_LAUNCH_CHECKLIST.md` at the repo root for the
   full list.
3. **Legal review** of `legal/PRIVACY_POLICY.md` and `legal/TERMS_OF_SERVICE.md**
   before linking them from the store listing (see that checklist for specifics).

The backend STT relay (AssemblyAI, switched from Deepgram for cost) is
already deployed live at `flowcue-backend.onrender.com` -- see
`server/README.md`. Nothing left here is blocked on that.
