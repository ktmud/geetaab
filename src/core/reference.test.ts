import { describe, expect, it } from 'vitest';
import {
  alignChordSequences,
  bestShiftAlignment,
  classifyTempo,
  detectedChangeSequence,
  parseHarte,
  parseSheetSymbol,
  sheetChangeSequence,
  symbolRecall,
  vocabularyAgreement,
  type RefInterval,
} from './reference';
import type { ChordSegment } from './chords';
import type { ChordQuality } from './chordTypes';

function seg(start: number, end: number, root: number, quality: ChordQuality = 'maj'): ChordSegment {
  return { chord: { root, quality }, start, end, startIndex: 0, endIndex: 0, confidence: 0.5 };
}

const nc = (start: number, end: number): ChordSegment => ({
  chord: { root: -1, quality: 'maj' },
  start,
  end,
  startIndex: 0,
  endIndex: 0,
  confidence: 0,
});

describe('parseHarte', () => {
  it('reads plain and seventh labels', () => {
    expect(parseHarte('D#:maj')).toEqual({ root: 3, family: 'maj', quality: 'maj' });
    expect(parseHarte('G#:min7')).toEqual({ root: 8, family: 'min', quality: 'min7' });
    expect(parseHarte('Bb:7')).toEqual({ root: 10, family: 'maj', quality: 'dom7' });
    expect(parseHarte('C')).toEqual({ root: 0, family: 'maj', quality: 'maj' });
  });
  it('treats N as no chord', () => {
    expect(parseHarte('N')).toBeNull();
  });
  it('keeps family for qualities outside the vocabulary, with no exact symbol', () => {
    expect(parseHarte('F#:hdim7')).toEqual({ root: 6, family: 'min', quality: null });
    expect(parseHarte('Eb:maj6(*5)/1')).toEqual({ root: 3, family: 'maj', quality: null });
  });
});

describe('parseSheetSymbol', () => {
  it('reads slash chords and add colours', () => {
    const g = parseSheetSymbol('G/B');
    expect(g.root).toBe(7);
    expect(g.bass).toBe(11);
    expect(g.quality).toBe('maj');
    expect(parseSheetSymbol('Cadd9').quality).toBeNull();
    expect(parseSheetSymbol('Cadd9').family).toBe('maj');
    expect(parseSheetSymbol('Am7').quality).toBe('min7');
  });
});

describe('symbolRecall', () => {
  const reference: RefInterval[] = [
    { start: 0, end: 2, chord: { root: 0, family: 'maj', quality: 'maj' } }, // C
    { start: 2, end: 4, chord: { root: 7, family: 'maj', quality: 'maj' } }, // G
    { start: 4, end: 6, chord: { root: 9, family: 'min', quality: 'min' } }, // Am
    { start: 6, end: 8, chord: { root: 5, family: 'maj', quality: 'maj' } }, // F
  ];

  it('gives 100% to a perfect transcription', () => {
    const segments = [seg(0, 2, 0), seg(2, 4, 7), seg(4, 6, 9, 'min'), seg(6, 8, 5)];
    const r = symbolRecall(segments, reference);
    expect(r.familyHit / r.chordTime).toBeCloseTo(1, 5);
    expect(r.exactHit / r.exactTime).toBeCloseTo(1, 5);
  });

  it('punishes the right chords in the wrong order, unlike the vocabulary metric', () => {
    // Same four chords, rotated one slot: every instant is wrong.
    const scrambled = [seg(0, 2, 5), seg(2, 4, 0), seg(4, 6, 7), seg(6, 8, 9, 'min')];
    const r = symbolRecall(scrambled, reference);
    expect(r.familyHit / r.chordTime).toBeLessThan(0.01);

    const refChords = reference.map((s) => s.chord!);
    const v = vocabularyAgreement(scrambled, refChords, 0);
    expect(v.hitFamily / v.played).toBeCloseTo(1, 5); // the old metric is fooled
  });

  it('scores boundaries proportionally when a change comes late', () => {
    const segments = [seg(0, 3, 0), seg(3, 4, 7), seg(4, 6, 9, 'min'), seg(6, 8, 5)];
    const r = symbolRecall(segments, reference);
    // One of eight seconds wrong: the second half of the C hangs over the G.
    expect(r.familyHit / r.chordTime).toBeCloseTo(7 / 8, 2);
  });

  it('counts detected N.C. during a reference chord as a miss', () => {
    const segments = [seg(0, 2, 0), nc(2, 4), seg(4, 6, 9, 'min'), seg(6, 8, 5)];
    const r = symbolRecall(segments, reference);
    expect(r.familyHit / r.chordTime).toBeCloseTo(6 / 8, 2);
    expect(r.ncTime).toBeGreaterThan(1.9);
  });

  it('excludes qualities outside the vocabulary from the exact tier only', () => {
    const withHdim: RefInterval[] = [
      { start: 0, end: 2, chord: { root: 0, family: 'maj', quality: 'maj' } },
      { start: 2, end: 4, chord: { root: 11, family: 'min', quality: null } }, // B:hdim7
    ];
    const segments = [seg(0, 2, 0), seg(2, 4, 11, 'min')];
    const r = symbolRecall(segments, withHdim);
    expect(r.chordTime).toBeCloseTo(4, 1);
    expect(r.exactTime).toBeCloseTo(2, 1); // only the C span has an exact answer
    expect(r.familyHit / r.chordTime).toBeCloseTo(1, 5);
  });

  it('honours the transposition shift', () => {
    const segments = [seg(0, 2, 2), seg(2, 4, 9), seg(4, 6, 11, 'min'), seg(6, 8, 7)];
    expect(symbolRecall(segments, reference).familyHit).toBe(0);
    const shifted = symbolRecall(segments, reference, { shift: 2 });
    expect(shifted.familyHit / shifted.chordTime).toBeCloseTo(1, 5);
  });
});

