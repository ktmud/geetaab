import { describe, expect, it } from 'vitest';
import type { ChordSegment } from '../core/chords';
import { chordName, type ChordQuality, type ChordSymbol } from '../core/chordTypes';
import { estimateKey } from '../core/key';
import { chooseCapo, suggestStrum, toPlayableChord } from './arrange';
import { chordToneHistogram } from '../core/analyze';

function segmentsOf(progression: [number, ChordQuality][], barSeconds = 2): ChordSegment[] {
  return progression.map(([root, quality], i) => ({
    chord: { root, quality } as ChordSymbol,
    start: i * barSeconds,
    end: (i + 1) * barSeconds,
    startIndex: i * 4,
    endIndex: (i + 1) * 4,
    startBeat: i * 4,
    endBeat: (i + 1) * 4,
    confidence: 0.5,
  }));
}

function keyFor(segments: ChordSegment[]) {
  return estimateKey(chordToneHistogram(segments));
}

describe('chooseCapo', () => {
  it('leaves a song that is already open-chord friendly alone', () => {
    const segments = segmentsOf([
      [7, 'maj'],
      [2, 'maj'],
      [9, 'min'],
      [0, 'maj'],
    ]);
    const capo = chooseCapo(segments, keyFor(segments));
    expect(capo.fret).toBe(0);
    expect(capo.openRatio).toBe(1);
  });

  it('finds a capo that turns a flat key into open shapes', () => {
    // Eb - Bb - Cm - Ab: four barre chords at the nut.
    const segments = segmentsOf([
      [3, 'maj'],
      [10, 'maj'],
      [0, 'min'],
      [8, 'maj'],
    ]);
    const key = keyFor(segments);
    const capo = chooseCapo(segments, key);
    // Capo 3 turns the whole song into C, G, Am and an Fmaj7. Capo 1 also gets
    // three open shapes but leaves a Bm behind, so it must not win.
    expect(capo.fret).toBe(3);
    expect(capo.openRatio).toBe(1);
    expect(capo.shapeKeyName).toBe('C major');
    const shapes = segments.map(
      (s) => toPlayableChord(s.chord, { capo: capo.fret, key })!.shapeLabel,
    );
    expect(shapes).toEqual(['C', 'G', 'Am', 'Fmaj7']);
  });

  it('scores literal shapes when simplification is turned off', () => {
    const segments = segmentsOf([
      [3, 'maj'],
      [10, 'maj'],
      [0, 'min'],
      [8, 'maj'],
    ]);
    const simplified = chooseCapo(segments, keyFor(segments), { simplify: true });
    const literal = chooseCapo(segments, keyFor(segments), { simplify: false });
    expect(literal.fret).not.toBe(simplified.fret);
  });

  it('reports the shapes the player reads with the capo on', () => {
    const segments = segmentsOf([
      [3, 'maj'],
      [8, 'maj'],
      [10, 'maj'],
    ]);
    const key = keyFor(segments);
    const capo = chooseCapo(segments, key);
    const shapes = segments.map(
      (s) => toPlayableChord(s.chord, { capo: capo.fret, key })!.shapeLabel,
    );
    for (const shape of shapes) {
      expect(['C', 'D', 'E', 'G', 'A', 'F', 'Fmaj7']).toContain(shape);
    }
  });
});

describe('toPlayableChord', () => {
  const cMajor = estimateKey(chordToneHistogram(segmentsOf([[0, 'maj'], [5, 'maj'], [7, 'maj']])));

  it('swaps the F barre for the four-string Fmaj7', () => {
    const played = toPlayableChord({ root: 5, quality: 'maj' }, { capo: 0, key: cMajor })!;
    expect(played.shape.difficulty).toBe(1);
    expect(played.shapeLabel).toBe('Fmaj7');
    expect(played.substitutedFrom).toBeDefined();
  });

  it('turns a barre minor into the easier minor seventh', () => {
    const played = toPlayableChord({ root: 11, quality: 'min' }, { capo: 0, key: cMajor })!;
    expect(played.shapeLabel).toBe('Bm7');
    expect(played.shape.difficulty).toBeLessThanOrEqual(2);
  });

  it('prefers a dominant seventh when the chord is the V of the key', () => {
    const eMajor = estimateKey(
      chordToneHistogram(segmentsOf([[4, 'maj'], [9, 'maj'], [11, 'maj'], [4, 'maj']])),
    );
    const played = toPlayableChord({ root: 11, quality: 'maj' }, { capo: 0, key: eMajor })!;
    expect(played.shapeLabel).toBe('B7');
  });

  it('leaves the chord alone when simplify is off', () => {
    const played = toPlayableChord({ root: 5, quality: 'maj' }, { capo: 0, key: cMajor, simplify: false })!;
    expect(chordName(played.shapeChord)).toBe('F');
    expect(played.shape.difficulty).toBe(3);
    expect(played.substitutedFrom).toBeUndefined();
  });

  it('accounts for the capo when naming what to finger', () => {
    const ebMajor = estimateKey(
      chordToneHistogram(segmentsOf([[3, 'maj'], [8, 'maj'], [10, 'maj'], [3, 'maj']])),
    );
    expect(ebMajor.useFlats).toBe(true);
    const played = toPlayableChord({ root: 3, quality: 'maj' }, { capo: 3, key: ebMajor })!;
    // Capo 3 means the player fingers C and the room hears Eb.
    expect(played.shapeLabel).toBe('C');
    expect(played.label).toBe('Eb');
  });
});

describe('suggestStrum', () => {
  it('matches the pattern to the tempo and metre', () => {
    expect(suggestStrum(64, 4).id).toBe('ballad');
    expect(suggestStrum(96, 4).id).toBe('classic');
    expect(suggestStrum(168, 4).id).toBe('quarters');
    expect(suggestStrum(96, 3).id).toBe('waltz');
  });
});
