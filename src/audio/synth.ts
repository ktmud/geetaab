import { normalizePeak } from '../core/dsp';
import { QUALITY_INTERVALS, type ChordQuality } from '../core/chordTypes';

export interface SynthChord {
  root: number; // pitch class, 0 = C
  quality: ChordQuality;
  beats: number;
}

export interface SynthOptions {
  bpm?: number;
  sampleRate?: number;
  /** Percussion helps the beat tracker lock on, exactly as it does in real songs. */
  drums?: boolean;
  /** Sixteenth-note strum grid, one entry per eighth of a bar. */
  strum?: boolean;
  noise?: number;
  seed?: number;
}

/** Deterministic PRNG so synthesized fixtures are byte-stable across runs. */
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

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Bass note plus a close upper voicing, the way a guitar actually sits. */
export function voicingFor(root: number, quality: ChordQuality): number[] {
  const intervals = QUALITY_INTERVALS[quality];
  const bass = 40 + ((root - 4 + 12) % 12); // E2..D#3
  const notes = [bass];
  for (const iv of intervals) {
    notes.push(60 + ((root + iv) % 12)); // C4..B4
  }
  notes.push(bass + 12); // doubled root, the way an open guitar chord rings
  return notes;
}

/**
 * Karplus-Strong plucked string.
 *
 * A delay line seeded with filtered noise gives the full harmonic series of a
 * real string for the cost of one multiply-add per sample, which keeps the test
 * fixtures cheap enough to synthesize on every run.
 */
function addPluck(
  out: Float32Array,
  startSample: number,
  midi: number,
  amp: number,
  sampleRate: number,
  decay: number,
  rand: () => number,
): void {
  if (startSample < 0 || startSample >= out.length) return;
  const f0 = midiToFreq(midi);
  // The loop filter contributes half a sample of delay; fold it into the length
  // so the string sounds at the requested pitch rather than a few cents flat.
  const n = Math.max(2, Math.round(sampleRate / f0 - 0.5));
  const buf = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp = 0.65 * lp + 0.35 * (rand() * 2 - 1);
    buf[i] = lp;
  }
  const len = Math.min(out.length - startSample, Math.floor(decay * sampleRate));
  const g = Math.pow(0.001, n / (decay * sampleRate)); // -60 dB after `decay`
  let idx = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    out[startSample + i] += amp * cur;
    buf[idx] = g * 0.5 * (cur + last);
    last = cur;
    idx = idx + 1 === n ? 0 : idx + 1;
  }
}

function addKick(out: Float32Array, at: number, sampleRate: number, amp: number): void {
  const len = Math.min(out.length - at, Math.floor(0.22 * sampleRate));
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const f = 110 * Math.exp(-t * 28) + 45;
    const env = Math.exp(-t * 16);
    out[at + i] += amp * env * Math.sin(2 * Math.PI * f * t);
  }
}

/** Decaying noise burst through a one-pole highpass: snares and hats. */
function addNoiseHit(
  out: Float32Array,
  at: number,
  sampleRate: number,
  amp: number,
  decayRate: number,
  brightness: number,
  rand: () => number,
): void {
  if (at < 0 || at >= out.length) return;
  const len = Math.min(out.length - at, Math.floor((5 / decayRate) * sampleRate));
  let prevIn = 0;
  let prevOut = 0;
  let env = amp;
  const step = Math.exp(-decayRate / sampleRate);
  for (let i = 0; i < len; i++) {
    const white = rand() * 2 - 1;
    prevOut = brightness * (prevOut + white - prevIn);
    prevIn = white;
    out[at + i] += env * prevOut;
    env *= step;
  }
}

/**
 * Render a chord progression to a mono buffer.
 *
 * Used both for the in-app demo track and as ground truth in the analysis
 * tests, so the pipeline can be verified without a microphone.
 */
export function renderProgression(chords: SynthChord[], opts: SynthOptions = {}): Float32Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const bpm = opts.bpm ?? 96;
  const drums = opts.drums ?? true;
  const strum = opts.strum ?? true;
  const noise = opts.noise ?? 0;
  const rand = mulberry32(opts.seed ?? 1337);

  const beatSeconds = 60 / bpm;
  const totalBeats = chords.reduce((n, c) => n + c.beats, 0);
  const totalSamples = Math.ceil((totalBeats + 1) * beatSeconds * sampleRate);
  const out = new Float32Array(totalSamples);

  let beatCursor = 0;
  const beatsPerBar = 4;
  for (const chord of chords) {
    const notes = voicingFor(chord.root, chord.quality);
    // Offsets within a bar, in beats: down on 1, then the standard
    // down-down-up-up-down shape most beginner songbooks open with.
    const strumOffsets = strum ? [0, 1, 1.5, 2.5, 3] : [0];
    for (let bar = 0; bar * beatsPerBar < chord.beats; bar++) {
      for (const offset of strumOffsets) {
        const position = bar * beatsPerBar + offset;
        if (position >= chord.beats) continue;
        const down = position % 1 === 0;
        const at = Math.floor((beatCursor + position) * beatSeconds * sampleRate);
        if (at >= totalSamples) continue;
        const amp = (down ? 0.22 : 0.14) * (0.9 + 0.2 * rand());
        const order = down ? notes : [...notes].reverse();
        order.forEach((midi, idx) => {
          const spread = Math.floor(idx * 0.012 * sampleRate);
          addPluck(out, at + spread, midi, amp, sampleRate, 1.6, rand);
        });
      }
    }
    beatCursor += chord.beats;
  }

  if (drums) {
    for (let b = 0; b < totalBeats; b++) {
      const at = Math.floor(b * beatSeconds * sampleRate);
      const inBar = b % 4;
      if (inBar === 0 || inBar === 2) addKick(out, at, sampleRate, 0.5);
      if (inBar === 1 || inBar === 3) addNoiseHit(out, at, sampleRate, 0.3, 26, 0.7, rand);
      for (const off of [0, 0.5]) {
        const hat = Math.floor((b + off) * beatSeconds * sampleRate);
        if (hat < totalSamples) addNoiseHit(out, hat, sampleRate, 0.09, 90, 0.97, rand);
      }
    }
  }

  if (noise > 0) {
    for (let i = 0; i < out.length; i++) out[i] += noise * (rand() * 2 - 1);
  }
  return normalizePeak(out, 0.9);
}

/** The demo progression: I–V–vi–IV in G, the backbone of a huge slice of pop. */
export const DEMO_PROGRESSION: SynthChord[] = [
  { root: 7, quality: 'maj', beats: 4 },
  { root: 2, quality: 'maj', beats: 4 },
  { root: 9, quality: 'min', beats: 4 },
  { root: 0, quality: 'maj', beats: 4 },
  { root: 7, quality: 'maj', beats: 4 },
  { root: 2, quality: 'maj', beats: 4 },
  { root: 9, quality: 'min', beats: 4 },
  { root: 0, quality: 'maj', beats: 4 },
];
