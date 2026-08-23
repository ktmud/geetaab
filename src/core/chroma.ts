import { stft, type Stft } from './dsp';

export const CHROMA_SAMPLE_RATE = 11025;
export const CHROMA_FFT_SIZE = 8192;
export const CHROMA_HOP_SIZE = 1024;

export interface ChromaOptions {
  fftSize?: number;
  hopSize?: number;
  minMidi?: number;
  maxMidi?: number;
  /** Log-compression strength; larger values lift quiet partials. */
  gamma?: number;
  /** Global tuning offset in semitones, from `estimateTuning`. */
  tuning?: number;
}

export interface Chromagram {
  /** 12 pitch classes per frame, frame-major, each frame L2-normalised. */
  treble: Float32Array;
  /** Same layout, restricted to the bass register for root detection. */
  bass: Float32Array;
  frames: number;
  frameRate: number;
  fftSize: number;
  hopSize: number;
  sampleRate: number;
  /** Broadband energy per frame, used to gate silence into "no chord". */
  energy: Float32Array;
  tuning: number;
}

function midiToFreq(midi: number, tuning: number): number {
  return 440 * Math.pow(2, (midi - 69 + tuning) / 12);
}

interface BandWeights {
  starts: Int32Array;
  lengths: Int32Array;
  weights: Float32Array;
}

/** Sparse map from FFT bins onto one bin per semitone, Gaussian in frequency. */
function buildBandWeights(
  sampleRate: number,
  fftSize: number,
  minMidi: number,
  maxMidi: number,
  tuning: number,
): BandWeights {
  const bins = fftSize / 2 + 1;
  const binWidth = sampleRate / fftSize;
  const count = maxMidi - minMidi + 1;
  const starts = new Int32Array(count);
  const lengths = new Int32Array(count);
  const chunks: number[][] = [];

  for (let i = 0; i < count; i++) {
    const fm = midiToFreq(minMidi + i, tuning);
    const semitoneHz = fm * (Math.pow(2, 1 / 12) - 1);
    // Narrow enough that a neighbouring semitone contributes under 1%, but never
    // narrower than the FFT can resolve or low notes would fall between bins.
    const sigma = Math.max(0.32 * semitoneHz, 0.9 * binWidth);
    const lo = Math.max(1, Math.floor((fm - 3 * sigma) / binWidth));
    const hi = Math.min(bins - 1, Math.ceil((fm + 3 * sigma) / binWidth));
    const w: number[] = [];
    let sum = 0;
    for (let k = lo; k <= hi; k++) {
      const d = (k * binWidth - fm) / sigma;
      const g = Math.exp(-0.5 * d * d);
      w.push(g);
      sum += g;
    }
    if (sum > 0) for (let j = 0; j < w.length; j++) w[j] /= sum;
    starts[i] = lo;
    lengths[i] = w.length;
    chunks.push(w);
  }
  const flat = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    flat.set(c, o);
    o += c.length;
  }
  return { starts, lengths, weights: flat };
}

/**
 * Global tuning offset in semitones, in [-0.5, 0.5).
 *
 * Recordings captured off a speaker, or songs mastered slightly sharp or flat,
 * routinely sit tens of cents away from A440; without this correction their
 * energy straddles two chroma bins and every chord reads as ambiguous.
 */
export function estimateTuning(spec: Stft): number {
  const { data, frames, bins, fftSize, sampleRate } = spec;
  const binWidth = sampleRate / fftSize;
  const histogram = new Float64Array(120);
  const loBin = Math.max(2, Math.floor(midiToFreq(40, 0) / binWidth));
  const hiBin = Math.min(bins - 2, Math.ceil(midiToFreq(96, 0) / binWidth));

  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    for (let k = loBin; k <= hiBin; k++) {
      const y = data[base + k];
      const left = data[base + k - 1];
      const right = data[base + k + 1];
      if (!(y > left && y >= right) || y <= 0) continue;
      const denom = left - 2 * y + right;
      const shift = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
      if (Math.abs(shift) > 0.5) continue;
      const freq = (k + shift) * binWidth;
      if (freq <= 0) continue;
      const midi = 69 + 12 * Math.log2(freq / 440);
      let dev = midi - Math.round(midi); // [-0.5, 0.5)
      if (dev >= 0.5) dev -= 1;
      const slot = Math.min(119, Math.max(0, Math.floor((dev + 0.5) * 120)));
      histogram[slot] += y;
    }
  }

  // Circular mean over the histogram: the deviation axis wraps at ±50 cents.
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < 120; i++) {
    const angle = ((i + 0.5) / 120) * 2 * Math.PI;
    sx += histogram[i] * Math.cos(angle);
    sy += histogram[i] * Math.sin(angle);
  }
  if (sx === 0 && sy === 0) return 0;
  let angle = Math.atan2(sy, sx);
  if (angle < 0) angle += 2 * Math.PI;
  return angle / (2 * Math.PI) - 0.5;
}

