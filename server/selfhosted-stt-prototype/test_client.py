"""
Simulates what useAssemblyAIRecognition.ts actually does: opens a WebSocket,
waits for `ready`, then streams raw PCM16 audio in small chunks (like the
AudioWorklet does) rather than one big blob, and prints every message
received back, with real timing -- this is an end-to-end protocol test over
an actual network socket, not an in-process function call.
"""

import asyncio
import json
import sys
import time
import numpy as np
import websockets
import moonshine_onnx as m  # only for its bundled sample audio + loader

CHUNK_SAMPLES = 1024  # a realistic small AudioWorklet-sized chunk
SAMPLE_RATE = 16000


def float32_to_pcm16_bytes(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767).astype(np.int16).tobytes()


async def main(wav_path: str, url: str = "ws://localhost:8765"):
    audio = m.load_audio(wav_path)[0]  # (N,) float32 @ 16kHz
    duration = len(audio) / SAMPLE_RATE
    print(f"Streaming {duration:.2f}s of audio from {wav_path} in {CHUNK_SAMPLES}-sample chunks...")

    t_connect = time.time()
    async with websockets.connect(url, max_size=256 * 1024) as ws:
        print(f"connected in {(time.time()-t_connect)*1000:.0f}ms")

        recv_task = asyncio.create_task(receive_loop(ws, t_connect))

        # Stream chunks paced to real time, like a live mic would actually
        # deliver them -- not as fast as the CPU can send bytes.
        chunk_duration = CHUNK_SAMPLES / SAMPLE_RATE
        stream_start = time.time()
        for i in range(0, len(audio), CHUNK_SAMPLES):
            chunk = audio[i:i + CHUNK_SAMPLES]
            await ws.send(float32_to_pcm16_bytes(chunk))
            target_elapsed = (i + CHUNK_SAMPLES) / SAMPLE_RATE
            actual_elapsed = time.time() - stream_start
            if target_elapsed > actual_elapsed:
                await asyncio.sleep(target_elapsed - actual_elapsed)

        # give the server a moment to flush any trailing utterance
        await asyncio.sleep(6.0)
        recv_task.cancel()
        print("done streaming (real-time paced).")


async def receive_loop(ws, t_connect):
    turn_count = 0
    async for raw in ws:
        msg = json.loads(raw)
        elapsed = (time.time() - t_connect) * 1000
        if msg["type"] == "Turn":
            turn_count += 1
            kind = "FINAL" if msg.get("end_of_turn") else "partial"
            print(f"  [+{elapsed:7.0f}ms] TURN #{msg['turn_order']} ({kind}): {msg['transcript']!r}")
        else:
            print(f"  [+{elapsed:7.0f}ms] {msg['type']}")


if __name__ == "__main__":
    wav = sys.argv[1] if len(sys.argv) > 1 else str(m.ASSETS_DIR / "beckett.wav")
    asyncio.run(main(wav))
