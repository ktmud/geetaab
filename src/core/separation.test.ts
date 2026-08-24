import { describe, expect, it } from 'vitest';
import { separateRepet, SeparationRefusal } from './separation';

const RATE = 11025;

/** A note at a fixed pitch, for `seconds`, starting at `at`. */
function tone(into: Float32Array, hz: number, at: number, seconds: number, amp: number): void {
  const from = Math.floor(at * RATE);
  const to = Math.min(into.length, from + Math.floor(seconds * RATE));
  for (let i = from; i < to; i++) {
    // A soft attack and release, so the edges are not clicks the FFT has to
    // spread across every bin.
    const t = (i - from) / RATE;
    const env = Math.min(1, t * 20, ((to - i) / RATE) * 20);
    into[i] += amp * env * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
}

/** Energy of a signal, for comparing what ended up where. */
function power(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return sum / Math.max(1, to - from);
}

/**
 * Two seconds of accompaniment, repeated four times, with a single sung note
 * over the third repeat only. The band is what recurs; the note is not.
 */
function mixture(seconds = 8, period = 2): { mix: Float32Array; voiceFrom: number; voiceTo: number } {
  const mix = new Float32Array(seconds * RATE);
  for (let r = 0; r * period < seconds; r++) {
    const at = r * period;
    tone(mix, 196, at, 0.9, 0.30); // G3
    tone(mix, 293.66, at + 1.0, 0.9, 0.30); // D4
  }
  const voiceFrom = Math.floor(4.2 * RATE);
  const voiceTo = Math.floor(5.0 * RATE);
  tone(mix, 523.25, 4.2, 0.8, 0.32); // C5, sung once
  return { mix, voiceFrom, voiceTo };
}

describe('separateRepet', () => {
  it('sends what repeats to the band and what does not to the voice', () => {
    const { mix, voiceFrom, voiceTo } = mixture();
    const split = separateRepet(mix, RATE, { fftSize: 1024, hopSize: 256, periodHint: 2 });

    // Over the sung stretch, the voice channel should carry real energy...
    const voiceThere = power(split.vocals, voiceFrom, voiceTo);
    // ...and over a stretch with only the band in it, very little.
    const quietFrom = Math.floor(0.2 * RATE);
    const quietTo = Math.floor(0.9 * RATE);
    const voiceElsewhere = power(split.vocals, quietFrom, quietTo);
    expect(voiceThere).toBeGreaterThan(voiceElsewhere * 4);

    // And the band keeps the accompaniment where the voice is not.
    expect(power(split.accompaniment, quietFrom, quietTo)).toBeGreaterThan(voiceElsewhere * 4);
  });

  it('adds back up to what it was given', () => {
    const { mix } = mixture();
    const split = separateRepet(mix, RATE, { fftSize: 1024, hopSize: 256, periodHint: 2 });
    let worst = 0;
    // Away from the very edges, where fewer windows overlap.
    for (let i = RATE; i < mix.length - RATE; i++) {
      worst = Math.max(worst, Math.abs(split.vocals[i] + split.accompaniment[i] - mix[i]));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('finds the period on its own when it is not told one', () => {
    const { mix } = mixture(12, 2);
    const split = separateRepet(mix, RATE, { fftSize: 1024, hopSize: 256 });
    // A whole multiple of the true two seconds, which is the answer this is
    // built to give: identical content still lines up when folded at twice the
    // loop, and among lags that repeat about as well it deliberately takes the
    // longest. Folding SHORTER than the truth is the error that matters —
    // that one puts two different chords into the same median.
    const multiple = split.periodSeconds / 2;
    expect(Math.abs(multiple - Math.round(multiple))).toBeLessThan(0.06);
    expect(split.periodSeconds).toBeGreaterThan(1.7);
    expect(split.repetitions).toBeGreaterThanOrEqual(3);
  });

  it('refuses rather than guessing when there is too little to work with', () => {
    // Shorter than one analysis window: there is not a single frame to fold.
    const short = new Float32Array(512);
    expect(() => separateRepet(short, RATE, { fftSize: 1024, hopSize: 256 })).toThrow(SeparationRefusal);
    try {
      separateRepet(short, RATE, { fftSize: 1024, hopSize: 256 });
    } catch (error) {
      expect((error as SeparationRefusal).kind).toBe('tooShort');
    }
  });

  it('refuses when nothing in the recording repeats at all', () => {
    // Noise: long enough to analyse, with no period in it to find.
    const noise = new Float32Array(8 * RATE);
    let seed = 7;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    // It may find a lag or refuse; what it must not do is claim a period it
    // cannot support with enough repeats.
    try {
      const split = separateRepet(noise, RATE, { fftSize: 1024, hopSize: 256 });
      expect(split.repetitions).toBeGreaterThanOrEqual(3);
    } catch (error) {
      expect(error).toBeInstanceOf(SeparationRefusal);
    }
  });

  it('refuses a period the take cannot hold enough times over', () => {
    const { mix } = mixture(8, 2);
    // A six-second loop in an eight-second take: two repeats, not three.
    try {
      separateRepet(mix, RATE, { fftSize: 1024, hopSize: 256, periodHint: 6 });
      throw new Error('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(SeparationRefusal);
      expect((error as SeparationRefusal).kind).toBe('notEnoughRepetitions');
      expect((error as SeparationRefusal).needed).toBe(3);
    }
  });

  it('keeps the bass with the band whatever the model says', () => {
    // A low note that appears only once still belongs to the accompaniment:
    // a voice has almost nothing under 100 Hz and a bass guitar has.
    const mix = new Float32Array(8 * RATE);
    for (let r = 0; r < 4; r++) tone(mix, 220, r * 2, 0.9, 0.3);
    tone(mix, 70, 4.2, 0.8, 0.35);
    const split = separateRepet(mix, RATE, { fftSize: 1024, hopSize: 256, periodHint: 2 });
    const from = Math.floor(4.3 * RATE);
    const to = Math.floor(4.9 * RATE);
    expect(power(split.accompaniment, from, to)).toBeGreaterThan(power(split.vocals, from, to));
  });
});
