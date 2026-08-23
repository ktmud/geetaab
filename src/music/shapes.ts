import { QUALITY_INTERVALS, type ChordQuality, type ChordSymbol } from '../core/chordTypes';

/** Open-string MIDI notes, low E to high E. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

export interface Barre {
  fret: number;
  /** String indices, low E = 0. */
  from: number;
  to: number;
}

/**
 * The hint shown under a diagram, as data rather than a sentence.
 *
 * The interface reads in two languages, so the shape table names the fact and
 * the dictionary writes it out.
 */
export type ShapeNote =
  | { kind: 'fourStringF' }
  | { kind: 'barre'; family: string; fret: number };

export interface ChordShape {
  root: number;
  quality: ChordQuality;
  /** Fret per string, low E first. -1 is a muted string, 0 is open. */
  frets: number[];
  /** Fretting finger per string: 0 for open or muted, 1-4 otherwise. */
  fingers: number[];
  barre?: Barre;
  /** 1 = first week, 2 = a few weeks in, 3 = needs a full barre. */
  difficulty: 1 | 2 | 3;
  /** Hint shown under the diagram, worded by the dictionary. */
  note?: ShapeNote;
}

interface OpenShapeSpec {
  root: number;
  quality: ChordQuality;
  frets: number[];
  fingers: number[];
  difficulty: 1 | 2 | 3;
  barre?: Barre;
  note?: ShapeNote;
}

// Pitch classes: C0 D2 E4 F5 G7 A9 B11.
const OPEN_SHAPE_SPECS: OpenShapeSpec[] = [
  { root: 0, quality: 'maj', frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], difficulty: 1 },
  { root: 0, quality: 'maj7', frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0], difficulty: 1 },
  { root: 0, quality: 'dom7', frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], difficulty: 2 },
  { root: 2, quality: 'maj', frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], difficulty: 1 },
  { root: 2, quality: 'min', frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], difficulty: 1 },
  { root: 2, quality: 'dom7', frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], difficulty: 1 },
  {
    root: 2,
    quality: 'min7',
    frets: [-1, -1, 0, 2, 1, 1],
    fingers: [0, 0, 0, 2, 1, 1],
    difficulty: 2,
    barre: { fret: 1, from: 4, to: 5 },
  },
  {
    root: 2,
    quality: 'maj7',
    frets: [-1, -1, 0, 2, 2, 2],
    fingers: [0, 0, 0, 1, 1, 1],
    difficulty: 2,
    barre: { fret: 2, from: 3, to: 5 },
  },
  { root: 2, quality: 'sus2', frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0], difficulty: 1 },
  { root: 2, quality: 'sus4', frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3], difficulty: 1 },
  { root: 4, quality: 'maj', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], difficulty: 1 },
  { root: 4, quality: 'min', frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], difficulty: 1 },
  { root: 4, quality: 'dom7', frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], difficulty: 1 },
  { root: 4, quality: 'min7', frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0], difficulty: 1 },
  { root: 4, quality: 'maj7', frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0], difficulty: 2 },
  { root: 4, quality: 'sus4', frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0], difficulty: 1 },
  {
    root: 5,
    quality: 'maj7',
    frets: [-1, -1, 3, 2, 1, 0],
    fingers: [0, 0, 3, 2, 1, 0],
    difficulty: 1,
    note: { kind: 'fourStringF' },
  },
  { root: 7, quality: 'maj', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], difficulty: 1 },
  { root: 7, quality: 'dom7', frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], difficulty: 1 },
  { root: 7, quality: 'maj7', frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1], difficulty: 2 },
  { root: 9, quality: 'maj', frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 1 },
  { root: 9, quality: 'min', frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], difficulty: 1 },
  { root: 9, quality: 'dom7', frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], difficulty: 1 },
  { root: 9, quality: 'min7', frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], difficulty: 1 },
  { root: 9, quality: 'maj7', frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0], difficulty: 2 },
  { root: 9, quality: 'sus2', frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0], difficulty: 1 },
  { root: 9, quality: 'sus4', frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 1 },
  { root: 11, quality: 'dom7', frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], difficulty: 2 },
  { root: 11, quality: 'min7', frets: [-1, 2, 0, 2, 0, 2], fingers: [0, 2, 0, 3, 0, 4], difficulty: 2 },
];

interface MovableSpec {
  quality: ChordQuality;
  /** Fret offsets from the barre, -1 for a muted string. */
  offsets: number[];
  fingers: number[];
  /** Root pitch class when the barre sits at fret 0. */
  openRoot: number;
  barreTo: number;
  family: 'E' | 'A';
}

