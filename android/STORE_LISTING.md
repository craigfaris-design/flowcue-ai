# FlowCue AI — Play Store Listing Content

Drafted copy ready to paste into Play Console's store listing form. Character counts
verified against Google's actual limits. Everything here describes only features that
exist and work today (verified this session) — nothing aspirational.

## App name
FlowCue AI
(10 characters — Play Store's limit is 30)

## Short description (max 80 characters)
```
Speech-following teleprompter — follows you, even off-script or paused.
```
(73 characters)

## Full description (max 4000 characters)
```
FlowCue AI is a teleprompter that actually listens. Instead of scrolling at a fixed
speed and leaving you to keep up, it follows your real voice — speeding up, slowing
down, and holding position exactly where you need it.

REAL SPEECH, NOT A SCRIPT ROBOT
Presentations don't go word-for-word. FlowCue AI is built for that:
• Chat with the room before you start — it waits patiently until you begin reading
• Skip ahead, backtrack, or repeat a line — it re-finds your place automatically
• Go off-script for a joke or a story — it holds position and picks you back up the
  moment you return to the text, instead of getting lost or racing ahead without you

VISUAL READING MODES
Pick the display that works for how you read:
• Sentence Glow — the current sentence stays highlighted and easy to find
• Focus Zone — a narrow reading window like real teleprompter hardware, cutting down
  on eye movement
• Confidence Colors — see in real time how confidently you're being tracked, not just
  a binary "on track" or "lost"

BUILT-IN COACHING
• Tap any word for pronunciation help, including a syllable breakdown
• Turn on Syllable Breaks to see long or complicated words split up
  (com·mu·ni·ca·tion) throughout your whole script
• Practice Mode gives live coaching tips as you rehearse — pace, filler words — without
  it counting toward your saved session history
• After a real session, see your pace, filler word count, and a confidence trend
  across your last 10 rehearsals

MULTIPLE LANGUAGES
Rehearse in English, Spanish, French, German, Portuguese, Italian, Dutch, Hindi,
Korean, or Russian.

WORKS OFFLINE FOR REHEARSAL
Cache any script for offline use, so you can rehearse without a connection.

BUILT FOR REAL TELEPROMPTER USE
Mirror-flip mode for physical teleprompter glass rigs. The screen stays awake for
your whole rehearsal — no dimming or locking mid-speech.

IMPORT YOUR SPEECH
Paste your script directly, or import an existing Word document (.docx) or text file.

PRIVACY
FlowCue AI does not store your audio. Speech is processed only to follow your
position in the script, never recorded or saved. Your scripts, rehearsal history, and
settings stay on your device.

Whether it's a wedding toast, a conference talk, or a rehearsal for the big pitch —
FlowCue AI keeps up with you, not the other way around.
```
(Character count: ~2,150 — well under the 4000 limit, leaving room to expand later.)

## Category
**Productivity** (primary) — reasonable alternative: **Business**. Not
"Entertainment" or "Video Players" despite the presentation-adjacent use case; the
core function is rehearsal/productivity tooling.

## Screenshots — capture plan (need real device/build captures, not mockups)

Google requires phone screenshots at minimum (2–8 images, JPEG or 24-bit PNG, no
alpha, 16:9 or 9:16, each dimension between 320px and 3840px). Suggested shot list,
in the order they should appear (first 2–3 matter most — they're what shows in search
results before a user taps in):

1. **Rehearsal screen mid-session, Sentence Glow mode** — the core "it's following me"
   moment. Capture with a real script loaded and the current sentence visibly
   highlighted.
2. **Confidence Colors mode active** — shows the live-tracking-confidence concept
   visually (the colored indicator), something a static description can't easily
   convey.
3. **The "holding position" freeze banner mid-tangent** — demonstrates the
   headline differentiator (waits for you, doesn't get lost) in a single frame.
4. **Practice Mode with a live coaching nudge visible** — shows the coaching feature
   concretely, not just described.
5. **AI Coach post-session report** — pace/filler words/confidence trend chart,
   shows the app has depth beyond just cueing.
6. **Settings screen showing the language picker** — communicates multi-language
   support at a glance.
7. **Library/script list** — shows the app manages multiple scripts, not just one.
8. *(Optional 8th)* Onboarding or the import-from-Word-doc flow.

Each should be captured on an actual phone (or the sideloaded
`android/app-release-signed.apk`) at the device's native resolution — don't upscale
a desktop screenshot. Add short on-image captions if easy to do (Play listings with
captioned screenshots convert better), but plain screenshots are acceptable too.

## Feature graphic & icon
Already built and verified at the exact required dimensions — no action needed:
- `webapp/public/icons/feature-graphic.png` — 1024×500 ✓
- `webapp/public/icons/icon-512.png` — 512×512 ✓

## Still needed before this can actually be submitted
- The screenshots themselves (real captures, per the plan above).
- A real support contact email/URL (currently a placeholder in the legal drafts).
- A real, legally-reviewed Privacy Policy URL to link in the listing (see
  `PLAY_STORE_LAUNCH_CHECKLIST.md`).
