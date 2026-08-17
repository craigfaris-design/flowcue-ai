"""
Real concurrency test: launch N simultaneous client sessions against the one
running server instance, each streaming real-time-paced audio like a real
user would, and measure how per-turn latency changes as N grows. This is
the number that actually determines server cost/sizing -- not a guess.
"""

import asyncio
import json
import sys
import time
import numpy as np
import websockets
import moonshine_onnx as m

CHUNK_SAMPLES = 1024
SAMPLE_RATE = 16000


def float32_to_pcm16_bytes(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767).astype(np.int16).tobytes()


async def one_client(client_id: int, audio: np.ndarray, url: str, results: list):
    turn_latencies = []
    turns_received = 0
    connect_start = time.time()
    try:
        async with websockets.connect(url, max_size=256 * 1024) as ws:
            last_send_time = {"t": None}

            async def recv():
                nonlocal turns_received
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg["type"] == "Turn" and last_send_time["t"] is not None:
                        turns_received += 1

            recv_task = asyncio.create_task(recv())

            chunk_duration = CHUNK_SAMPLES / SAMPLE_RATE
            stream_start = time.time()
            for i in range(0, len(audio), CHUNK_SAMPLES):
                chunk = audio[i:i + CHUNK_SAMPLES]
                await ws.send(float32_to_pcm16_bytes(chunk))
                last_send_time["t"] = time.time()
                target_elapsed = (i + CHUNK_SAMPLES) / SAMPLE_RATE
                actual_elapsed = time.time() - stream_start
                if target_elapsed > actual_elapsed:
                    await asyncio.sleep(target_elapsed - actual_elapsed)

            finish_send_time = time.time()
            await asyncio.sleep(3.0)  # let trailing turns arrive
            recv_task.cancel()

            total_wall = time.time() - connect_start
            results.append({
                "client_id": client_id,
                "turns_received": turns_received,
                "total_wall_s": total_wall,
                "audio_duration_s": len(audio) / SAMPLE_RATE,
                "extra_delay_after_last_chunk_s": total_wall - (finish_send_time - connect_start),
            })
    except Exception as e:
        results.append({"client_id": client_id, "error": str(e)})


async def run_concurrency_level(n: int, audio: np.ndarray, url: str):
    results = []
    t0 = time.time()
    await asyncio.gather(*[one_client(i, audio, url, results) for i in range(n)])
    wall = time.time() - t0
    ok = [r for r in results if "error" not in r]
    errors = [r for r in results if "error" in r]
    print(f"\n=== N={n} concurrent clients ===")
    print(f"  wall time for all to finish: {wall:.1f}s")
    print(f"  succeeded: {len(ok)}/{n}, errors: {len(errors)}")
    if errors:
        print(f"  error sample: {errors[0]['error']}")
    if ok:
        avg_turns = sum(r["turns_received"] for r in ok) / len(ok)
        avg_total = sum(r["total_wall_s"] for r in ok) / len(ok)
        print(f"  avg turns received per client: {avg_turns:.1f} (expect 11 if healthy)")
        print(f"  avg per-client total wall time: {avg_total:.1f}s (audio duration: {audio.shape[0]/SAMPLE_RATE:.1f}s)")


async def main():
    url = "ws://localhost:8765"
    path = r"C:\Users\Craig\dev\flowcue-ai\server\selfhosted-stt-prototype\wedding_toast_clean.wav"
    audio = m.load_audio(path)[0]

    for n in [6, 10, 16, 24]:
        await run_concurrency_level(n, audio, url)
        await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())
