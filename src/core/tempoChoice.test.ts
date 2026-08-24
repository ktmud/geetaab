import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analyze';
import { renderProgression } from '../audio/synth';

const RATE = 22050;

function song(bpm: number, seed = 11): Float32Array {
  const progression = [
    { root: 7, quality: 'maj' as const, beats: 4 },
    { root: 2, quality: 'maj' as const, beats: 4 },
    { root: 9, quality: 'min' as const, beats: 4 },
    { root: 0, quality: 'maj' as const, beats: 4 },
  ];
  return renderProgression([...progression, ...progression, ...progression], {
    sampleRate: RATE,
    bpm,
    seed,
  });
}

describe('tempoChoices', () => {
  const result = analyzeAudio(song(96), RATE);

  it('always contains the reading the analysis actually used, marked as picked', () => {
    if (result.tempoChoices.length === 0) return; // an unambiguous take offers nothing
    const picked = result.tempoChoices.filter((c) => c.picked);
    expect(picked).toHaveLength(1);
    expect(Math.abs(Math.log2(picked[0].bpm / result.tempo))).toBeLessThan(0.07);
  });

  it('is ordered slowest first, not best first', () => {
    const bpms = result.tempoChoices.map((c) => c.bpm);
    expect(bpms).toEqual([...bpms].sort((a, b) => a - b));
  });

  it('offers at most three, and never a list of one', () => {
    expect(result.tempoChoices.length).not.toBe(1);
    expect(result.tempoChoices.length).toBeLessThanOrEqual(3);
  });

  it('offers nothing for a piece with no pulse to have two readings of', () => {
    // Noise: the analysis calls this free time, and free time has no tempo to
    // be ambiguous about.
    const noise = new Float32Array(20 * RATE);
    let seed = 3;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.3;
    }
    const free = analyzeAudio(noise, RATE);
    if (free.freeTime) expect(free.tempoChoices).toEqual([]);
  });

  it('every offered reading is a defensible one, not a scatter of numbers', () => {
    // Each entry is either close to the winner on the evidence, or a halving or
    // doubling of the chosen one — never an unrelated tempo with a weak score.
    const picked = result.tempoChoices.find((c) => c.picked);
    if (!picked) return;
    for (const choice of result.tempoChoices) {
      if (choice.picked) continue;
      const ratio = Math.log2(choice.bpm / picked.bpm);
      const isRelative = [0.5, 2].some((r) => Math.abs(ratio - Math.log2(r)) < 0.06);
      expect(isRelative || choice.confidence >= 0.82).toBe(true);
    }
  });
});
