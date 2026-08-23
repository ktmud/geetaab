import { describe, expect, it } from 'vitest';
import { altBassStringOf, bassStringOf, pluckStringOf } from './pick';
import { easiestShape } from './shapes';
import { patternsFor } from './arrange';
import type { ChordQuality } from '../core/chordTypes';

const shapeFor = (root: number, quality: ChordQuality) => {
  const shape = easiestShape({ root, quality });
  if (!shape) throw new Error('no shape');
  return shape;
};

describe('which string the thumb takes', () => {
  // The whole point of deriving this rather than printing it: the bass string
  // is different for every chord, and a beginner reading a bare string-number
  // pattern starts all of them on the sixth.
  it.each([
    ['C', 0, 'maj' as ChordQuality, 5],
    ['A minor', 9, 'min' as ChordQuality, 5],
    ['G', 7, 'maj' as ChordQuality, 6],
    ['E minor', 4, 'min' as ChordQuality, 6],
    ['D', 2, 'maj' as ChordQuality, 4],
    ['D minor', 2, 'min' as ChordQuality, 4],
  ])('%s is rooted on string %s', (_name, root, quality, expected) => {
    expect(bassStringOf(shapeFor(root, quality))).toBe(expected);
  });

  it('alternates onto a higher string, never below the fourth', () => {
    for (const [root, quality] of [
      [0, 'maj'],
      [7, 'maj'],
      [9, 'min'],
      [4, 'min'],
      [2, 'maj'],
    ] as [number, ChordQuality][]) {
      const shape = shapeFor(root, quality);
      const bass = bassStringOf(shape);
      const alt = altBassStringOf(shape);
      expect(alt).toBeLessThanOrEqual(bass);
      expect(alt).toBeGreaterThanOrEqual(4);
    }
  });

  it('never sends a finger to a string the chord mutes', () => {
    for (const [root, quality] of [
      [0, 'maj'],
      [2, 'maj'],
      [2, 'min'],
      [9, 'min'],
    ] as [number, ChordQuality][]) {
      const shape = shapeFor(root, quality);
      for (const slot of ['bass', 'altBass'] as const) {
        const index = 6 - pluckStringOf({ string: slot, finger: 'p' }, shape);
        expect(shape.frets[index]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the fingerpicking patterns', () => {
  const picks = patternsFor(4).filter((p) => p.kind === 'pick');

  it('are offered alongside the strums', () => {
    expect(picks.length).toBeGreaterThan(0);
    // Strums first, so the default a song opens with is still a strum.
    expect(patternsFor(4)[0].kind ?? 'strum').toBe('strum');
  });

  it('give every step exactly one string and one finger', () => {
    for (const pattern of picks) {
      for (const step of pattern.steps) {
        expect(step.pluck).toBeDefined();
        expect(['p', 'i', 'm', 'a']).toContain(step.pluck!.finger);
      }
    }
  });

  it('keep each finger on its own string, as classical practice does', () => {
    const seat: Record<string, number> = { i: 3, m: 2, a: 1 };
    for (const pattern of picks) {
      for (const step of pattern.steps) {
        const { finger, string } = step.pluck!;
        if (finger === 'p') {
          expect(['bass', 'altBass']).toContain(string);
        } else {
          expect(string).toBe(seat[finger]);
        }
      }
    }
  });

  it('stay inside the bar', () => {
    for (const pattern of picks) {
      for (const step of pattern.steps) {
        expect(step.beat).toBeGreaterThanOrEqual(0);
        expect(step.beat).toBeLessThan(pattern.beatsPerBar);
      }
    }
  });
});
