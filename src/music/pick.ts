import type { ChordShape } from './shapes';

/**
 * Which finger plucks which string.
 *
 * None of this is heard from the recording — it is derived from the chord
 * shape, which is why it can be exact where the transcription can only be
 * likely. Classical practice fixes the treble: the index sits on the third
 * string, the middle on the second, the ring on the first. Only the thumb
 * moves, and where it goes depends on the chord: C is rooted on the fifth
 * string, G on the sixth, D on the fourth. Beginners reliably start every
 * chord from the sixth string because nothing tells them otherwise, and that
 * one habit is what a printed pattern of string numbers cannot fix — the
 * right string is different for every chord in the song.
 */
export type Finger = 'p' | 'i' | 'm' | 'a';

/**
 * A string a pattern step plucks. The trebles are literal; the two bass slots
 * are resolved against whichever chord is sounding.
 */
export type PluckString = 'bass' | 'altBass' | 3 | 2 | 1;

export interface Pluck {
  string: PluckString;
  finger: Finger;
}

/** Display numbering: string 6 is the low E, string 1 the high E. */
export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;

const toDisplay = (index: number): StringNumber => (6 - index) as StringNumber;

/**
 * The lowest string the shape actually sounds — the chord's bass note.
 *
 * `frets` runs low E first with -1 for a muted string, so the first entry that
 * is played is the bass. C gives the fifth string, G the sixth, D the fourth.
 */
export function bassStringOf(shape: ChordShape): StringNumber {
  const index = shape.frets.findIndex((fret) => fret >= 0);
  return toDisplay(index < 0 ? 0 : index);
}

/**
 * The bass the thumb alternates onto.
 *
 * The next sounding string above the root, but never past the fourth: below
 * that the thumb would be treading on the fingers' territory and the pattern
 * stops sounding like an alternating bass at all. A chord whose bass is
 * already the fourth string simply does not alternate.
 */
export function altBassStringOf(shape: ChordShape): StringNumber {
  const root = shape.frets.findIndex((fret) => fret >= 0);
  if (root < 0) return 6;
  for (let i = root + 1; i <= 2; i++) {
    if (shape.frets[i] >= 0) return toDisplay(i);
  }
  return toDisplay(root);
}

/** The string a step plucks, once the chord is known. */
export function pluckStringOf(pluck: Pluck, shape: ChordShape): StringNumber {
  if (pluck.string === 'bass') return bassStringOf(shape);
  if (pluck.string === 'altBass') return altBassStringOf(shape);
  return pluck.string;
}
