/**
 * Iterative in-place radix-2 Cooley-Tukey FFT.
 *
 * Sizes must be powers of two. Tables are precomputed per instance, so reuse a
 * single FFT across every frame of a spectrogram rather than constructing one
 * per frame.
 */
export class FFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly rev: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.cosTable = new Float64Array(size / 2);
    this.sinTable = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /** Forward transform, in place. `re`/`im` must both be `size` long. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    const { rev, cosTable, sinTable } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const l = i + j;
          const r = l + half;
          const wr = cosTable[k];
          const wi = -sinTable[k];
          const tr = re[r] * wr - im[r] * wi;
          const ti = re[r] * wi + im[r] * wr;
          re[r] = re[l] - tr;
          im[r] = im[l] - ti;
          re[l] += tr;
          im[l] += ti;
        }
      }
    }
  }

  /**
   * Magnitude spectrum of a real frame, written into `out` (length size/2 + 1).
   * `frame` is copied, so the caller's buffer is left untouched.
   */
  magnitudes(frame: ArrayLike<number>, out: Float64Array): void {
    const n = this.size;
    const { re, im } = this;
    for (let i = 0; i < n; i++) {
      re[i] = i < frame.length ? frame[i] : 0;
      im[i] = 0;
    }
    this.transform(re, im);
    for (let k = 0; k <= n / 2; k++) {
      out[k] = Math.hypot(re[k], im[k]);
    }
  }
}

/** Periodic Hann window, the correct variant for STFT analysis. */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}
