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
>
> **2026-08-12 update:** added the "App activity" data type below for the
> new opt-in, off-by-default anonymous session-metrics feature (Settings →
> "Help improve FlowCue AI") -- `server/src/routes/metrics.ts` (validation),
> `webapp/src/lib/anonymousMetrics.ts` (client submission),
> `server/src/migrations/002_anonymous_metrics.sql` (storage, no
> identifying columns). **Confirmed fully live end-to-end** same day:
> `flowcue-metrics-db` (Render free Postgres) provisioned and linked to the
> backend, migrations applied on boot (`server/src/index.ts`), and verified
> directly against the production endpoint -- a valid submission returns
> `204` and is actually persisted, an invalid one (extra field) is rejected
> `400`. Free-tier Postgres note: this specific database expires 30 days
> after creation unless upgraded to a paid plan -- if it lapses, submissions
> go back to being silently discarded (no user-facing breakage, just no
> data collected) until/unless it's renewed. Re-verify this section against
> the code and the database's actual status at submission time regardless,
> same as everything else in this file.

# Play Store Data Safety — draft answers

## Does your app collect or share any of the required user data types?

**Yes** — two data types: audio (voice) that passes through for
transcription, and (only if the user opts in) anonymous app-activity
metrics. Nothing else.

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

## Data type: App activity → App interactions (or "Other app performance
## data," depending on how Play Console currently buckets this)

- **Collected?** Only if the user explicitly opts in via a Settings toggle
  ("Help improve FlowCue AI"), **off by default**. Nothing under this
  category is collected unless and until a user turns this on themselves.
- **Shared?** No — this is FlowCue AI's own first-party backend, not shared
  with any third party.
- **Purpose(s):** Analytics (to improve default app tuning/behavior based on
  aggregate patterns across sessions). Not used for advertising,
  personalization shown back to the user, or any purpose other than
  informing future default-tuning decisions.
- **What exactly is collected:** per-session numeric summaries only --
  duration, word count, words-per-minute, filler-word rate, a
  tracking-confidence score, freeze count, which language/visual mode was
  selected, and whether the primary or fallback recognizer was used. See
  `PRIVACY_POLICY.md`'s "Optional: help improve FlowCue AI" section for the
  complete, exact field list. **Never included:** any transcript, spoken
  words, script text/title, or audio.
- **Is this data linked to an identifiable user?** No -- submissions carry
  no account ID, device ID, or other identifier, and the server does not
  log/store the requesting IP alongside them. If Play Console's form
  distinguishes "collected" from "linked to you," this should be answered
  as collected-but-not-linked.
- **Is this data required or optional?** Fully optional -- the entire app,
  including live cueing, works identically whether this is on or off.
- **Can users request this data be deleted?** Not in the way an
  account-linked record could be, since submissions aren't tied to a
  specific user or device in the first place -- there's no "your data" to
  locate within the aggregate. Turning the toggle off stops any future
  session from being included.

## Every other Play Console data category (personal info, financial info,
## health/fitness, messages, photos/videos, files/docs, calendar, contacts,
## web browsing, device/other IDs)

**Not collected**, based on the current code:

- No account/login system exists — nothing tied to an email, name, or
  persistent identity is transmitted anywhere (the email shown in the
  sidebar is hardcoded placeholder UI text, not real account data).
- Scripts, rehearsal session stats, and settings are stored **only in
  localStorage on-device** — never transmitted to FlowCue AI's servers or
  any third party, so per Google's own guidance this does not count as
  "collected" (collection means transmitted off the device). This is
  separate from, and unaffected by, the opt-in App activity metrics above --
  those are freshly computed numbers sent (only if enabled) at the end of a
  session, not the locally-stored history itself being transmitted.
- No third-party analytics, crash reporting, or advertising SDK is
  integrated anywhere in the app.
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
4. Confirm the "Help improve FlowCue AI" toggle actually defaults to off in
   a fresh install before submitting the App activity answers above --
   this entire section's accuracy depends on that being true in the
   shipped build, not just the code as originally written.
