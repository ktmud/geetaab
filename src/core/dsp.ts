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
 */
export function resample(input: Float32Array, srIn: number, srOut: number, zeros = 8): Float32Array {
  if (srIn === srOut || input.length === 0) return input.slice();
  const ratio = srOut / srIn;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLength);
  const fc = 0.5 * 0.95 * Math.min(1, ratio); // cycles per input sample
  const support = zeros / (2 * fc); // kernel half-width, in input samples

  for (let i = 0; i < outLength; i++) {
    const centre = i / ratio;
    const start = Math.max(0, Math.ceil(centre - support));
    const end = Math.min(input.length - 1, Math.floor(centre + support));
    let sum = 0;
    let norm = 0;
    for (let j = start; j <= end; j++) {
      const x = j - centre;
      const t = 2 * fc * x;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * x) / support);
      const w = sinc * win;
      sum += input[j] * w;
      norm += w;
    }
    out[i] = norm !== 0 ? sum / norm : 0;
  }
  return out;
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
