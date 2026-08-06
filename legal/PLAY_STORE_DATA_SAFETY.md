> **DRAFT — Craig fills this into Play Console's actual Data Safety form
> himself** (Google requires the account owner to submit it, it can't be
> filed on your behalf). This maps each answer to what the section is
> called in Play Console as of the last time this was written, but Google
> changes that form's wording periodically — read the on-screen question
> text and match it to the intent below rather than pasting blindly.
> Re-verify against the app's actual behavior at submission time. Last
> updated 2026-08-06: the webapp is live at `flowcue-ai.netlify.app` and the
> STT relay is live at `flowcue-backend.onrender.com`, both over real
> HTTPS/WSS (see `webapp/DEPLOYMENT.md` and `server/README.md`) — the
> encryption-in-transit answer below can now genuinely be "yes," not
> conditional on hosting that didn't exist yet.

# Play Store Data Safety — draft answers

## Does your app collect or share any of the required user data types?

**Yes** — one data type: audio (voice) that passes through for
transcription. Nothing else.

## Data type: Audio → Voice or sound recordings

- **Collected?** Yes — your microphone audio is transmitted off your device
  while live cueing is active.
- **Shared?** Yes — with AssemblyAI, our real-time transcription provider,
  solely to convert your speech to text for the app's own use.
- **Purpose(s):** App functionality (this is the core feature — following
  along as you speak).
- **Is this data processed ephemerally?** Yes, if Play Console offers this
  option for your category — audio is streamed through in real time and not
  written to disk or a database at any point in FlowCue AI's own
  infrastructure; it's forwarded and discarded. (See the fact-finding notes
  in `PRIVACY_POLICY.md` for the exact code paths this is based on.) Note:
  AssemblyAI, as the receiving third party, has its own retention practices
  independent of this — check AssemblyAI's current data retention terms
  before finalizing this answer, since "ephemeral on our side" doesn't
  automatically mean "ephemeral on theirs."
- **Is this data required or optional?** Optional in the sense that denying
  microphone permission simply disables live cueing — the rest of the app
  (writing/editing scripts) still works without it. But it's required for
  the app's primary feature.
- **Can users request this data be deleted?** Not applicable in the usual
  sense — FlowCue AI doesn't retain it to delete. There's no account and no
  server-side data store holding your audio.

## Every other Play Console data category (personal info, financial info,
## health/fitness, messages, photos/videos, files/docs, calendar, contacts,
## app activity, web browsing, app info & performance, device/other IDs)

**Not collected**, based on the current code:

- No account/login system exists — nothing tied to an email, name, or
  persistent identity is transmitted anywhere (the email shown in the
  sidebar is hardcoded placeholder UI text, not real account data).
- Scripts, rehearsal session stats, and settings are stored **only in
  localStorage on-device** — never transmitted to FlowCue AI's servers or
  any third party, so per Google's own guidance this does not count as
  "collected" (collection means transmitted off the device).
- No analytics, crash reporting, or advertising SDK is integrated anywhere
  in the app.
- No location, camera, contacts, calendar, or file-system access is
  requested — the only permission the app asks for is the microphone.

**One judgment call for Craig/legal to confirm:** the app loads its
typeface from Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`),
which sends the requesting IP address to Google as an inherent side effect
of any network request to a third-party CDN. Most apps don't itemize this
kind of incidental resource load in the Data Safety form (it's not data the
app collects for its own purposes), but confirm this reading holds for
however Google is currently interpreting "collection" for embedded
third-party resources before submitting.

## Security practices section

- **Is data encrypted in transit?** Yes — audio travels over a secure
  WebSocket (`wss://`) to FlowCue AI's relay, and from the relay to
  AssemblyAI over their secured API connection. Verified: production
  hosting (Netlify + Render, see `server/README.md`) terminates real TLS,
  not the self-signed dev cert used for local/LAN testing — confirmed by
  connecting directly to the deployed relay and receiving a valid response
  over `wss://`.
- **Can users request data deletion?** There's no account to delete data
  from. Locally stored data (scripts, session history, settings) can be
  cleared anytime via the in-app "Clear all local data" button in Settings,
  or by clearing the browser's/app's site data — mention this in the form
  if there's a free-text field for it, since Google does ask how users can
  manage their own data even without a formal account-deletion flow.
- **Committed to Play Families Policy / target audience:** the app has no
  age-gating and isn't designed for children — when Play Console asks for
  target age group, this should be general audience (not "primarily
  child-directed"), consistent with there being no COPPA-related handling
  in the code today.

## Before submitting this for real

1. ~~Confirm production hosting is live and actually HTTPS/WSS~~ — done,
   see the note at the top of this file.
2. Re-run the fact-finding pass in `PRIVACY_POLICY.md`'s appendix if any
   backend/auth/analytics work has landed since this draft was written —
   this form must match current behavior, not this snapshot.
3. Read AssemblyAI's current data retention / subprocessor terms before
   answering the "ephemeral processing" question with full confidence.