describe('alignChordSequences', () => {
  const C = { root: 0, family: 'maj' as const };
  const G = { root: 7, family: 'maj' as const };
  const Am = { root: 9, family: 'min' as const };
  const F = { root: 5, family: 'maj' as const };

  it('matches an identical sequence completely', () => {
    const r = alignChordSequences([C, G, Am, F], [C, G, Am, F]);
    expect(r.matched.length).toBe(4);
  });

  it('gives a scrambled order only its accidental common subsequence', () => {
    const r = alignChordSequences([C, G, Am, F], [F, Am, G, C]);
    expect(r.matched.length).toBe(1);
  });

  it('skips an inserted wrong chord without derailing the rest', () => {
    const r = alignChordSequences([C, G, Am, F], [C, G, { root: 4, family: 'maj' }, Am, F]);
    expect(r.matched.length).toBe(4);
    expect(r.detectedCount).toBe(5);
  });

  it('searches shifts for a capo-distance recording', () => {
    const up2 = [
      { root: 2, family: 'maj' as const },
      { root: 9, family: 'maj' as const },
      { root: 11, family: 'min' as const },
      { root: 7, family: 'maj' as const },
    ];
    const r = bestShiftAlignment([C, G, Am, F], up2, Array.from({ length: 12 }, (_, i) => i));
    expect(r.shift).toBe(2);
    expect(r.matched.length).toBe(4);
  });
});

describe('change sequences', () => {
  it('collapses repeats and N.C. on the detected side', () => {
    const segments = [seg(0, 2, 0), seg(2, 3, 0, 'maj7'), nc(3, 4), seg(4, 6, 7)];
    segments[0].startBeat = 0;
    segments[0].endBeat = 4;
    segments[1].startBeat = 4;
    segments[1].endBeat = 6;
    segments[3].startBeat = 8;
    segments[3].endBeat = 12;
    const seq = detectedChangeSequence(segments);
    expect(seq.map((s) => s.root)).toEqual([0, 7]);
    expect(seq[0].beats).toBe(6);
  });

  it('collapses restated chords on the sheet side and measures bar spans', () => {
    const mk = (root: number, bar: number) => ({ chord: { root, family: 'maj' as const, quality: null }, bar });
    const seq = sheetChangeSequence([mk(0, 0), mk(0, 2), mk(7, 4), mk(5, 6)], 8);
    expect(seq.map((s) => s.root)).toEqual([0, 7, 5]);
    expect(seq[0].bars).toBe(4);
    expect(seq[2].bars).toBe(2);
  });
});

describe('classifyTempo', () => {
  it('names the octave and triplet confusions', () => {
    expect(classifyTempo(120, 120)).toBe('correct');
    expect(classifyTempo(65, 129)).toBe('half');
    expect(classifyTempo(129.2, 65)).toBe('double');
    expect(classifyTempo(86, 129)).toBe('twothirds');
    expect(classifyTempo(180, 120)).toBe('threehalves');
    expect(classifyTempo(97, 129)).toBe('other');
  });
});
