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
  /** Corner of the one-pole the excitation noise is seeded through, in Hz:
      how bright the attack itself is, where `cutoff` only sets how fast that
      brightness then dies. Only honoured alongside `cutoff`. */
  seedCutoff?: number;
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
  /** Seconds until the string is struck again and this vibration is damped.
      Rendered with a short fade so the cut is a finger landing, not a splice.
      Omitted, the string rings out its whole decay — the legacy behaviour,
      byte-identical for every caller that predates it. */
  holdSeconds?: number,
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
  const seedPole =
    voice.cutoff != null ? Math.exp((-2 * Math.PI * (voice.seedCutoff ?? 1512)) / sampleRate) : 0.65;
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
  const natural = Math.min(out.length - startSample, Math.floor(decay * sampleRate));
  const fadeLen = Math.floor(0.03 * sampleRate);
  const held = holdSeconds != null ? Math.floor(holdSeconds * sampleRate) + fadeLen : natural;
  const len = Math.min(natural, held);
  const fadeFrom = held < natural ? len - fadeLen : len;
  const g = Math.pow(0.001, n / (decay * sampleRate)); // -60 dB after `decay`
  let idx = 0;
  let last = 0;
  let lowpassed = 0;
  for (let i = 0; i < len; i++) {
    const cur = buf[idx];
    const fade = i >= fadeFrom ? 0.5 + 0.5 * Math.cos((Math.PI * (i - fadeFrom)) / fadeLen) : 1;
    out[startSample + i] += amp * fade * cur;
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
 * The voice the chord library plays, tuned to a chosen recording of the real
 * thing.
 *
 * The reference is an unprocessed A/B of a Martin D-28 and a Gibson J-45 —
 * one player, one room, one Zoom H8N (youtube.com/watch?v=QnYqnOW4la8).
 * Measured over seven octave bands the two guitars differ from each other by
 * about 1 dB; everything else about the sound is shared, so the target is
 * their mean. The recording's chords were segmented by this repo's own
 * analyzer, each segment credited to its guitar by the body colour in the
 * storyboard frames (natural top: D-28, sunburst: J-45), and the voice fitted
 * on the seven chords the video and the library both play: E G C D Am Em F.
 */
const ACOUSTIC: PluckVoice = { cutoff: 20000, pluckPos: 0.12, seedCutoff: 925 };

/**
 * The fingers' contact, for picked notes: crisp at the start, warm after.
 *
 * An exposed single note is where this model's character shows, and two
 * wrong versions taught what the right one is. Seeded at strum brightness
 * the note is dull; seeded bright through the strum's near-transparent loop
 * it stays bright its whole length and reads as thin. A real picked note
 * does neither: the contact is crisp and the tone it settles into is round.
 * So the nail's seed is bright and its loop corner is low — the note opens
 * at 2 kHz and rounds off within a couple hundred milliseconds, and against
 * the video's finger-picked notes the settled body lands within half a
 * decibel (hi/mid -18.4 dB against -18.5). An ideal-triangle excitation was
 * tried too and measured soft and dark: the ideal string is not where pick
 * brightness comes from.
 */
const NAIL: PluckVoice = { cutoff: 6500, pluckPos: 0.08, seedCutoff: 2500 };

/** The thumb's flesh, for bass plucks: darker than a nail, darker than a
    pick. Measured on the reference's thumb notes: 307 Hz at the attack and
    barely moving after — the strum contact opened these notes half an
    octave too bright. */
const THUMB: PluckVoice = { cutoff: 4000, pluckPos: 0.12, seedCutoff: 500 };

/** How much of a pluck lives in the fast decay stage. A picked texture is
    two textures: the thumb lays a bed that hardly falls between notes — the
    recording's picking floor is -6.7 dB — while the fingers speak and then
    recede into that bed rather than droning on top of it. Give both the
    fingers' sustain and the bed to every note and the pattern turns thick:
    "loud and dull" was the ear's name for exactly that. */
const THUMB_MIX = 0.26;
const NAIL_MIX = 0.62;

/*
   Fitted at 44.1 kHz to time-resolved statistics of the recording's strums,
   averaged over excitation seeds: the attack's band profile (first 70 ms),
   the sustain's (0.25-0.9 s), how far each band falls over the first half
   second, and how far the chord has fallen 1, 1.5 and 2 seconds in. The
   profiles are referenced to 480-960 Hz with the two bass bands
   half-weighted: the recording's bottom carries the room and the mic's
   proximity, and a fit that referenced everything to that bass mountain
   could hide dullness behind it.

   No time-averaged spectrum appears in the objective at all any more. One
   fit to that converged to 1.15 dB of band error while collapsing every
   chord to a thud in half a second — an average over time cannot tell a
   bright attack over a dead sustain from a steady warm tone. What survived
   the rounds of listening and refitting is a division of labour: the loop
   filter damps nothing (its corner sits above hearing — decay belongs to the
   two-stage RING below), the excitation corner sets the brightness, and the
   body EQ holds the recording's tilt. The per-band settle over the first
   half second now sits within a decibel of the recording from 240 Hz to
   3.8 kHz.

     drop, attack peak to 0.5 s     model 6.0 dB, recording 7.2
     two seconds into a chord       model -13 dB, recording -9.4

   Some of that last gap is the recording's room ringing on, which the
   `room` below imitates but deliberately understates. */

/**
 * The soundboard: two low resonances, and the recording's tilt.
 *
 * With the loop filter no longer darkening anything, the whole warmth of the
 * reference lives here and in the excitation: a dip at 360 Hz, a deep broad
 * one at 1.5 kHz — the presence region this recording simply does not
 * have — and a steep shelf off everything above 2.5k. The air and top-plate
 * modes at 104 and 198 Hz sit under it all, which is what keeps a chord with
 * no open bass string from sounding like a smaller instrument.
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
  resonate(104, 2.4, 3.2);
  resonate(198, 3.0, 2.1);
  peak(360, 1.1, -9);
  peak(1540, 1.12, -13.4);
  shelf(2460, -15.7);
  return out;
}

/**
 * A close mic still hears the room.
 *
 * The reference was recorded in one, and a bone-dry model reads as synthetic
 * next to it no matter how well the spectra line up. This is the smallest
 * room that works: a few dozen sparse early reflections inside a quarter
 * second, exponentially quieter and lowpassed — walls absorb treble — mixed
 * far under the dry signal. No feedback, so nothing can ring or turn
 * metallic.
 */
function room(x: Float32Array, sampleRate: number): Float32Array {
  const r = mulberry32(7);
  const wet = new Float32Array(x.length);
  for (let tap = 0; tap < 44; tap++) {
    const t = 0.008 + 0.24 * Math.pow(r(), 1.6);
    const g = (r() < 0.5 ? -1 : 1) * 0.34 * Math.exp(-t / 0.075);
    const d = Math.floor(t * sampleRate);
    for (let i = 0; i + d < x.length; i++) wet[i + d] += g * x[i];
  }
  // A short late tail on top of the reflections — two damped combs, roughly
  // 0.6 s to -60 dB — so the last second of a chord sits on the room instead
  // of falling to digital black. In the reference, a passage's final chord is
  // still only ~9 dB down two seconds after the strum.
  for (const { d, g } of [
    { d: Math.floor(0.0531 * sampleRate), g: 0.58 },
    { d: Math.floor(0.0673 * sampleRate), g: 0.54 },
  ]) {
    for (let i = d; i < wet.length; i++) wet[i] += g * wet[i - d];
  }
  const out = Float32Array.from(x);
  const pole = Math.exp((-2 * Math.PI * 3800) / sampleRate);
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    lp = (1 - pole) * (0.55 * wet[i]) + pole * lp;
    out[i] += lp;
  }
  return out;
}

