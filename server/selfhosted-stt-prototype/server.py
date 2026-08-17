"""
Self-hosted STT engine prototype -- R&D spike, NOT wired into production.

Speaks the exact WebSocket protocol webapp/src/hooks/useAssemblyAIRecognition.ts
expects from server/src/sttRelay.ts + AssemblyAI combined, so it's a genuine
drop-in test target via that hook's `relayUrl` override -- no frontend changes
needed to point a test session at this instead of the real relay.

Pipeline: raw PCM16 mono 16kHz audio in -> Silero VAD detects utterance
end -> Moonshine (open-source, ONNX) transcribes that segment -> a `Turn`
message goes back out, shaped exactly like AssemblyAI's.

Emits incremental partial Turns (end_of_turn: false) while a segment is
still open, not just one complete Turn at the end -- Moonshine has no native
incremental-decode API, so this fakes it the standard way: periodically
re-transcribe the growing in-progress segment and let the real frontend's
own existing per-turn_order word-diffing (useAssemblyAIRecognition.ts,
emittedByTurn) handle only emitting the new words. No protocol change
needed -- that dedup logic already assumes a turn's word list only grows.
"""

import asyncio
import json
import numpy as np
import onnxruntime
import torch
import websockets
from websockets.exceptions import ConnectionClosed
from silero_vad import load_silero_vad, VADIterator
import moonshine_onnx as m

import os

SAMPLE_RATE = 16000
VAD_FRAME_SAMPLES = 512  # Silero's required chunk size at 16kHz
MODEL_NAME = os.environ.get("MOONSHINE_MODEL", "moonshine/base")
PARTIAL_INTERVAL_SAMPLES = int(0.5 * SAMPLE_RATE)  # re-decode the open segment at most every 0.5s

# Confirmed live in concurrency-testing (task #4, round 2): moving inference
# to a thread pool alone made things WORSE at N=16 (1.4/11 turns avg -- a
# collapse, not a decline). Cause: onnxruntime defaults to multi-threaded
# intra-op parallelism *within* a single Run() call, so N concurrent Python
# threads each additionally fan out into several of their own OS threads --
# severe oversubscription on an 8-core CPU. Pinning each session to
# single-threaded inference and getting concurrency from many parallel
# single-threaded sessions instead (standard practice for serving many
# concurrent small-model inferences) is the fix -- moonshine_onnx's
# MoonshineOnnxModel doesn't expose a sess_options param, so this patches
# the SessionOptions in at the onnxruntime.InferenceSession level.
_orig_session_init = onnxruntime.InferenceSession.__init__


def _single_threaded_session_init(self, path_or_bytes, sess_options=None, *a, **kw):
    if sess_options is None:
        sess_options = onnxruntime.SessionOptions()
        sess_options.intra_op_num_threads = 1
        sess_options.inter_op_num_threads = 1
    return _orig_session_init(self, path_or_bytes, sess_options, *a, **kw)


onnxruntime.InferenceSession.__init__ = _single_threaded_session_init

print(f"Loading models (one-time, at server startup)... MOONSHINE_MODEL={MODEL_NAME}")
_vad_model = load_silero_vad()
_stt_model = m.MoonshineOnnxModel(model_name=MODEL_NAME)
_tokenizer = m.load_tokenizer()
# warm up so the first real utterance isn't paying graph-init cost
_ = _tokenizer.decode_batch(_stt_model.generate(np.zeros((1, SAMPLE_RATE), dtype=np.float32)))
print("Models loaded. Ready for connections.")


def pcm16_bytes_to_float32(raw: bytes) -> np.ndarray:
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


