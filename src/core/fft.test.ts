import { describe, expect, it } from 'vitest';
import { FFT } from './fft';
import { resample } from './dsp';

function naiveDft(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const outRe = new Array(n).fill(0);
  const outIm = new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      outRe[k] += re[t] * Math.cos(angle) - im[t] * Math.sin(angle);
      outIm[k] += re[t] * Math.sin(angle) + im[t] * Math.cos(angle);
    }
  }
  return { re: outRe, im: outIm };
}

describe('FFT', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const re: number[] = [];
    const im: number[] = [];
    for (let i = 0; i < n; i++) {
      re.push(Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
      im.push(0);
    }
    const expected = naiveDft(re, im);
    const fre = Float64Array.from(re);
    const fim = Float64Array.from(im);
    new FFT(n).transform(fre, fim);
    for (let k = 0; k < n; k++) {
      expect(fre[k]).toBeCloseTo(expected.re[k], 6);
      expect(fim[k]).toBeCloseTo(expected.im[k], 6);
    }
  });

  it('puts a pure tone in the expected bin', () => {
    const n = 1024;
    const sampleRate = 8000;
    const freq = (sampleRate / n) * 100;
    const frame = new Float64Array(n);
    for (let i = 0; i < n; i++) frame[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
    const mags = new Float64Array(n / 2 + 1);
    new FFT(n).magnitudes(frame, mags);
    let peak = 0;
    for (let k = 1; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
    expect(peak).toBe(100);
  });

  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(100)).toThrow();
  });
});

describe('resample', () => {
  it('preserves tone frequency when downsampling 44100 to 11025', () => {
    const srIn = 44100;
    const srOut = 11025;
    const freq = 440;
    const input = new Float32Array(srIn);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * freq * i) / srIn);
    const out = resample(input, srIn, srOut);
    expect(out.length).toBeCloseTo(srOut, -2);

    const n = 8192;
    const frame = new Float64Array(n);
    for (let i = 0; i < n; i++) frame[i] = out[i + 1000] ?? 0;
    const mags = new Float64Array(n / 2 + 1);
    new FFT(n).magnitudes(frame, mags);
    let peak = 1;
    for (let k = 2; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
    const peakFreq = (peak * srOut) / n;
    expect(peakFreq).toBeGreaterThan(430);
    expect(peakFreq).toBeLessThan(450);
  });

  it('attenuates content above the new Nyquist instead of folding it', () => {
    const srIn = 44100;
    const srOut = 11025;
    const freq = 8000; // would alias to 2725 Hz without a lowpass
    const input = new Float32Array(srIn);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * freq * i) / srIn);
    const out = resample(input, srIn, srOut);
    let rms = 0;
    for (let i = 2000; i < out.length - 2000; i++) rms += out[i] * out[i];
    rms = Math.sqrt(rms / (out.length - 4000));
    expect(rms).toBeLessThan(0.05);
  });
});
