import { FFT, hannWindow } from './fft';

/** Average all channels down to a single Float32Array. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0].slice();
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) out[i] += ch[i];
  }
  const inv = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/**
 * Band-limited resampling with a Hann-windowed sinc kernel.
 *
 * The cutoff tracks the lower of the two rates, so downsampling removes content
 * that would otherwise fold back into the chroma bands as phantom notes.
 *
 * The kernel is built once per output *phase* rather than once per output
 * sample. Written the obvious way this function evaluates a sine and a cosine
 * for every tap of every output sample — for a three-minute take that is over
 * four hundred million transcendental calls, and most of the wait between
 * stopping the recording and seeing a tab. Audio rates are ratios of small
 * integers, so the read head only ever lands in `srOut / gcd` distinct
 * positions between samples however long the recording is: 147 of them for
 * 48k into 22.05k, not four million. The direct form below still runs for a
 * ratio that does not repeat.
 */
export function resample(input: Float32Array, srIn: number, srOut: number, zeros = 8): Float32Array {
  if (srIn === srOut || input.length === 0) return input.slice();
  const ratio = srOut / srIn;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const fc = 0.5 * 0.95 * Math.min(1, ratio); // cycles per input sample
  const support = zeros / (2 * fc); // kernel half-width, in input samples

  const phases = buildPhasedKernels(srIn, srOut, ratio, fc, support);
  return phases
    ? applyPhasedKernels(input, outLength, ratio, phases)
    : resampleDirect(input, outLength, ratio, fc, support);
}

function kernelWeight(x: number, fc: number, support: number): number {
  const t = 2 * fc * x;
  const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
  const win = 0.5 + 0.5 * Math.cos((Math.PI * x) / support);
  return sinc * win;
}

function resampleDirect(
  input: Float32Array,
  outLength: number,
  ratio: number,
  fc: number,
  support: number,
): Float32Array {
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const centre = i / ratio;
    const start = Math.max(0, Math.ceil(centre - support));
    const end = Math.min(input.length - 1, Math.floor(centre + support));
    let sum = 0;
    let norm = 0;
    for (let j = start; j <= end; j++) {
      const w = kernelWeight(j - centre, fc, support);
      sum += input[j] * w;
      norm += w;
    }
    out[i] = norm !== 0 ? sum / norm : 0;
  }
  return out;
}

interface PhasedKernels {
  period: number;
  /** Where phase `p`'s kernel starts, relative to `floor(centre)`. */
  offsets: Int32Array;
  taps: Int32Array;
  starts: Int32Array;
  weights: Float64Array;
  norms: Float64Array;
}

/** More phases than this and rebuilding kernels costs more than it saves. */
const MAX_RESAMPLE_PERIOD = 8192;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return Math.max(1, x);
}

function buildPhasedKernels(
  srIn: number,
  srOut: number,
  ratio: number,
  fc: number,
  support: number,
): PhasedKernels | null {
  // Only exact integer rates repeat exactly; anything else would drift out of
  // step with the cached kernels over a long recording.
  if (
    !Number.isInteger(srIn) ||
    !Number.isInteger(srOut) ||
    srIn <= 0 ||
    srOut <= 0 ||
    srIn > 4_000_000 ||
    srOut > 4_000_000
  ) {
    return null;
  }
  const period = srOut / gcd(srIn, srOut);
  if (!Number.isInteger(period) || period < 1 || period > MAX_RESAMPLE_PERIOD) return null;

  const offsets = new Int32Array(period);
  const taps = new Int32Array(period);
  const starts = new Int32Array(period);
  const norms = new Float64Array(period);
  const chunks: number[] = [];

  for (let p = 0; p < period; p++) {
    const centre = p / ratio;
    const base = Math.floor(centre);
    const lo = Math.ceil(centre - support);
    const hi = Math.floor(centre + support);
    const count = Math.max(0, hi - lo + 1);
    offsets[p] = lo - base;
    taps[p] = count;
    starts[p] = chunks.length;
    let norm = 0;
    for (let j = lo; j <= hi; j++) {
      const w = kernelWeight(j - centre, fc, support);
      chunks.push(w);
      norm += w;
    }
    norms[p] = norm;
  }
  return { period, offsets, taps, starts, weights: Float64Array.from(chunks), norms };
}

