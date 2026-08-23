import { describe, expect, it } from 'vitest';
import { bestChordForChroma } from './analyze';
import { CHROMA_SAMPLE_RATE, averageChroma, computeChromagram } from './chroma';
import { resample } from './dsp';
import { MusicGate, isMusical, musicFeaturesFrom, type MusicFeatures } from './music';
import { DEMO_PROGRESSION, renderProgression } from '../audio/synth';

const SR = 44100;
const WINDOW_SECONDS = 1.5;

/** The live readout's pipeline, applied to one analysis window. */
function features(window: Float32Array): MusicFeatures {
  let sum = 0;
  for (let i = 0; i < window.length; i++) sum += window[i] * window[i];
  const level = Math.sqrt(sum / window.length);
  const mono = resample(window, SR, CHROMA_SAMPLE_RATE);
  const chroma = computeChromagram(mono, CHROMA_SAMPLE_RATE, { fftSize: 4096, hopSize: 1024 });
  const treble = Float32Array.from(averageChroma(chroma.treble, chroma.frames, chroma.energy));
  const bass = Float32Array.from(averageChroma(chroma.bass, chroma.frames, chroma.energy));
  l2(treble);
  l2(bass);
  return musicFeaturesFrom(chroma, level, bestChordForChroma(treble, bass).score);
}

function l2(v: Float32Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (n > 1e-9) for (let i = 0; i < v.length; i++) v[i] /= n;
}

function windowsOf(signal: Float32Array, gain = 1): Float32Array[] {
  const size = Math.floor(WINDOW_SECONDS * SR);
  const out: Float32Array[] = [];
  for (let start = 0; start + size <= signal.length; start += Math.floor(0.5 * SR)) {
    const slice = new Float32Array(size);
    for (let i = 0; i < size; i++) slice[i] = signal[start + i] * gain;
    out.push(slice);
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('isMusical', () => {
  const song = renderProgression(DEMO_PROGRESSION.slice(0, 4), { sampleRate: SR, bpm: 96, seed: 7 });

  it('accepts a played song, even a quiet one', () => {
    for (const gain of [1, 0.1]) {
      for (const window of windowsOf(song, gain)) {
        expect(isMusical(features(window))).toBe(true);
      }
    }
  });

  it('rejects silence and a barely audible source', () => {
    expect(isMusical(features(new Float32Array(Math.floor(WINDOW_SECONDS * SR))))).toBe(false);
    for (const window of windowsOf(song, 0.02)) {
      expect(isMusical(features(window))).toBe(false);
    }
  });

  it('rejects broadband room noise', () => {
    const rand = mulberry32(42);
    const noise = new Float32Array(4 * SR);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.12 * (rand() * 2 - 1);
    for (const window of windowsOf(noise)) {
      expect(isMusical(features(window))).toBe(false);
    }
  });

  it('rejects a speech-like gliding voice', () => {
    // A sawtooth "voice" wandering around 190 Hz in syllable-sized bursts: as
    // harmonic as a real voice, but never holding a pitch the way harmony does.
    const rand = mulberry32(9);
    const speech = new Float32Array(4 * SR);
    let phase = 0;
    for (let i = 0; i < speech.length; i++) {
      const t = i / SR;
      const f0 = 190 + 60 * Math.sin(2 * Math.PI * 0.9 * t) + 25 * Math.sin(2 * Math.PI * 3.1 * t + 1);
      phase += f0 / SR;
      const saw = 2 * (phase - Math.floor(phase + 0.5));
      const syllable = Math.max(0, Math.sin(2 * Math.PI * 2.2 * t)) ** 0.7;
      speech[i] = 0.16 * saw * syllable + 0.004 * (rand() * 2 - 1);
    }
    for (const window of windowsOf(speech)) {
      expect(isMusical(features(window))).toBe(false);
    }
  });

  it('rejects a mains hum, which is tonal and steady but never breathes', () => {
    const hum = new Float32Array(4 * SR);
    for (let i = 0; i < hum.length; i++) {
      const t = i / SR;
      hum[i] =
        0.02 * Math.sin(2 * Math.PI * 50 * t) +
        0.008 * Math.sin(2 * Math.PI * 150 * t) +
        0.004 * Math.sin(2 * Math.PI * 250 * t);
    }
    for (const window of windowsOf(hum)) {
      expect(isMusical(features(window))).toBe(false);
    }
  });
});

describe('MusicGate', () => {
  const musical: MusicFeatures = {
    level: 0.05,
    tonality: 0.4,
    steadiness: 0.95,
    activity: 1.2,
    chordScore: 0.15,
  };
  const quiet: MusicFeatures = { level: 0, tonality: 0, steadiness: 0, activity: 0, chordScore: 0 };

  it('ignores a transient shorter than the streak', () => {
    const gate = new MusicGate();
    expect(gate.push(musical)).toBe(false);
    expect(gate.push(musical)).toBe(false);
    expect(gate.push(quiet)).toBe(false);
    expect(gate.push(musical)).toBe(false);
    expect(gate.push(musical)).toBe(false);
    expect(gate.open).toBe(false);
  });

  it('opens on sustained music and stays open through a quiet bar', () => {
    const gate = new MusicGate();
    gate.push(musical);
    gate.push(musical);
    expect(gate.push(musical)).toBe(true);
    expect(gate.push(quiet)).toBe(true);
    expect(gate.open).toBe(true);
  });

  it('opens on the synthesized song within a second of readings', () => {
    const song = renderProgression(DEMO_PROGRESSION.slice(0, 2), { sampleRate: SR, bpm: 96, seed: 3 });
    const gate = new MusicGate();
    let opensAt = -1;
    windowsOf(song).forEach((window, index) => {
      if (gate.push(features(window)) && opensAt < 0) opensAt = index;
    });
    expect(opensAt).toBe(2);
  });
});
