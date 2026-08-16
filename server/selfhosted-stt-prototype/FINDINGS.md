# Self-hosted STT engine — R&D spike findings

Status: **prototype, not wired into production.** Everything here is local to
this dev machine. `flowcue-backend` on Render still runs AssemblyAI,
unchanged. This directory is not deployed anywhere.

Goal this spike was chasing: could an open-source, self-hosted speech
pipeline replace AssemblyAI, removing the per-minute usage cost? Short
answer: **technically yes, promising results, not production-ready yet.**
See "Go/no-go" at the bottom.

## What's here

- `server.py` — a WebSocket server speaking the *exact* protocol
  `webapp/src/hooks/useAssemblyAIRecognition.ts` expects (`ready` -> `Begin`
  -> `Turn` messages), so it's a drop-in test target via that hook's
  `relayUrl` override. No frontend changes needed to point a test session at
  it instead of the real relay (`webapp/.env.local`:
  `VITE_STT_RELAY_URL=ws://localhost:8765`).
- `test_client.py` — simulates a real browser session: real-time-paced PCM16
  audio streaming, prints every message received with real timing.
- `concurrency_test.py` — same, but N simultaneous sessions at once, to
  measure real capacity rather than guess it.
- Pipeline: raw PCM16 audio -> Silero VAD detects utterance end -> Moonshine
  (open-source, ONNX, runs on CPU) transcribes that segment -> a `Turn`
  message goes out.

## Findings, in the order they were found

1. **Model size was never the bottleneck — segmentation architecture was.**
   Naive fixed-time chunking fragmented speech badly regardless of model
   size (`tiny` and `base` both produced garbage like `"Ever try ever try"`,
   `"It."` on the same clean audio). Switching to Silero VAD (pause-based
   segmentation instead of a dumb clock) fixed it immediately — 5/6 segments
   came out essentially perfect on the first real test.

2. **Real streaming latency is comparable to AssemblyAI's own configured
   settings.** ~90ms transcription time after each detected pause, plus
   VAD's configured 300ms silence-confirmation wait -> ~390-460ms total,
   in the same ballpark as the `max_turn_silence: 400ms` AssemblyAI is
   already tuned to in `server/src/sttRelay.ts`.

3. **Noise exposes a real, serious failure mode: repetition hallucination.**
   On moderate noise (15dB SNR), one segment produced `'Dof. Dof. Dof. ...'`
   repeated 62 times. On heavy noise (5dB SNR), real content repeated 24
   times (`'I honestly did not believe her,'` x24). This is a known small-
   ASR-model failure mode, not something AssemblyAI exhibits — commercial
   engines are hardened against it. **Fixed** with
   `detect_repetition_hallucination()`: detects repeating n-grams, truncates
   to one copy, and marks the segment confidence at 0.15 — below the
   frontend's existing `CONFIDENCE_FLOOR = 0.3` in
   `useAssemblyAIRecognition.ts`, so the real app's existing filtering logic
   discards it automatically. No protocol changes needed.

4. **Concurrency: the naive implementation blocked the whole event loop
   during inference.** One connection transcribing froze every other
   connection's audio ingestion. Fixed with `asyncio.to_thread()` — but that
   alone made high concurrency *worse* (N=16 went from a graceful decline to
   a collapse: 1.4/11 turns avg), because onnxruntime's default multi-
   threaded intra-op parallelism meant N concurrent Python threads were each
   *also* fanning out into several more OS threads — severe oversubscription
   on an 8-core CPU. Fixed by pinning each onnxruntime session to
   single-threaded inference (`intra_op_num_threads = 1`) and getting
   concurrency from many parallel single-threaded sessions instead —
   standard practice for serving many concurrent small-model inferences.

5. **Real measured concurrency ceiling, `moonshine/base`, this machine
   (Ryzen 7 1700X, 8 cores/16 threads, CPU only, no GPU):** rock solid
   through N=10 (11.0/11 turns, zero degradation). Falls off sharply by
   N=16. This tracks physical core count almost exactly — past ~8-10 truly
   simultaneous transcriptions you're out of cores, not fighting a config
   problem.

6. **`moonshine/tiny` vs `moonshine/base` trade-off, measured directly:**
   - Accuracy on heavy noise: `tiny` did *not* produce any repetition
     hallucinations on the same 5dB clip that made `base` loop 24 times —
     instead it made milder word-substitution errors (`"I"` -> `"High"`,
     `"been best"` -> `"invest"`). Arguably a *better* failure mode for live
     cueing: a wrong word is something the sync engine already tolerates; a
     24x-repeated phrase is structurally disruptive.
   - Concurrency: `tiny` held N=16 at 8.4/11 turns vs `base`'s 3.4/11 at the
     same load — meaningfully more headroom on the same hardware.
   - Trade-off is real and worth revisiting once there's a production
     accuracy bar to test against, not just this spike's ad-hoc samples.

7. **GPU path attempted, not completed.** `onnxruntime-gpu` installed
   successfully and detects the driver (CUDA 12.6), but the CUDA execution
   provider fails to load — it needs the full CUDA 13 + cuDNN 9 *toolkit*
   installed system-wide, not just the driver. That's a multi-GB install via
   NVIDIA's own installer (not pip), and can require a reboot to fully take
   effect. Deliberately not attempted in this session — too heavy/risky a
   move to make casually, and a reboot would have ended the session's
   ability to keep working. Falls back to CPU cleanly (no crash) in the
   meantime.