function applyPhasedKernels(
  input: Float32Array,
  outLength: number,
  ratio: number,
  k: PhasedKernels,
): Float32Array {
  const out = new Float32Array(outLength);
  const n = input.length;
  let phase = 0;
  for (let i = 0; i < outLength; i++) {
    const count = k.taps[phase];
    if (count > 0) {
      const from = Math.floor(i / ratio) + k.offsets[phase];
      const at = k.starts[phase];
      if (from >= 0 && from + count <= n) {
        let sum = 0;
        for (let j = 0; j < count; j++) sum += input[from + j] * k.weights[at + j];
        out[i] = sum / k.norms[phase];
      } else {
        // Clipped by an edge of the signal: renormalise over the taps that
        // survive, exactly as the direct form does.
        let sum = 0;
        let norm = 0;
        for (let j = 0; j < count; j++) {
          const idx = from + j;
          if (idx < 0 || idx >= n) continue;
          sum += input[idx] * k.weights[at + j];
          norm += k.weights[at + j];
        }
        out[i] = norm !== 0 ? sum / norm : 0;
      }
    }
    phase += 1;
    if (phase === k.period) phase = 0;
  }
  return out;
}

/** The direct form, exported so a test can hold the fast path to it. */
export function resampleReference(
  input: Float32Array,
  srIn: number,
  srOut: number,
  zeros = 8,
): Float32Array {
  if (srIn === srOut || input.length === 0) return input.slice();
  const ratio = srOut / srIn;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const fc = 0.5 * 0.95 * Math.min(1, ratio);
  return resampleDirect(input, outLength, ratio, fc, zeros / (2 * fc));
}

export interface StftOptions {
  fftSize: number;
  hopSize: number;
}

export interface Stft {
  /** Magnitudes laid out frame-major: frame f occupies [f*bins, (f+1)*bins). */
  data: Float32Array;
  frames: number;
  bins: number;
  fftSize: number;
  hopSize: number;
  sampleRate: number;
}

/**
 * Magnitude STFT with frame `f` centred on sample `f * hopSize` and the signal
 * zero-padded at both ends, so frame indices convert to timestamps by a plain
 * multiply with no window-length offset.
 */
export function stft(signal: Float32Array, sampleRate: number, opts: StftOptions): Stft {
  const { fftSize, hopSize } = opts;
  const bins = fftSize / 2 + 1;
  const frames = Math.max(1, Math.floor(signal.length / hopSize) + 1);
  const fft = new FFT(fftSize);
  const win = hannWindow(fftSize);
  const frame = new Float64Array(fftSize);
  const mags = new Float64Array(bins);
  const data = new Float32Array(frames * bins);
  const half = fftSize >> 1;

  for (let f = 0; f < frames; f++) {
    const start = f * hopSize - half;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      frame[i] = idx >= 0 && idx < signal.length ? signal[idx] * win[i] : 0;
    }
    fft.magnitudes(frame, mags);
    const base = f * bins;
    for (let k = 0; k < bins; k++) data[base + k] = mags[k];
  }
  return { data, frames, bins, fftSize, hopSize, sampleRate };
}

/** Seconds at the centre of frame `f`. */
export function frameTime(f: number, hopSize: number, sampleRate: number): number {
  return (f * hopSize) / sampleRate;
}

export function meanOf(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return s / values.length;
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Peak absolute value scaled to `peak`; silent input is returned untouched. */
export function normalizePeak(signal: Float32Array, peak = 0.99): Float32Array {
  let max = 0;
  for (let i = 0; i < signal.length; i++) {
    const a = Math.abs(signal[i]);
    if (a > max) max = a;
  }
  if (max < 1e-6) return signal;
  const g = peak / max;
  for (let i = 0; i < signal.length; i++) signal[i] *= g;
  return signal;
}
