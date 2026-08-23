export type ChordQuality = 'maj' | 'min' | 'dom7' | 'min7' | 'maj7' | 'sus4' | 'sus2';

/** Semitones above the root, root included. */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
};

export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dom7: '7',
  min7: 'm7',
  maj7: 'maj7',
  sus4: 'sus4',
  sus2: 'sus2',
};

/** Detection order doubles as a tie-break preference: simpler qualities first. */
export const QUALITIES: ChordQuality[] = ['maj', 'min', 'dom7', 'min7', 'maj7', 'sus4', 'sus2'];

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface ChordSymbol {
  /** Pitch class 0-11, or -1 for "no chord". */
  root: number;
  quality: ChordQuality;
}

export const NO_CHORD: ChordSymbol = { root: -1, quality: 'maj' };

export function isNoChord(c: ChordSymbol): boolean {
  return c.root < 0;
}

export function noteName(pc: number, useFlats = false): string {
  const idx = ((pc % 12) + 12) % 12;
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[idx];
}

export function chordName(chord: ChordSymbol, useFlats = false): string {
  if (isNoChord(chord)) return 'N.C.';
  return noteName(chord.root, useFlats) + QUALITY_SUFFIX[chord.quality];
}

export function chordEquals(a: ChordSymbol, b: ChordSymbol): boolean {
  if (isNoChord(a) && isNoChord(b)) return true;
  return a.root === b.root && a.quality === b.quality;
}

/** Pitch classes sounded by a chord, useful for scoring and voicing. */
export function chordPitchClasses(chord: ChordSymbol): number[] {
  if (isNoChord(chord)) return [];
  return QUALITY_INTERVALS[chord.quality].map((iv) => (chord.root + iv) % 12);
}

export function transposeChord(chord: ChordSymbol, semitones: number): ChordSymbol {
  if (isNoChord(chord)) return chord;
  return { root: (((chord.root + semitones) % 12) + 12) % 12, quality: chord.quality };
}
