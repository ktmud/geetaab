import { normalizePeak } from '../core/dsp';
import { QUALITY_INTERVALS, type ChordQuality } from '../core/chordTypes';
import { STANDARD_TUNING, type ChordShape } from '../music/shapes';
import type { StrumPattern } from '../music/arrange';
import { pluckStringOf } from '../music/pick';

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

/**
 * One slow strum of an actual fingering, low string first.
 *
 * Unlike `renderProgression` this voices the exact frets of a shape rather
 * than an idealised chord, so the chord library plays what the diagram above
 * it shows — a learner checking their own strum against it hears the same
 * notes in the same octaves.
 */
export function renderShapeStrum(frets: number[], opts: { sampleRate?: number; seed?: number } = {}): Float32Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const rand = mulberry32(opts.seed ?? 20);
  const out = new Float32Array(Math.ceil(2.4 * sampleRate));
  let voice = 0;
  frets.forEach((fret, string) => {
    if (fret < 0) return;
    const at = Math.floor(voice++ * 0.032 * sampleRate);
    addPluck(out, at, STANDARD_TUNING[string] + fret, 0.3, sampleRate, 2.1, rand);
  });
  return normalizePeak(out, 0.85);
}

/**
 * One bar of a chord played the way a right-hand pattern says to play it.
 *
 * `renderShapeStrum` above is a single sweep, which is what a chord box wants
 * to sound like when you tap it to check you have the shape. This is what the
 * same shape sounds like in a song: the strum or the picking pattern, at a
 * tempo, with a capo on. Those three are the difference between knowing a
 * shape and being able to use it, and until now the only place to hear them
 * was to record a song and go to the practice screen.
 *
 * The capo raises every fretted and open string equally, which is exactly what
 * the bar of metal does — so C shape at capo 3 comes out sounding D#, and the
 * page can say so.
 */
export interface ShapePatternOptions {
  sampleRate?: number;
  seed?: number;
  /** Beats per minute of the pattern's own beat. */
  bpm?: number;
  /** Semitones the capo adds to every string. */
  capo?: number;
  /** How many times round the bar. */
  bars?: number;
}

export function renderShapePattern(
  frets: number[],
  pattern: StrumPattern,
  opts: ShapePatternOptions = {},
): Float32Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const bpm = Math.max(30, Math.min(240, opts.bpm ?? 90));
  const capo = Math.max(0, opts.capo ?? 0);
  const bars = Math.max(1, opts.bars ?? 1);
  const rand = mulberry32(opts.seed ?? 20);
  const beat = 60 / bpm;
  const barSeconds = pattern.beatsPerBar * beat;
  // A tail past the last bar, because the final chord should ring rather than
  // be cut off at the bar line.
  const out = new Float32Array(Math.ceil((barSeconds * bars + 2.2) * sampleRate));

  // Which strings are sounding, low to high, and at what pitch.
  const sounding: { string: number; midi: number }[] = [];
  frets.forEach((fret, string) => {
    if (fret >= 0) sounding.push({ string, midi: STANDARD_TUNING[string] + fret + capo });
  });

  for (let bar = 0; bar < bars; bar++) {
    for (const step of pattern.steps) {
      const at = bar * barSeconds + step.beat * beat;
      const amp = step.accent ? 0.34 : 0.26;
      if (step.pluck) {
        // One string, named by the shape rather than fixed: the thumb follows
        // the chord's own bass, which is the whole point of the notation.
        const display = pluckStringOf(step.pluck, { frets } as ChordShape);
        const index = 6 - display;
        const voice = sounding.find((v) => v.string === index);
        if (voice) addPluck(out, Math.floor(at * sampleRate), voice.midi, amp * 1.15, sampleRate, 2.1, rand);
        continue;
      }
      // A sweep, not a block: the strings are struck in order across about
      // 25 ms, and an upstroke starts at the treble end.
      const order = step.direction === 'U' ? [...sounding].reverse() : sounding;
      const spread = (step.direction === 'U' ? 0.018 : 0.025) / Math.max(1, order.length - 1);
      order.forEach((voice, i) => {
        // An upstroke on a guitar catches the top strings and little else.
        const reach = step.direction === 'U' && i >= 4 ? 0 : 1;
        if (!reach) return;
        const decay = step.mute ? 0.18 : 2.1;
        addPluck(
          out,
          Math.floor((at + i * spread) * sampleRate),
          voice.midi,
          amp * (step.mute ? 0.7 : 1),
          sampleRate,
          decay,
          rand,
        );
      });
    }
  }
  return normalizePeak(out, 0.85);
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
