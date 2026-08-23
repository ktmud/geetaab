import type { ChordSegment } from '../core/chords';
import {
  chordName,
  isNoChord,
  noteName,
  transposeChord,
  type ChordQuality,
  type ChordSymbol,
} from '../core/chordTypes';
import { keyUsesFlats, type KeyEstimate } from '../core/key';
import { easiestShape, type ChordShape } from './shapes';

export interface CapoChoice {
  fret: number;
  /** Fraction of playing time spent on first-week open shapes, 0..1. */
  openRatio: number;
  score: number;
  /** Key the player reads from, with the capo on. */
  shapeKeyName: string;
}

function easeOf(shape: ChordShape | null): number {
  if (!shape) return 0;
  if (shape.difficulty === 1) return 1;
  if (shape.difficulty === 2) return 0.55;
  return 0.1;
}

export interface CapoOptions {
  maxFret?: number;
  /** Score the shapes that will actually be played, substitutions included. */
  simplify?: boolean;
}

/**
 * Choose a capo position.
 *
 * A capo does not make a song easier by itself; it makes it easier when the
 * shapes it moves the player onto are open ones. So the search scores each fret
 * by how much of the song's *playing time* lands on first-week shapes, then
 * prefers the lowest fret among near-equal options.
 *
 * The shapes it scores are the ones the tab will really print, substitutions
 * and all. Scoring literal shapes instead undervalues any key whose awkward
 * chord has an easy stand-in, which is how a song in Eb ends up recommending
 * the capo that leaves a Bm in it rather than the one that turns the whole song
 * into C, G, Am and Fmaj7.
 */
export function chooseCapo(
  segments: ChordSegment[],
  key: KeyEstimate,
  opts: CapoOptions = {},
): CapoChoice {
  const maxFret = opts.maxFret ?? 7;
  const simplify = opts.simplify ?? true;
  const weights = new Map<string, { chord: ChordSymbol; duration: number }>();
  let total = 0;
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const duration = Math.max(0, seg.end - seg.start);
    if (duration <= 0) continue;
    const id = `${seg.chord.root}:${seg.chord.quality}`;
    const entry = weights.get(id) ?? { chord: seg.chord, duration: 0 };
    entry.duration += duration;
    weights.set(id, entry);
    total += duration;
  }
  if (total === 0) {
    return { fret: 0, openRatio: 0, score: 0, shapeKeyName: key.name };
  }

  let best: CapoChoice | null = null;
  for (let fret = 0; fret <= maxFret; fret++) {
    let ease = 0;
    let open = 0;
    for (const { chord, duration } of weights.values()) {
      const playable = toPlayableChord(chord, { capo: fret, key, simplify });
      const shape = playable?.shape ?? null;
      ease += easeOf(shape) * duration;
      if (shape?.difficulty === 1) open += duration;
    }
    const openRatio = open / total;
    // Capos cost something real: retuning check, a brighter tone, and one more
    // thing to own. Only take one when it buys a clear gain.
    const penalty = fret === 0 ? 0 : 0.06 + fret * 0.012;
    const score = ease / total - penalty;
    if (!best || score > best.score + 1e-9) {
      const shapeTonic = ((key.tonic - fret) % 12 + 12) % 12;
      best = {
        fret,
        openRatio,
        score,
        shapeKeyName: `${noteName(shapeTonic, keyUsesFlats(shapeTonic, key.mode))} ${key.mode}`,
      };
    }
  }
  return best!;
}

/** Substitutions that keep a chord recognisable while dropping its hard shape. */
const SIMPLIFICATION_ORDER: Record<ChordQuality, ChordQuality[]> = {
  maj: ['maj', 'maj7', 'dom7', 'sus4'],
  min: ['min', 'min7'],
  dom7: ['dom7', 'maj', 'maj7'],
  min7: ['min7', 'min'],
  maj7: ['maj7', 'maj'],
  sus4: ['sus4', 'maj', 'dom7'],
  sus2: ['sus2', 'maj'],
};

export interface PlayableChord {
  /** What the recording actually contains. */
  sounding: ChordSymbol;
  /** What the player fingers, after the capo. */
  shapeChord: ChordSymbol;
  shape: ChordShape;
  /** The detected chord, when the shape is a simplification of it. */
  substitutedFrom?: ChordSymbol;
  /** Name of the chord in the song, spelled for the song's key. */
  label: string;
  /** Name of the shape under the fingers, spelled for the key being read. */
  shapeLabel: string;
}

export interface SimplifyOptions {
  capo: number;
  key: KeyEstimate;
  /** Allow substitutions that change the chord's colour. Off keeps it literal. */
  simplify?: boolean;
  /** Hardest shape to accept before trying a substitution. */
  maxDifficulty?: 1 | 2 | 3;
}

/**
 * Pick the shape a learner should actually play for a detected chord.
 *
 * Substitutions are ordered by what the chord is doing in the key: a dominant
 * gets a seventh (B becomes B7), while everything else prefers a major seventh
 * (F becomes Fmaj7). Both are the moves a teacher makes to get a student past a
 * barre without the song sounding wrong.
 */