/** The pick's contact itself: a few milliseconds of bright noise under a
    sweep's string, sized from the recording's first-12-ms high-band spike.
    Sweeps only — measured, the plucked notes already spike harder than the
    recording's. */
function addTick(out: Float32Array, at: number, sampleRate: number, amp: number, rand: () => number): void {
  const len = Math.min(out.length - at, Math.floor(0.012 * sampleRate));
  const lpPole = Math.exp((-2 * Math.PI * 6500) / sampleRate);
  const hpPole = Math.exp((-2 * Math.PI * 1500) / sampleRate);
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < len; i++) {
    const white = rand() * 2 - 1;
    hi = (1 - lpPole) * white + lpPole * hi;
    lo = (1 - hpPole) * hi + hpPole * lo;
    out[at + i] += amp * Math.exp(-i / (0.006 * sampleRate)) * (hi - lo);
  }
}

/** The hand coming down on the strings, rather than a hard edit at the end. */
function fadeTail(samples: Float32Array, sampleRate: number, seconds: number): void {
  const len = Math.min(samples.length, Math.floor(seconds * sampleRate));
  for (let i = 0; i < len; i++) {
    samples[samples.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / len);
  }
}

/**
 * A real string decays in two stages, and both are audible in the reference:
 * a strum settles about 7 dB in the first half second, then hangs on — the
 * passage-ending chords are still only ~9 dB down two seconds after the
 * strike. One exponential cannot do both; every fit that tried had to choose
 * between a punchy attack and the long 尾音, and whichever it chose sounded
 * wrong. Physically the stages are the string's two polarizations — the one
 * in line with the soundboard dumps its energy fast, the other rings — so
 * every pluck here is two Karplus-Strong voices: most of the amplitude dying
 * in `fast` seconds, a quieter one taking `slow` to fall 60 dB.
 *
 * `slow` sits deliberately under the recording's measured ring curve: those
 * ring-outs carry the room as well as the strings, and matching them
 * literally left every chord hanging too long for the ear. The loop corner
 * meanwhile is finite again (12 kHz) so the tail loses its top as it rings,
 * the way a real string's does — a tail that darkens reads as shorter and
 * realer than one that stays lit.
 */
