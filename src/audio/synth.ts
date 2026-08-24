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
export interface PluckVoice {
  /**
   * Corner of the loop filter in Hz: how fast the upper partials die.
   *
   * Set in Hz rather than as a coefficient because a coefficient is not a
   * timbre — the two-point average this replaces is a filter whose corner
   * moves with the sample rate, so the same chord came out of a 44.1 kHz
   * device sounding brighter than out of a 48 kHz one, and brighter than
   * anything measured at 22 kHz offline. Measured in the browser at 44.1 kHz
   * the top two octaves were 12 dB hotter than the same call in node at
   * 22 kHz. A corner in Hz is the same corner everywhere.
   */
  cutoff?: number;
  /** Legacy weight for the previous sample, when no `cutoff` is given: a plain
      two-point average, whose response depends on the sample rate. Every
      caller that predates `cutoff` gets exactly what it always got. */
  damping?: number;
  /** Where along the string it was plucked, as a fraction of its length. A
      pluck at 1/p nulls every pth harmonic, which is the difference between a
      string and filtered noise. 0 leaves the excitation broadband. */
  pluckPos?: number;
}

function addPluck(
  out: Float32Array,
  startSample: number,
  midi: number,
  amp: number,
  sampleRate: number,
  decay: number,
  rand: () => number,
  voice: PluckVoice = {},
): void {
  if (startSample < 0 || startSample >= out.length) return;
  const damping = voice.damping ?? 0.5;
  const pluckPos = voice.pluckPos ?? 0;
  // A one-pole at a fixed corner, or the rate-dependent two-point average the
  // fixtures were built on. `a` is the pole; `damping` is the FIR weight.
  const pole = voice.cutoff != null ? Math.exp((-2 * Math.PI * voice.cutoff) / sampleRate) : null;
  const f0 = midiToFreq(midi);
  // The loop filter contributes half a sample of delay; fold it into the length
  // so the string sounds at the requested pitch rather than a few cents flat.
  const n = Math.max(2, Math.round(sampleRate / f0 - 0.5));
  const buf = new Float32Array(n);
  // The excitation is noise through a one-pole, and its corner has to be in Hz
  // for the same reason the loop filter's does: `0.65` is a corner of 1.5 kHz
  // at 22 kHz and of 3 kHz at 44 kHz, so the seed itself came out brighter on
  // a device with a faster clock. Legacy callers keep the coefficient.
  const seedPole = voice.cutoff != null ? Math.exp((-2 * Math.PI * 1512) / sampleRate) : 0.65;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp = seedPole * lp + (1 - seedPole) * (rand() * 2 - 1);
    buf[i] = lp;
  }
  if (pluckPos > 0) {
    // Comb the excitation: the initial shape of a plucked string is a triangle
    // with its corner at the pluck point, and the harmonics with a node there
    // are simply not excited. Modelled as delay-and-subtract, which is what
    // that triangle's spectrum is.
    const d = Math.max(1, Math.round(n * pluckPos));
    const seed = Float32Array.from(buf);
    for (let i = 0; i < n; i++) buf[i] = seed[i] - seed[(i + d) % n];
  }
  const len = Math.min(out.length - startSample, Math.floor(decay * sampleRate));
  const g = Math.pow(0.001, n / (decay * sampleRate)); // -60 dB after `decay`
  let idx = 0;
  let last = 0;
  let lowpassed = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    out[startSample + i] += amp * cur;
    if (pole != null) {
      lowpassed = (1 - pole) * cur + pole * lowpassed;
      buf[idx] = g * lowpassed;
    } else {
      buf[idx] = g * ((1 - damping) * cur + damping * last);
    }
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
 * The voice the chord library plays, measured against a real guitar.
 *
 * GuitarSet is 180 close-miked acoustic recordings, so it answers what a real
 * one looks like rather than what a plucked-string model sounds like on its
 * own. Two differences showed up and both are here. A real guitar keeps its
 * upper partials: over the two seconds after a strum its spectral centroid
 * settles around 1400 Hz, while a plain two-point loop filter had ours down at
 * 510 Hz and sounding like a rubber band. And a real one is loudest between
 * 120 and 240 Hz with a dip above it, where ours peaked at 480-960 — the
 * difference is the box, which `body` below stands in for.
 */
const ACOUSTIC: PluckVoice = { cutoff: 11000, pluckPos: 0.13 };

