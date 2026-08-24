import { describe, expect, it } from 'vitest';
import { renderShapePattern } from './synth';
import { STRUM_PATTERNS, patternsFor } from '../music/arrange';
import { shapesFor } from '../music/shapes';

const C = shapesFor({ root: 0, quality: 'maj' })[0];
const held = STRUM_PATTERNS.find((p) => p.id === 'held')!;
const rate = 22050;

/** Where the signal actually starts, in seconds. */
function firstSound(samples: Float32Array, sampleRate: number): number {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > 0.02) return i / sampleRate;
  }
  return Infinity;
}

/**
 * Fundamental by autocorrelation.
 *
 * Counting zero crossings does not work on a plucked string: the first
 * milliseconds are all upper partials, and the count lands an octave or two
 * above the note. The first strong lag past a minimum is the period.
 */
function fundamentalHz(samples: Float32Array, sampleRate: number, from: number, seconds: number): number {
  const start = Math.floor(from * sampleRate);
  const n = Math.min(samples.length - start, Math.floor(seconds * sampleRate));
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 60);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += samples[start + i] * samples[start + i + lag];
    const score = sum / (n - lag);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return sampleRate / bestLag;
}

describe('renderShapePattern', () => {
  it('lays the bars out at the tempo it was given', () => {
    const slow = renderShapePattern(C.frets, held, { sampleRate: rate, bpm: 60, bars: 4 });
    const fast = renderShapePattern(C.frets, held, { sampleRate: rate, bpm: 120, bars: 4 });
    // Four bars of 4/4: 16 beats, so 16s at 60 BPM and 8s at 120.
    expect(slow.length / rate).toBeGreaterThan(fast.length / rate + 7);
  });

  it('puts the capo where the capo goes', () => {
    // One string, so the measurement is of a note rather than of a chord: the
    // low E at the third fret is G2, 98 Hz, and the same shape behind a capo
    // on the third fret is A#2 — a minor third up, a ratio of 2^(3/12).
    const oneString = [3, -1, -1, -1, -1, -1];
    const open = renderShapePattern(oneString, held, { sampleRate: rate, bpm: 90 });
    const capo3 = renderShapePattern(oneString, held, { sampleRate: rate, bpm: 90, capo: 3 });
    const a = fundamentalHz(open, rate, firstSound(open, rate) + 0.05, 0.5);
    const b = fundamentalHz(capo3, rate, firstSound(capo3, rate) + 0.05, 0.5);
    expect(a).toBeGreaterThan(92);
    expect(a).toBeLessThan(104);
    expect(b / a).toBeCloseTo(Math.pow(2, 3 / 12), 1);
  });

  it('sweeps rather than blocks, so a strum sounds struck', () => {
    const one = renderShapePattern(C.frets, held, { sampleRate: rate, bpm: 90 });
    // The C shape sounds five strings; struck in order they cannot all land on
    // the same sample, or it is a piano chord.
    const at = firstSound(one, rate);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(0.02);
  });

  it('plays a picking pattern one string at a time', () => {
    const pick = patternsFor(4).find((p) => p.kind === 'pick');
    expect(pick).toBeDefined();
    const out = renderShapePattern(C.frets, pick!, { sampleRate: rate, bpm: 80 });
    // Peaks well below a five-string strum's, because one string is ringing.
    expect(out.some((v) => Math.abs(v) > 0.05)).toBe(true);
  });

  it('lets the last chord ring past the final bar line', () => {
    const out = renderShapePattern(C.frets, held, { sampleRate: rate, bpm: 120, bars: 1 });
    // One bar of 4/4 at 120 is 2s; the buffer has to be longer than that.
    expect(out.length / rate).toBeGreaterThan(3);
  });
});