export function toPlayableChord(chord: ChordSymbol, opts: SimplifyOptions): PlayableChord | null {
  if (isNoChord(chord)) return null;
  const { capo, key } = opts;
  const simplify = opts.simplify ?? true;
  const maxDifficulty = opts.maxDifficulty ?? 2;
  const shapeChord = transposeChord(chord, -capo);
  const useFlats = key.useFlats;
  // With a capo on, the player is reading in a different key from the one the
  // room hears, and that key decides whether the shape is a Bb or an A#.
  const shapeTonic = ((key.tonic - capo) % 12 + 12) % 12;
  const shapeFlats = capo === 0 ? useFlats : keyUsesFlats(shapeTonic, key.mode);

  const direct = easiestShape(shapeChord);
  if (!simplify || (direct && direct.difficulty <= maxDifficulty)) {
    if (direct) {
      return {
        sounding: chord,
        shapeChord,
        shape: direct,
        label: chordName(chord, useFlats),
        shapeLabel: chordName(shapeChord, shapeFlats),
      };
    }
  }

  const isDominant = ((chord.root - key.tonic) % 12 + 12) % 12 === 7;
  const order = SIMPLIFICATION_ORDER[chord.quality].slice();
  if (isDominant) {
    order.sort((a, b) => (a === 'dom7' ? -1 : b === 'dom7' ? 1 : 0));
  }

  for (const quality of order) {
    const candidate: ChordSymbol = { root: shapeChord.root, quality };
    const shape = easiestShape(candidate);
    if (shape && shape.difficulty <= maxDifficulty) {
      const substituted = quality !== chord.quality;
      return {
        sounding: chord,
        shapeChord: candidate,
        shape,
        substitutedFrom: substituted ? chord : undefined,
        label: chordName(chord, useFlats),
        shapeLabel: chordName(candidate, shapeFlats),
      };
    }
  }

  const fallback = direct ?? easiestShape(shapeChord);
  if (!fallback) return null;
  return {
    sounding: chord,
    shapeChord,
    shape: fallback,
    label: chordName(chord, useFlats),
    shapeLabel: chordName(shapeChord, shapeFlats),
  };
}

export interface StrumStep {
  /** Position within the bar, in beats, starting at 0. */
  beat: number;
  direction: 'D' | 'U';
  accent?: boolean;
  /** Muted percussive hit rather than a ringing strum. */
  mute?: boolean;
}

export interface StrumPattern {
  id: string;
  name: string;
  description: string;
  beatsPerBar: number;
  difficulty: 1 | 2 | 3;
  steps: StrumStep[];
}

export const STRUM_PATTERNS: StrumPattern[] = [
  {
    id: 'held',
    name: 'One per bar',
    description: 'A single strum on beat 1. Start here if changing chords is the hard part.',
    beatsPerBar: 4,
    difficulty: 1,
    steps: [{ beat: 0, direction: 'D', accent: true }],
  },
  {
    id: 'quarters',
    name: 'Down on every beat',
    description: 'Four even downstrokes. Steady, and it fits almost anything.',
    beatsPerBar: 4,
    difficulty: 1,
    steps: [
      { beat: 0, direction: 'D', accent: true },
      { beat: 1, direction: 'D' },
      { beat: 2, direction: 'D' },
      { beat: 3, direction: 'D' },
    ],
  },
  {
    id: 'eighths',
    name: 'Down-up eighths',
    description: 'Keep your hand moving the whole bar. The engine room of pop guitar.',
    beatsPerBar: 4,
    difficulty: 2,
    steps: [
      { beat: 0, direction: 'D', accent: true },
      { beat: 0.5, direction: 'U' },
      { beat: 1, direction: 'D' },
      { beat: 1.5, direction: 'U' },
      { beat: 2, direction: 'D', accent: true },
      { beat: 2.5, direction: 'U' },
      { beat: 3, direction: 'D' },
      { beat: 3.5, direction: 'U' },
    ],
  },
  {
    id: 'classic',
    name: 'D · D U · U D U',
    description: 'The one that unlocks a few hundred songs. Miss the strum on beat 3.',
    beatsPerBar: 4,
    difficulty: 2,
    steps: [
      { beat: 0, direction: 'D', accent: true },
      { beat: 1, direction: 'D' },
      { beat: 1.5, direction: 'U' },
      { beat: 2.5, direction: 'U' },
      { beat: 3, direction: 'D' },
      { beat: 3.5, direction: 'U' },
    ],
  },
  {
    id: 'ballad',
    name: 'Slow ballad',
    description: 'Let each chord ring for half a bar. Room to breathe between changes.',
    beatsPerBar: 4,
    difficulty: 1,
    steps: [
      { beat: 0, direction: 'D', accent: true },
      { beat: 2, direction: 'D' },
      { beat: 3, direction: 'U' },
    ],
  },
  {
    id: 'waltz',
    name: 'Waltz',
    description: 'Three to a bar: one strong, two light.',
    beatsPerBar: 3,
    difficulty: 1,
    steps: [
      { beat: 0, direction: 'D', accent: true },
      { beat: 1, direction: 'D' },
      { beat: 2, direction: 'D' },
    ],
  },
];

export function patternById(id: string): StrumPattern {
  return STRUM_PATTERNS.find((p) => p.id === id) ?? STRUM_PATTERNS[1];
}

/**
 * Pick a strumming pattern for a tempo.
 *
 * Fast songs get fewer strums, not more: at 150 BPM a beginner's hand cannot
 * keep up with eighths, and even quarter notes drive the song fine.
 */
export function suggestStrum(tempo: number, beatsPerBar: number): StrumPattern {
  if (beatsPerBar === 3) return patternById('waltz');
  if (tempo < 72) return patternById('ballad');
  if (tempo < 140) return patternById('classic');
  return patternById('quarters');
}

/** Patterns that fit the given metre, easiest first. */
export function patternsFor(beatsPerBar: number): StrumPattern[] {
  return STRUM_PATTERNS.filter((p) => p.beatsPerBar === beatsPerBar).sort(
    (a, b) => a.difficulty - b.difficulty,
  );
}
