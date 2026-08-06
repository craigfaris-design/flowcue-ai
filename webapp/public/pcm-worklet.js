// Runs on the audio rendering thread, not the main thread -- this is what
// AudioWorklet exists for, so PCM conversion never competes with React
// rendering or blocks on anything else happening in the tab.
//
// AssemblyAI's streaming API (see server/src/sttRelay.ts) wants raw 16-bit
// PCM, not the webm/opus container MediaRecorder produces -- that's the
// whole reason this file exists instead of reusing MediaRecorder like the
// Deepgram integration did.
class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffered rather than posting every 128-sample render quantum (~3ms at
    // 48kHz) straight to the main thread -- that would be an excessive
    // number of postMessage calls per second for no benefit, since network
    // sends every ~3ms would be far more overhead than the audio itself.
    // ~100ms chunks match the granularity the old MediaRecorder timeslice
    // used, a reasonable balance of latency vs. message overhead.
    this.buffer = [];
    this.bufferedSamples = 0;
    this.chunkSamples = Math.floor(sampleRate * 0.1);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channelData = input[0];

    this.buffer.push(channelData.slice());
    this.bufferedSamples += channelData.length;

    if (this.bufferedSamples >= this.chunkSamples) {
      const merged = new Float32Array(this.bufferedSamples);
      let offset = 0;
      for (const chunk of this.buffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.buffer = [];
      this.bufferedSamples = 0;

      // Float32 [-1, 1] -> Int16 PCM little-endian, what pcm_s16le means.
      const pcm16 = new Int16Array(merged.length);
      for (let i = 0; i < merged.length; i++) {
        const clamped = Math.max(-1, Math.min(1, merged[i]));
        pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorkletProcessor);