# Confirmed live in stress-testing (task #3): on noisy audio, Moonshine can
# get stuck in a repetition loop -- the same word or short phrase repeated
# dozens of times ('Dof. Dof. Dof. ...' x62 on moderate noise; real content
# repeated 24x on heavy noise) instead of failing gracefully. A known small-
# ASR-model failure mode, not something AssemblyAI exhibits. Rather than
# forward garbage into live cueing, detect it and mark the segment
# low-confidence using the SAME confidence field the real frontend already
# filters on (CONFIDENCE_FLOOR = 0.3 in useAssemblyAIRecognition.ts) -- no
# protocol change needed, the existing contract already has a place for
# "don't trust this."
#
# Confirmed live in ad-lib stress-testing (finding #9): a hardcoded
# `range(1, 8)` (1-7 word repeating units) missed an actual 8-word loop
# ('and join me in wishing them a lie' x20+) completely -- it sailed through
# as a "clean" partial. Scaling the checked gram length to the actual text
# (capped, so this stays cheap on long transcripts) instead of an arbitrary
# small constant closes that gap rather than just raising the same hardcoded
# ceiling by one and leaving the next-longer loop equally undetected.
def detect_repetition_hallucination(text: str, max_repeats: int = 3) -> tuple[str, bool]:
    words = text.split()
    n = len(words)
    max_gram_len = min(n // 2, 30)
    for gram_len in range(1, max_gram_len + 1):
        if gram_len * 2 > n:
            break
        i = 0
        while i + gram_len * 2 <= n:
            unit = words[i:i + gram_len]
            repeats = 1
            j = i + gram_len
            while j + gram_len <= n and words[j:j + gram_len] == unit:
                repeats += 1
                j += gram_len
            if repeats > max_repeats:
                cleaned = words[:i] + unit
                return " ".join(cleaned), True
            i += 1
    return text, False


async def transcribe_segment(full_audio: np.ndarray, start: int, end: int) -> tuple[str, bool]:
    seg = full_audio[start:end][np.newaxis, :]
    if seg.shape[1] == 0:
        return "", False
    # See the concurrency-testing comment history in FINDINGS.md: to_thread
    # is what lets multiple sessions' (and multiple partials within one
    # session's) inference calls genuinely run in parallel instead of
    # serializing on the event loop.
    tokens = await asyncio.to_thread(_stt_model.generate, seg)
    raw_text = _tokenizer.decode_batch(tokens)[0].strip()
    return detect_repetition_hallucination(raw_text)


async def handle_connection(ws):
    vad_iter = VADIterator(_vad_model, sampling_rate=SAMPLE_RATE, threshold=0.5, min_silence_duration_ms=300)
    session_audio: list[np.ndarray] = []  # all audio this session, for slicing completed segments out of
    frame_buffer = np.zeros((0,), dtype=np.float32)
    segment_start_sample: int | None = None
    last_partial_sample: int | None = None
    last_partial_text = ""
    current_pos = 0  # running absolute sample count, for throttling partial re-decodes
    turn_order = 0

    async def send_turn(text: str, hallucinated: bool, end_of_turn: bool):
        # Confirmed live: partials can hallucinate on truncated/incomplete
        # audio mid-sentence (e.g. "...she was getting sick, she was getting
        # sick." self-correcting to "...married." one update later) -- a
        # real limitation of re-decoding a growing window rather than true
        # incremental decoding. The frontend's word-diff only appends, it
        # can't retract an earlier wrong word, so partials get a lower
        # confidence than finals: still above CONFIDENCE_FLOOR (0.3) so they
        # still show live (that's the point), but signaling real uncertainty
        # -- same idea as a real streaming ASR's own interim-vs-final
        # confidence gap, not this system pretending partials are as
        # trustworthy as a completed, fully-decoded segment.
        if hallucinated:
            confidence = 0.15  # below CONFIDENCE_FLOOR -> frontend discards it entirely
        elif not end_of_turn:
            confidence = 0.5  # partial: shown, but marked less certain than a final
        else:
            confidence = 1.0
        words = [{"text": w, "confidence": confidence} for w in text.split()]
        await ws.send(json.dumps({
            "type": "Turn",
            "turn_order": turn_order,
            "end_of_turn": end_of_turn,
            "transcript": text,
            "words": words,
        }))

    # Confirmed live in ad-lib stress-testing: a client disconnecting (its
    # own timeout, a closed tab, a dropped connection) while a transcription
    # was still in flight crashed this connection's handler with an
    # unhandled ConnectionClosed traceback on the next send. Doesn't take
    # down the server (each connection is its own handler invocation), but
    # a client hanging up mid-session is normal, expected behavior, not an
    # error condition worth a traceback in the log.
    try:
        await ws.send(json.dumps({"type": "ready"}))
        await ws.send(json.dumps({"type": "Begin"}))

        async for message in ws:
            if isinstance(message, str):
                continue  # this prototype has no client->server control messages yet

            chunk = pcm16_bytes_to_float32(message)
            session_audio.append(chunk)
            frame_buffer = np.concatenate([frame_buffer, chunk])

            # Feed Silero VAD in fixed-size frames -- it requires exactly
            # VAD_FRAME_SAMPLES per call, but real audio arrives in whatever
            # chunk sizes the browser's AudioWorklet happens to send.
            while len(frame_buffer) >= VAD_FRAME_SAMPLES:
                frame = frame_buffer[:VAD_FRAME_SAMPLES]
                frame_buffer = frame_buffer[VAD_FRAME_SAMPLES:]
                current_pos += VAD_FRAME_SAMPLES

                # VADIterator tracks its own absolute sample position
                # internally (current_sample, incremented by exactly one
                # frame per call) -- event['start']/['end'] are already
                # absolute indices into the whole stream, not offsets
                # within this frame. Adding a frame-relative offset on top
                # (an earlier version of this code did) double-counts
                # position and slices the wrong audio.
                event = vad_iter(torch.from_numpy(frame), return_seconds=False)

                if event and "start" in event:
                    segment_start_sample = event["start"]
                    last_partial_sample = None
                    last_partial_text = ""

                if event and "end" in event and segment_start_sample is not None:
                    full_audio = np.concatenate(session_audio)
                    text, hallucinated = await transcribe_segment(full_audio, segment_start_sample, event["end"])
                    if hallucinated:
                        print(f"  [turn {turn_order}] REPETITION DETECTED, marked low-confidence: {text!r}")
                    if text:
                        await send_turn(text, hallucinated, end_of_turn=True)
                        print(f"[turn {turn_order}] FINAL {text!r}")
                    turn_order += 1
                    segment_start_sample = None
                    last_partial_sample = None
                    last_partial_text = ""
                    continue

                # Still inside an open segment, no end event yet this frame
                # -- periodically re-decode audio-so-far and emit a partial
                # Turn, so a long sentence shows *something* before the
                # eventual pause instead of staying blank for several
                # seconds. Relies on the real frontend's existing
                # per-turn_order word-diff logic (emittedByTurn in
                # useAssemblyAIRecognition.ts) to only surface the
                # newly-appeared words each time -- same mechanism it
                # already uses for AssemblyAI's own partial turns.
                if segment_start_sample is not None and not (event and "end" in event):
                    since = current_pos - (last_partial_sample if last_partial_sample is not None else segment_start_sample)
                    if since >= PARTIAL_INTERVAL_SAMPLES:
                        full_audio = np.concatenate(session_audio)
                        text, hallucinated = await transcribe_segment(full_audio, segment_start_sample, current_pos)
                        last_partial_sample = current_pos
                        if text and text != last_partial_text and not hallucinated:
                            last_partial_text = text
                            await send_turn(text, hallucinated=False, end_of_turn=False)
                            print(f"  [turn {turn_order}] partial: {text!r}")
    except ConnectionClosed:
        pass


async def main(port: int = 8765):
    print(f"Self-hosted STT prototype listening on ws://localhost:{port}")
    async with websockets.serve(handle_connection, "localhost", port, max_size=256 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