const RING = { slow: 8, fast: 0.25, fastMix: 0.74 };

function addString(
  out: Float32Array,
  at: number,
  midi: number,
  amp: number,
  sampleRate: number,
  rand: () => number,
  voice: PluckVoice,
  holdSeconds?: number,
  fastMix = RING.fastMix,
): void {
  addPluck(out, at, midi, amp * fastMix, sampleRate, RING.fast, rand, voice, holdSeconds);
  // The contact's colour dies with the fast stage; what rings on is the
  // string itself, at the string's own corner, whatever touched it.
  addPluck(out, at, midi, amp * (1 - fastMix), sampleRate, RING.slow, rand, { ...voice, cutoff: ACOUSTIC.cutoff }, holdSeconds);
}

export function renderShapeStrum(frets: number[], opts: { sampleRate?: number; seed?: number } = {}): Float32Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const rand = mulberry32(opts.seed ?? 20);
  const out = new Float32Array(Math.ceil(3.8 * sampleRate));
  let voice = 0;
  frets.forEach((fret, string) => {
    if (fret < 0) return;
    // A real strum crosses the strings in about 20 ms, not 32 per string, the
    // pick digs hardest into the middle of the sweep, and no two strings get
    // exactly the same timing, weight, or contact point — the jitter is what
    // keeps six ideal strings from sounding like one machine.
    const at = Math.floor((voice * 0.019 + 0.004 * rand()) * sampleRate);
    const middle = 1 - Math.abs(voice - 2.5) / 3.5;
    voice++;
    const amp = (0.24 + 0.12 * middle) * (0.9 + 0.2 * rand());
    const contact = { ...ACOUSTIC, pluckPos: ACOUSTIC.pluckPos! + (rand() - 0.5) * 0.05 };
    addString(out, at, STANDARD_TUNING[string] + fret, amp, sampleRate, rand, contact);
  });
  const shaped = room(body(out, sampleRate), sampleRate);
  fadeTail(shaped, sampleRate, 0.4);
  return normalizePeak(shaped, 0.85);
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
  const out = new Float32Array(Math.ceil((barSeconds * bars + 2.6) * sampleRate));

  // Which strings are sounding, low to high, and at what pitch.
  const sounding: { string: number; midi: number }[] = [];
  frets.forEach((fret, string) => {
    if (fret >= 0) sounding.push({ string, midi: STANDARD_TUNING[string] + fret + capo });
  });

  // Collect every pluck first, render second: a string that is struck again
  // has to know when, because striking a string silences what it was doing.
  // Without that damping, a ring measured in seconds turns any picking
  // pattern into a wash — eight notes a bar all sounding at once is a harp
  // with the pedal down, not a guitar.
  interface Event {
    at: number;
    string: number;
    midi: number;
    amp: number;
    mute: boolean;
    /** Finger pluck rather than a sweep: use the nail's contact. */
    nail: boolean;
    /** Thumb pluck: the flesh's contact. */
    thumb?: boolean;
    /** The pick's contact burst, on the first string of a sweep. */
    tick?: number;
  }
  const events: Event[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const step of pattern.steps) {
      // A human lands a few milliseconds off the grid, differently every time.
      const at = bar * barSeconds + step.beat * beat + 0.006 * (rand() - 0.5);
      const amp = (step.accent ? 0.34 : 0.26) * (0.9 + 0.2 * rand());
      if (step.pluck) {
        // One string, named by the shape rather than fixed: the thumb follows
        // the chord's own bass, which is the whole point of the notation.
        const display = pluckStringOf(step.pluck, { frets } as ChordShape);
        const index = 6 - display;
        const voice = sounding.find((v) => v.string === index);
        if (voice) {
          const nail = step.pluck.finger !== 'p';
          events.push({
            at,
            string: index,
            midi: voice.midi,
            // Levelled to the recording: thumb and fingers peak a few dB over
            // the passage, the fingers a shade above the thumb.
            amp: amp * (nail ? 1.05 : 0.63),
            mute: false,
            nail,
            thumb: !nail,
            tick: nail ? amp * 0.5 : 0,
          });
        }
        continue;
      }
      // A sweep, not a block. The reference's strums cross the strings in
      // under 10 ms, but the ear preferred the chord-box strum's audible
      // roll, so the pattern strums borrow its hand: a slower downstroke
      // with the pick digging hardest into the middle of the sweep.
      const order = step.direction === 'U' ? [...sounding].reverse() : sounding;
      const struck = step.direction === 'U' ? Math.min(4, order.length) : order.length;
      // A practiced strummer crosses the strings fast — the reference measures
      // under 10 ms — and evenly. The chord-box tap keeps its slow expressive
      // roll; at tempo that roll reads as hesitation.
      const perString = step.direction === 'U' ? 0.004 : 0.007;
      order.forEach((voice, i) => {
        // An upstroke on a guitar catches the top strings and little else.
        const reach = step.direction === 'U' && i >= 4 ? 0 : 1;
        if (!reach) return;
        const middle = 1 - Math.abs(i - (order.length - 1) / 2) / (order.length / 2 + 0.5);
        // The pick digs into the middle of the sweep and releases off the
        // last string with full weight.
        const weight = i === struck - 1 ? 1 : 0.8 + 0.26 * middle;
        events.push({
          at: at + i * perString * (0.9 + 0.2 * rand()),
          string: voice.string,
          midi: voice.midi,
          amp: amp * weight * (0.94 + 0.12 * rand()) * (step.mute ? 0.7 : 1),
          mute: step.mute ?? false,
          nail: false,
          tick: i === 0 && !step.mute ? amp * 0.9 : 0,
        });
      });
    }
  }
  events.sort((a, b) => a.at - b.at);
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const next = events.find((later, j) => j > i && later.string === ev.string);
    // The pick or fingertip lands on the string a moment before it releases
    // the new note: the old vibration is gone by the strike, so the new
    // attack opens on a clean edge instead of over the tail it replaces.
    const hold = next ? Math.max(0.05, next.at - ev.at - 0.016) : undefined;
    const base = ev.nail ? NAIL : ev.thumb ? THUMB : ACOUSTIC;
    const contact = { ...base, pluckPos: base.pluckPos! + (rand() - 0.5) * 0.05 };
    const at = Math.max(0, Math.floor(ev.at * sampleRate));
    if (ev.mute) addPluck(out, at, ev.midi, ev.amp, sampleRate, 0.18, rand, contact, hold);
    else addString(out, at, ev.midi, ev.amp, sampleRate, rand, contact, hold, ev.thumb ? THUMB_MIX : ev.nail ? NAIL_MIX : RING.fastMix);
    if (ev.tick) addTick(out, at, sampleRate, ev.tick, rand);
  }
  const shaped = room(body(out, sampleRate), sampleRate);
  fadeTail(shaped, sampleRate, 0.4);
  return normalizePeak(shaped, 0.88);
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