/*
   Calibrated against GuitarSet at 44.1 kHz, which is where it is heard — a
   browser's AudioContext runs at 44.1 or 48 kHz and never at the 22 kHz the
   analysis works in, and this model does not sound the same at both. Mean
   absolute error over seven octave bands, one strum of E major against the
   longest sustained E major in 00_SS1-68-E_comp:

     before          7.68 dB
     after           1.17 dB at 44.1 kHz, 1.33 at 48

   `pluckPos` is a sharp optimum — 0.08 and 0.18 both cost about 2 dB — which
   is what you would expect of a parameter that is doing real physical work
   rather than fitting noise: it is roughly where a pick meets the string. */

/**
 * The soundboard: two resonances it adds, and a scoop it takes away.
 *
 * A guitar body has dozens of coupled modes, but measured against GuitarSet in
 * octave bands the whole difference is three numbers. Referenced to 120-240 Hz,
 * where a real acoustic peaks, a bare string model came out +9.3 dB at 240-480,
 * +13.4 at 480-960 and +6.4 at 960-1920, while the bottom octave and everything
 * above 4 kHz were already within half a decibel. So the box is not adding
 * bass here — it is taking out a broad scoop through the low mids, deepest
 * around 700 Hz, which is what makes a guitar sound like a box with a hole in
 * it rather than like a rubber band. The two added resonances put the air and
 * top-plate modes back under it.
 */
function body(x: Float32Array, sampleRate: number): Float32Array {
  const out = Float32Array.from(x);
  /** Parallel band-pass, added to the dry signal: a mode that rings. */
  const resonate = (freq: number, q: number, gain: number): void => {
    const w = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const xn = x[i];
      const yn = (alpha * xn - alpha * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn;
      out[i] += gain * yn;
    }
  };
  /** Peaking filter in series, applied to everything: the scoop. */
  const peak = (freq: number, q: number, db: number): void => {
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const b0 = 1 + alpha * A, b1 = -2 * Math.cos(w), b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A, a1 = -2 * Math.cos(w), a2 = 1 - alpha / A;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const xn = out[i];
      const yn = (b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn;
      out[i] = yn;
    }
  };
  /** High shelf: the top two octaves of a bare string are brighter than wood. */
  const shelf = (freq: number, db: number): void => {
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * freq) / sampleRate;
    const c = Math.cos(w), sq = 2 * Math.sqrt(A) * (Math.sin(w) / 2) * Math.SQRT2;
    const b0 = A * (A + 1 + (A - 1) * c + sq);
    const b1 = -2 * A * (A - 1 + (A + 1) * c);
    const b2 = A * (A + 1 + (A - 1) * c - sq);
    const a0 = A + 1 - (A - 1) * c + sq;
    const a1 = 2 * (A - 1 - (A + 1) * c);
    const a2 = A + 1 - (A - 1) * c - sq;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const xn = out[i];
      const yn = (b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn;
      out[i] = yn;
    }
  };
  resonate(104, 2.4, 2.6);
  resonate(198, 3.0, 1.5);
  peak(360, 1.1, -4);
  peak(760, 1.0, -13);
  peak(1500, 1.2, -2);
  shelf(2200, -6);
  return out;
}

export function renderShapeStrum(frets: number[], opts: { sampleRate?: number; seed?: number } = {}): Float32Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const rand = mulberry32(opts.seed ?? 20);
  const out = new Float32Array(Math.ceil(2.4 * sampleRate));
  let voice = 0;
  frets.forEach((fret, string) => {
    if (fret < 0) return;
    // A real strum crosses the strings in about 20 ms, not 32 per string, and
    // the pick digs hardest into the middle of the sweep.
    const at = Math.floor(voice * 0.019 * sampleRate);
    const middle = 1 - Math.abs(voice - 2.5) / 3.5;
    voice++;
    addPluck(out, at, STANDARD_TUNING[string] + fret, 0.24 + 0.12 * middle, sampleRate, 2.6, rand, ACOUSTIC);
  });
  return normalizePeak(body(out, sampleRate), 0.85);
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
        if (voice) addPluck(out, Math.floor(at * sampleRate), voice.midi, amp * 1.15, sampleRate, 2.1, rand, ACOUSTIC);
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
          ACOUSTIC,
        );
      });
    }
  }
  return normalizePeak(body(out, sampleRate), 0.88);
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