const MOVABLE_SPECS: MovableSpec[] = [
  { quality: 'maj', offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1], openRoot: 4, barreTo: 5, family: 'E' },
  { quality: 'min', offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1], openRoot: 4, barreTo: 5, family: 'E' },
  { quality: 'dom7', offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1], openRoot: 4, barreTo: 5, family: 'E' },
  { quality: 'min7', offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1], openRoot: 4, barreTo: 5, family: 'E' },
  { quality: 'maj7', offsets: [0, 2, 1, 1, 0, 0], fingers: [1, 4, 2, 3, 1, 1], openRoot: 4, barreTo: 5, family: 'E' },
  { quality: 'sus4', offsets: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1], openRoot: 4, barreTo: 5, family: 'E' },
  { quality: 'maj', offsets: [-1, 0, 2, 2, 2, 0], fingers: [0, 1, 3, 3, 3, 1], openRoot: 9, barreTo: 5, family: 'A' },
  { quality: 'min', offsets: [-1, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1], openRoot: 9, barreTo: 5, family: 'A' },
  { quality: 'dom7', offsets: [-1, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1], openRoot: 9, barreTo: 5, family: 'A' },
  { quality: 'min7', offsets: [-1, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1], openRoot: 9, barreTo: 5, family: 'A' },
  { quality: 'maj7', offsets: [-1, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1], openRoot: 9, barreTo: 5, family: 'A' },
  { quality: 'sus4', offsets: [-1, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1], openRoot: 9, barreTo: 5, family: 'A' },
  { quality: 'sus2', offsets: [-1, 0, 2, 2, 0, 0], fingers: [0, 1, 3, 4, 1, 1], openRoot: 9, barreTo: 5, family: 'A' },
];

const OPEN_SHAPES: ChordShape[] = OPEN_SHAPE_SPECS.map((spec) => ({ ...spec }));

/** MIDI notes a shape actually sounds, low string first, muted strings dropped. */
export function shapeNotes(shape: ChordShape): number[] {
  const notes: number[] = [];
  shape.frets.forEach((fret, string) => {
    if (fret >= 0) notes.push(STANDARD_TUNING[string] + fret);
  });
  return notes;
}

export function shapePitchClasses(shape: ChordShape): Set<number> {
  return new Set(shapeNotes(shape).map((n) => n % 12));
}

/** Lowest sounding note, which decides whether the voicing is in root position. */
export function shapeBassPitchClass(shape: ChordShape): number | null {
  const notes = shapeNotes(shape);
  return notes.length > 0 ? notes[0] % 12 : null;
}

function movableShape(spec: MovableSpec, root: number, maxFret: number): ChordShape | null {
  const fret = ((root - spec.openRoot) % 12 + 12) % 12;
  if (fret === 0 || fret > maxFret) return null;
  const frets = spec.offsets.map((o) => (o < 0 ? -1 : o + fret));
  const from = spec.family === 'E' ? 0 : 1;
  return {
    root,
    quality: spec.quality,
    frets,
    fingers: spec.fingers.slice(),
    barre: { fret, from, to: spec.barreTo },
    difficulty: 3,
    note: { kind: 'barre', family: spec.family, fret },
  };
}

/**
 * Every playable shape for a chord, easiest first.
 *
 * Open shapes come from a hand-checked table; anything else falls back to the
 * movable E- and A-shape barres so the app can always print something, even
 * for a key a beginner would rather avoid.
 */
export function shapesFor(chord: ChordSymbol, maxFret = 9): ChordShape[] {
  if (chord.root < 0) return [];
  const out = OPEN_SHAPES.filter((s) => s.root === chord.root && s.quality === chord.quality).map((s) => ({ ...s }));
  const collectMovable = (limit: number): void => {
    for (const spec of MOVABLE_SPECS) {
      if (spec.quality !== chord.quality) continue;
      const shape = movableShape(spec, chord.root, limit);
      if (shape) out.push(shape);
    }
  };
  collectMovable(maxFret);
  // A few roots put their only movable shape past the usual limit; a high barre
  // still beats printing no diagram at all.
  if (out.length === 0) collectMovable(11);
  return out.sort((a, b) => a.difficulty - b.difficulty || highestFret(a) - highestFret(b));
}

export function easiestShape(chord: ChordSymbol, maxFret = 9): ChordShape | null {
  return shapesFor(chord, maxFret)[0] ?? null;
}

/** True when the chord has an open, barre-free voicing. */
export function isOpenChord(chord: ChordSymbol): boolean {
  return OPEN_SHAPES.some((s) => s.root === chord.root && s.quality === chord.quality && s.difficulty === 1);
}

export function highestFret(shape: ChordShape): number {
  return Math.max(0, ...shape.frets.filter((f) => f > 0));
}

export function lowestFret(shape: ChordShape): number {
  const fretted = shape.frets.filter((f) => f > 0);
  return fretted.length ? Math.min(...fretted) : 0;
}

/** Chords with a first-week open shape, for the capo search to aim at. */
export const EASY_CHORDS: ChordSymbol[] = OPEN_SHAPE_SPECS.filter((s) => s.difficulty === 1).map((s) => ({
  root: s.root,
  quality: s.quality,
}));

/** Pitch classes a shape may sound and still be called this chord. */
export function requiredPitchClasses(chord: ChordSymbol): number[] {
  return QUALITY_INTERVALS[chord.quality].map((iv) => (chord.root + iv) % 12);
}

/**
 * Pitch classes a shape must sound.
 *
 * The perfect fifth is the one chord tone guitarists routinely drop, because it
 * adds no colour and frees a finger; the standard C7 voicing omits it.
 */
export function essentialPitchClasses(chord: ChordSymbol): number[] {
  return QUALITY_INTERVALS[chord.quality]
    .filter((iv) => iv !== 7)
    .map((iv) => (chord.root + iv) % 12);
}