8. **Partial/incremental transcripts: built, works, has a real remaining
   quality issue.** Moonshine has no native incremental-decode API, so this
   fakes it the standard way -- periodically re-decode the growing
   in-progress segment (every 0.5s) and emit a partial `Turn`
   (`end_of_turn: false`). The real frontend's existing per-`turn_order`
   word-diff logic (`emittedByTurn` in `useAssemblyAIRecognition.ts`) needs
   no changes to handle this -- it already assumes a turn's word list only
   grows. Verified live: `'And thank you.'` -> `'And thank you for being
   here tonight.'` growing in real time, not just appearing all at once
   after the pause.

   Real issue found: re-decoding a *truncated* mid-sentence window can
   hallucinate plausible-but-wrong text that a later, more-complete partial
   corrects (`'she was getting sick, she was getting sick.'` self-correcting
   to `'...married.'` one update later; a fabricated `'since the 2018...
   since the 2019'` correcting to `'...the third grade.'`). Because the
   frontend's word-diff only *appends*, it can't retract an earlier wrong
   word the way it could with true incremental decoding. Mitigated, not
   solved: partial words now carry confidence 0.5 (finals carry 1.0, both
   above the frontend's `CONFIDENCE_FLOOR = 0.3`) -- signals real
   uncertainty rather than presenting a partial as equally trustworthy to a
   completed segment, but a wrong word can still reach `ingestWord()`
   before self-correcting. Whether the sync engine's own confidence-based
   freeze behavior absorbs this gracefully in practice is untested.

9. **Ad-libs, repeats, and self-correction — the actual PRD requirement —
   tested against realistic messy speech, not clean scripted text.**
   Synthesized a sample with a deliberate stutter-restart (`"wait, sorry,
   let me start again"`), a genuine repeated line, and a mid-sentence
   backtrack (`"actually you know what, we've been friends since third
   grade, not high school"`). Results:
   - Genuinely repeated lines across separate utterances came through
     correctly as two distinct FINAL turns, not merged or wrongly
     suppressed by the repetition guard (finding #3) — confirms that guard
     only fires on pathological *within-segment* repetition (>3x), not on a
     speaker naturally repeating a line, which is exactly the boundary it
     needed to respect.
   - The self-correction phrasing itself was transcribed verbatim
     (`'Actually you know what, we have been friends since their grade.'`)
     — the sync engine needs the actual backtrack words to recognize what
     happened, and it got them, minor homophone errors aside
     (`third`->`their`, `wait`->`weight` — normal ASR noise, not
     hallucination).
   - **`'They're great.'` mystery, root-caused — correcting the earlier
     guess in this doc.** Initially suspected an end-of-stream/flush bug.
     Actual cause, found via debug instrumentation + offline replay of the
     exact segment: it's a mundane mishearing of `"third grade"` (they're
     genuinely similar-sounding), same category as the other minor
     homophone errors above — not a streaming bug at all. The real
     `"raise your glass, raise your glass"` repeat, once correctly located,
     came through fine as two separate turns.
   - **Real bug found instead, while chasing the above:** debug logging
     surfaced a severe repetition hallucination the guard (finding #3)
     completely missed — `'and join me in wishing them a lie'` repeated
     20+ times, sent out as a "clean" partial. Cause: `detect_repetition_hallucination`
     hardcoded `range(1, 8)` (checks 1-7 word repeating units); the actual
     loop was exactly 8 words, one past the ceiling. **Fixed** — the check
     now scales to the text length (capped at 30) instead of a fixed
     constant, so raising a hardcoded ceiling by one doesn't just move the
     blind spot to the next-longer loop. Verified with a direct unit test
     against the exact repeated string that slipped through: now correctly
     flagged and truncated.
   - **Second real bug found in the same investigation:** a client
     disconnecting while a transcription was in flight crashed that
     connection's handler with an unhandled `ConnectionClosed` traceback.
     **Fixed** — wrapped in try/except; verified via a clean re-run (no
     traceback, silent graceful exit).

## What's still genuinely untested

- Real human voices, accents, real background noise recordings (everything
  here used TTS-generated audio + synthetic noise — a reasonable proxy, not
  the real thing).
- Real interruptions/ad-libs/backtracking mid-sentence (the PRD's actual
  "recovers from skips, repeats, ad-libs" requirement) — not stress-tested
  yet.
- Multi-language behavior (Moonshine's language support wasn't evaluated
  against the app's `SUPPORTED_LANGUAGES` list at all).
- Whether the sync engine (`syncEngine.ts`) actually absorbs a transient
  wrong partial word gracefully in practice, per finding #8 above — tested
  only that the protocol delivers the words, not what the live cueing UI
  does with a self-correcting one.
- **Re-verified, not just suspected:** concurrency ceiling *with* partials
  enabled is meaningfully worse than finding #5's ~8-10 (which predates
  partials). Re-ran the same test with partials on: N=6 already degrades
  (9.2/11 turns avg, vs a flawless 11.0/11 without partials at the same
  N=6). Partial re-decoding (every 0.5s during open segments) is a real,
  substantial CPU cost, not a free UX upgrade — this is the concrete trade
  to weigh: smoother live word-by-word feedback vs roughly halved usable
  concurrency per server on this hardware. Whichever is chosen, size
  capacity planning off *this* number, not finding #5's.

## Go / no-go

**Not ready to touch production.** Genuinely promising, real bugs found and
partially fixed, real numbers instead of guesses — but:

- The repetition guard is a mitigation, not a guarantee; it hasn't been
  tested against real noisy human speech, only synthetic noise.
- No incremental/partial transcript support yet — a real product regression
  if shipped as-is.
- Concurrency ceiling (~8-10 on this dev machine) needs to be re-measured on
  whatever actual production hardware would run this, not extrapolated from
  a gaming PC's CPU.

If this ever moves toward production: run it **in parallel with AssemblyAI
behind a feature flag**, comparing outputs on real traffic, never a hard
cutover — this is the piece of the product the reliability positioning is
built on.
