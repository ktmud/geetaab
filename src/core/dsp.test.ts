import { describe, expect, it } from 'vitest';
import { medianOf, meanOf, normalizePeak, resample, resampleReference, toMono } from './dsp';

/** A signal with content across the band, so aliasing has somewhere to show. */
function sweep(length: number, sampleRate: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    out[i] =
      0.5 * Math.sin(2 * Math.PI * 220 * t) +
      0.3 * Math.sin(2 * Math.PI * 1750 * t + 0.7) +
      0.2 * Math.sin(2 * Math.PI * 4300 * t + 1.9);
  }
  return out;
}

function worstRelative(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let peak = 0;
  for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) / (peak || 1));
  return worst;
}

describe('resample', () => {
  // The fast path reuses one kernel per output phase instead of rebuilding it
  // per output sample. That is only sound if the two really do agree, on the
  // interior and at both clipped edges.
  it.each([
    [48000, 22050],
    [48000, 11025],
    [44100, 22050],
    [44100, 11025],
    [22050, 11025],
    [16000, 11025],
  ])('matches the direct form for %i to %i', (from, to) => {
    const input = sweep(from, from);
    const fast = resample(input, from, to);
    const slow = resampleReference(input, from, to);
    expect(fast.length).toBe(slow.length);
    expect(worstRelative(fast, slow)).toBeLessThan(1e-9);
  });

  it('falls back to the direct form for a ratio that does not repeat', () => {
    const input = sweep(20000, 44100);
    // 11111 shares no useful factor with 44100, so the phase table would be
    // larger than the cap and the direct path has to carry it.
    const fast = resample(input, 44100, 11111);
    const slow = resampleReference(input, 44100, 11111);
    expect(worstRelative(fast, slow)).toBe(0);
  });

  it('is much faster than the direct form', () => {
    const input = sweep(48000 * 4, 48000);
    const startFast = performance.now();
    resample(input, 48000, 22050);
    const fast = performance.now() - startFast;
    const startSlow = performance.now();
    resampleReference(input, 48000, 22050);
    const slow = performance.now() - startSlow;
    // Measured around 40x. Asserting a tenth of that leaves room for a loaded
    // machine while still failing if the phase cache ever stops being used.
    expect(slow / Math.max(fast, 0.001)).toBeGreaterThan(4);
  });

  it('returns a copy when the rates already match', () => {
    const input = sweep(64, 8000);
    const out = resample(input, 8000, 8000);
    expect(out).not.toBe(input);
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it('handles an empty signal', () => {
    expect(resample(new Float32Array(0), 48000, 22050).length).toBe(0);
  });

  it('removes content that would fold back', () => {
    // A 9 kHz tone cannot exist at 11.025 kHz; a resampler without a low-pass
    // would fold it down to 2 kHz and the chromagram would read a phantom note.
    const sampleRate = 44100;
    const input = new Float32Array(sampleRate);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 9000 * i) / sampleRate);
    }
    const out = resample(input, sampleRate, 11025);
    let energy = 0;
    for (let i = 1000; i < out.length - 1000; i++) energy += out[i] * out[i];
    expect(Math.sqrt(energy / (out.length - 2000))).toBeLessThan(0.02);
  });
});

describe('toMono', () => {
  it('averages channels', () => {
    const left = Float32Array.from([1, 0, -1]);
    const right = Float32Array.from([0, 1, 1]);
    expect(Array.from(toMono([left, right]))).toEqual([0.5, 0.5, 0]);
  });

  it('copies a single channel rather than aliasing it', () => {
    const only = Float32Array.from([0.25, -0.5]);
    const out = toMono([only]);
    expect(Array.from(out)).toEqual([0.25, -0.5]);
    out[0] = 9;
    expect(only[0]).toBe(0.25);
  });

  it('returns nothing for no channels', () => {
    expect(toMono([]).length).toBe(0);
  });
});

describe('normalizePeak', () => {
  it('scales the loudest sample to the target', () => {
    const signal = Float32Array.from([0.1, -0.4, 0.2]);
    normalizePeak(signal, 0.8);
    expect(Math.max(...Array.from(signal).map(Math.abs))).toBeCloseTo(0.8, 6);
  });

  it('leaves silence alone rather than amplifying its noise floor', () => {
    const signal = Float32Array.from([0, 1e-9, -1e-9]);
    const before = signal[1];
    normalizePeak(signal, 0.9);
    expect(signal[1]).toBe(before);
  });
});

describe('statistics', () => {
  it('means and medians, including the empty case', () => {
    expect(meanOf([])).toBe(0);
    expect(meanOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([])).toBe(0);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });
});
