import { FFT, hannWindow } from '../core/fft';

/** E1 to G7: from below a guitar's low E up past the top of its harmonics. */
export const SPECTRO_MIN_MIDI = 28;
export const SPECTRO_MAX_MIDI = 103;
export const SPECTRO_BINS = SPECTRO_MAX_MIDI - SPECTRO_MIN_MIDI + 1;

/**
 * Folds capture chunks into one spectrum column per chunk, one bin per
 * semitone.
 *
 * Semitone bins rather than linear frequency for the same reason the analysis
 * uses chroma: on a log-frequency axis a chord is a fixed visual shape that
 * moves up and down with pitch, so the backdrop the recording screen paints
 * with these columns reads as music rather than as a heat map. Bin values are
 * for display, not analysis — compressed to 0..1 against a reference that only
 * ever rises, so a whole take stays comparable to itself.
 */
export class SpectrogramBinner {
  readonly bins = SPECTRO_BINS;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly mags: Float64Array;
  private readonly starts: Int32Array;
  private readonly lengths: Int32Array;
  private readonly weights: Float32Array;
  private reference = 6;

  constructor(sampleRate: number, fftSize = 4096) {
    this.fft = new FFT(fftSize);
    this.window = hannWindow(fftSize);
    this.mags = new Float64Array(fftSize / 2 + 1);

    // The same Gaussian fold the chromagram uses, at the capture rate. Low
    // semitones sit closer together than the FFT can resolve and blur into
    // each other, which for a backdrop is a feature.
    const binWidth = sampleRate / fftSize;
    const starts = new Int32Array(this.bins);
    const lengths = new Int32Array(this.bins);
    const chunks: number[][] = [];
    const maxBin = fftSize / 2;
    for (let b = 0; b < this.bins; b++) {
      const freq = 440 * Math.pow(2, (SPECTRO_MIN_MIDI + b - 69) / 12);
      const semitoneHz = freq * (Math.pow(2, 1 / 12) - 1);
      const sigma = Math.max(0.32 * semitoneHz, 0.9 * binWidth);
      const lo = Math.max(1, Math.floor((freq - 3 * sigma) / binWidth));
      const hi = Math.min(maxBin, Math.ceil((freq + 3 * sigma) / binWidth));
      const w: number[] = [];
      let sum = 0;
      for (let k = lo; k <= hi; k++) {
        const d = (k * binWidth - freq) / sigma;
        const g = Math.exp(-0.5 * d * d);
        w.push(g);
        sum += g;
      }
      if (sum > 0) for (let i = 0; i < w.length; i++) w[i] /= sum;
      starts[b] = lo;
      lengths[b] = w.length;
      chunks.push(w);
    }
    this.starts = starts;
    this.lengths = lengths;
    this.weights = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      this.weights.set(c, offset);
      offset += c.length;
    }
  }

  /** Display values 0..1 for one capture chunk, freshly allocated. */
  column(chunk: Float32Array): Float32Array {
    const frame = new Float64Array(this.fft.size);
    const n = Math.min(chunk.length, frame.length);
    for (let i = 0; i < n; i++) frame[i] = chunk[i] * this.window[i];
    this.fft.magnitudes(frame, this.mags);

    const out = new Float32Array(this.bins);
    let offset = 0;
    let peak = 0;
    for (let b = 0; b < this.bins; b++) {
      const start = this.starts[b];
      const len = this.lengths[b];
      let acc = 0;
      for (let i = 0; i < len; i++) acc += this.mags[start + i] * this.weights[offset + i];
      offset += len;
      out[b] = acc;
      if (acc > peak) peak = acc;
    }
    if (peak > this.reference) this.reference = peak;
    const gamma = 25;
    const logMax = Math.log1p(gamma);
    for (let b = 0; b < this.bins; b++) {
      out[b] = Math.log1p((gamma * out[b]) / this.reference) / logMax;
    }
    return out;
  }
}
