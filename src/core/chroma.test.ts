import { describe, expect, it } from 'vitest';
import { CHROMA_SAMPLE_RATE, computeChromagram, estimateTuning, averageChroma } from './chroma';
import { resample, stft } from './dsp';
import { renderProgression } from '../audio/synth';

function detunedTone(midi: number, cents: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  const freq = 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let h = 1; h <= 5; h++) v += (1 / h) * Math.sin((2 * Math.PI * freq * h * i) / sampleRate);
    out[i] = 0.3 * v;
  }
  return out;
}

describe('computeChromagram', () => {
  it('lights up the chord tones of a C major triad', () => {
    const audio = renderProgression([{ root: 0, quality: 'maj', beats: 8 }], {
      sampleRate: 44100,
      bpm: 100,
      drums: false,
    });
    const mono = resample(audio, 44100, CHROMA_SAMPLE_RATE);
    const chroma = computeChromagram(mono, CHROMA_SAMPLE_RATE);
    const avg = averageChroma(chroma.treble, chroma.frames, chroma.energy);
    const ranked = avg.map((v, pc) => ({ v, pc })).sort((a, b) => b.v - a.v);
    const top3 = ranked.slice(0, 3).map((r) => r.pc).sort((a, b) => a - b);
    expect(top3).toEqual([0, 4, 7]); // C, E, G
  });

  it('puts the root in the bass chroma', () => {
    const audio = renderProgression([{ root: 5, quality: 'maj', beats: 8 }], {
      sampleRate: 44100,
      bpm: 100,
      drums: false,
    });
    const mono = resample(audio, 44100, CHROMA_SAMPLE_RATE);
    const chroma = computeChromagram(mono, CHROMA_SAMPLE_RATE);
    const avg = averageChroma(chroma.bass, chroma.frames, chroma.energy);
    let peak = 0;
    for (let i = 1; i < 12; i++) if (avg[i] > avg[peak]) peak = i;
    expect(peak).toBe(5); // F
  });
});

describe('estimateTuning', () => {
  it('reads back a deliberate detune', () => {
    for (const cents of [-40, -15, 0, 20, 35]) {
      const sr = CHROMA_SAMPLE_RATE;
      const tone = detunedTone(57, cents, 2, sr); // A3
      const spec = stft(tone, sr, { fftSize: 8192, hopSize: 1024 });
      const tuning = estimateTuning(spec);
      expect(tuning * 100).toBeCloseTo(cents, -1.05);
    }
  });
});
