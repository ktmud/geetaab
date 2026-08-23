import { describe, expect, it } from 'vitest';
import { QUALITIES } from '../core/chordTypes';
import {
  easiestShape,
  essentialPitchClasses,
  requiredPitchClasses,
  shapeBassPitchClass,
  shapePitchClasses,
  shapesFor,
} from './shapes';

describe('chord shapes', () => {
  it('sounds exactly the notes of the chord it claims, for every shape', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of QUALITIES) {
        const chord = { root, quality };
        const allowed = requiredPitchClasses(chord);
        const essential = essentialPitchClasses(chord);
        for (const shape of shapesFor(chord)) {
          const sounded = shapePitchClasses(shape);
          const label = `${root}:${quality} frets ${shape.frets.join(',')}`;
          for (const pc of essential) {
            expect(sounded.has(pc), `${label} is missing pitch class ${pc}`).toBe(true);
          }
          for (const pc of sounded) {
            expect(allowed.includes(pc), `${label} sounds extra pitch class ${pc}`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps the root in the bass', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of QUALITIES) {
        for (const shape of shapesFor({ root, quality })) {
          expect(shapeBassPitchClass(shape)).toBe(root);
        }
      }
    }
  });

  it('never asks for more than four fretting fingers', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of QUALITIES) {
        for (const shape of shapesFor({ root, quality })) {
          expect(shape.frets.length).toBe(6);
          expect(shape.fingers.length).toBe(6);
          for (const f of shape.fingers) expect(f).toBeGreaterThanOrEqual(0);
          for (const f of shape.fingers) expect(f).toBeLessThanOrEqual(4);
          const span = shape.frets.filter((f) => f > 0);
          if (span.length > 1) expect(Math.max(...span) - Math.min(...span)).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('offers at least one playable shape for every chord in the vocabulary', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of QUALITIES) {
        expect(easiestShape({ root, quality }), `${root}:${quality}`).not.toBeNull();
      }
    }
  });
});