/**
 * Chromagram of a mono signal that is already at `CHROMA_SAMPLE_RATE`.
 *
 * Returns separate treble and bass chroma: the treble half decides chord
 * quality, the bass half disambiguates the root and inversions.
 */
export function computeChromagram(
  signal: Float32Array,
  sampleRate = CHROMA_SAMPLE_RATE,
  opts: ChromaOptions = {},
): Chromagram {
  const fftSize = opts.fftSize ?? CHROMA_FFT_SIZE;
  const hopSize = opts.hopSize ?? CHROMA_HOP_SIZE;
  const minMidi = opts.minMidi ?? 36; // C2
  const maxMidi = opts.maxMidi ?? 96; // C7
  const gamma = opts.gamma ?? 30;

  const spec = stft(signal, sampleRate, { fftSize, hopSize });
  const tuning = opts.tuning ?? estimateTuning(spec);
  const bands = buildBandWeights(sampleRate, fftSize, minMidi, maxMidi, tuning);
  const nBands = maxMidi - minMidi + 1;

  const frames = spec.frames;
  const treble = new Float32Array(frames * 12);
  const bass = new Float32Array(frames * 12);
  const energy = new Float32Array(frames);
  const bandEnergy = new Float64Array(nBands);

  // Registers overlap on purpose: bass notes above G3 still colour the root
  // estimate, and low guitar voicings still belong to the harmony.
  const trebleLo = 48; // C3
  const trebleHi = 90; // F#6
  const bassLo = minMidi;
  const bassHi = 55; // G3

  for (let f = 0; f < frames; f++) {
    const base = f * spec.bins;
    let offset = 0;
    let total = 0;
    let peak = 0;
    for (let b = 0; b < nBands; b++) {
      const start = bands.starts[b];
      const len = bands.lengths[b];
      let acc = 0;
      for (let j = 0; j < len; j++) acc += spec.data[base + start + j] * bands.weights[offset + j];
      offset += len;
      bandEnergy[b] = acc;
      total += acc;
      if (acc > peak) peak = acc;
    }
    energy[f] = total;

    // Compress against the frame's own peak. Measuring loudness relatively lets
    // quiet upper voices count without also lifting the leakage floor that
    // sits a fixed ratio below every strong partial.
    const inv = peak > 0 ? 1 / peak : 0;
    const logMax = Math.log1p(gamma);
    for (let b = 0; b < nBands; b++) {
      bandEnergy[b] = Math.log1p(gamma * bandEnergy[b] * inv) / logMax;
    }

    for (let b = 0; b < nBands; b++) {
      const midi = minMidi + b;
      const pc = ((midi % 12) + 12) % 12;
      const v = bandEnergy[b];
      if (midi >= trebleLo && midi <= trebleHi) treble[f * 12 + pc] += v;
      if (midi >= bassLo && midi <= bassHi) bass[f * 12 + pc] += v;
    }
    normalizeFrame(treble, f * 12);
    normalizeFrame(bass, f * 12);
  }

  return {
    treble,
    bass,
    frames,
    frameRate: sampleRate / hopSize,
    fftSize,
    hopSize,
    sampleRate,
    energy,
    tuning,
  };
}

function normalizeFrame(buf: Float32Array, base: number): void {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += buf[base + i] * buf[base + i];
  const n = Math.sqrt(sum);
  if (n < 1e-9) return;
  for (let i = 0; i < 12; i++) buf[base + i] /= n;
}

/** Mean chroma across frames, weighted by frame energy and L1-normalised. */
export function averageChroma(chroma: Float32Array, frames: number, weights?: Float32Array): number[] {
  const out = new Array(12).fill(0);
  let wsum = 0;
  for (let f = 0; f < frames; f++) {
    const w = weights ? weights[f] : 1;
    if (w <= 0) continue;
    for (let i = 0; i < 12; i++) out[i] += chroma[f * 12 + i] * w;
    wsum += w;
  }
  if (wsum > 0) {
    const total = out.reduce((a, b) => a + b, 0);
    if (total > 0) for (let i = 0; i < 12; i++) out[i] /= total;
  }
  return out;
}
