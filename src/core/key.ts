import { noteName } from './chordTypes';

export type Mode = 'major' | 'minor';

export interface KeyEstimate {
  tonic: number;
  mode: Mode;
  /** Correlation of the winning profile, 0..1-ish. */
  confidence: number;
  useFlats: boolean;
  name: string;
}

// Krumhansl-Kessler tonal hierarchy profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

/** Position on the circle of fifths; negative means the key is spelled flat. */
const FIFTHS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

export function keyUsesFlats(tonic: number, mode: Mode): boolean {
  const majorTonic = mode === 'major' ? tonic : (tonic + 3) % 12;
  return (FIFTHS[majorTonic] ?? 0) < 0;
}

/**
 * Key from a pitch-class distribution.
 *
 * `weights` is normally the duration-weighted histogram of detected chord
 * tones, which tracks the key better than raw chroma because it has already
 * been cleaned up by the chord decoder.
 */
export function estimateKey(weights: number[]): KeyEstimate {
  let best: KeyEstimate | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as Mode[]) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = profile.map((_, i) => profile[(i - tonic + 120) % 12]);
      const score = correlate(weights, rotated);
      if (!best || score > best.confidence) {
        const useFlats = keyUsesFlats(tonic, mode);
        best = {
          tonic,
          mode,
          confidence: score,
          useFlats,
          name: `${noteName(tonic, useFlats)} ${mode === 'major' ? 'major' : 'minor'}`,
        };
      }
    }
  }
  return best!;
}

/** Scale degrees of the diatonic triads, used to label chords with numerals. */
const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const MINOR_NUMERALS = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

/** Roman numeral for a chord root in a key, or null when it is chromatic. */
export function romanNumeral(root: number, key: KeyEstimate): string | null {
  const degrees = key.mode === 'major' ? MAJOR_DEGREES : MINOR_DEGREES;
  const numerals = key.mode === 'major' ? MAJOR_NUMERALS : MINOR_NUMERALS;
  const rel = ((root - key.tonic) % 12 + 12) % 12;
  const idx = degrees.indexOf(rel);
  return idx >= 0 ? numerals[idx] : null;
}
