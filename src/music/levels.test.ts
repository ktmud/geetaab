import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../core/analyze';
import type { ChordSegment } from '../core/chords';
import { NO_CHORD, chordName } from '../core/chordTypes';
import { renderProgression, DEMO_PROGRESSION } from '../audio/synth';
import { buildTab } from './tab';
import { levelsWorthOffering, reduceSegments } from './levels';

function seg(
  root: number,
  quality: ChordSegment['chord']['quality'],
  startBeat: number,
  endBeat: number,
): ChordSegment {
  return {
    chord: { root, quality },
    start: startBeat / 2,
    end: endBeat / 2,
    startIndex: startBeat,
    endIndex: endBeat,
    startBeat,
    endBeat,
    confidence: 0.3,
  };
}

function ncSeg(startBeat: number, endBeat: number): ChordSegment {
  return { ...seg(0, 'maj', startBeat, endBeat), chord: { ...NO_CHORD } };
}

describe('reduceSegments', () => {
  it('folds extensions into their triads and merges the result', () => {
    // Two-bar chords, comfortably under the hold pass's gates, so this tests
    // folding alone.
    const reduced = reduceSegments(
      [seg(7, 'dom7', 0, 8), seg(7, 'maj', 8, 16), seg(0, 'maj7', 16, 24), seg(2, 'sus4', 24, 32)],
      4,
    );
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['G', 'C', 'D']);
    expect(reduced[0].endBeat).toBe(16);
  });

  it('absorbs a passing chord shorter than half a bar into its neighbour', () => {
    const reduced = reduceSegments([seg(0, 'maj', 0, 8), seg(11, 'maj', 8, 9), seg(9, 'min', 9, 17)], 4);
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['C', 'Am']);
    expect(reduced[0].endBeat).toBe(9);
    expect(reduced[1].startBeat).toBe(9);
  });

  it('leaves silence alone', () => {
    const reduced = reduceSegments([seg(0, 'maj', 0, 8), ncSeg(8, 16), seg(7, 'maj', 16, 24)], 4);
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['C', 'N.C.', 'G']);
  });

  it('holds through the changes of a genuinely fast song at its own bar', () => {
    // Two chords a bar throughout (the 拥抱 shape): nothing is "passing", so
    // absorbing short outliers cannot help. The hold keeps the downbeat chord
    // and skips the half-bar change, halving the decisions.
    const loop = (at: number) => [
      seg(0, 'maj', at, at + 2),
      seg(5, 'maj', at + 2, at + 4),
      seg(9, 'min', at + 4, at + 6),
      seg(7, 'maj', at + 6, at + 8),
    ];
    const reduced = reduceSegments([...loop(0), ...loop(8)], 4);
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['C', 'Am', 'C', 'Am']);
    expect(reduced.map((s) => s.startBeat)).toEqual([0, 4, 8, 12]);
  });

  it('leaves a song at a beginner-manageable rate untouched', () => {
    // Two-bar chords: well under the rate gate, so no hold at all.
    const reduced = reduceSegments(
      [seg(0, 'maj', 0, 8), seg(7, 'maj', 8, 16), seg(9, 'min', 16, 24), seg(5, 'maj', 24, 32)],
      4,
    );
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('never swallows an established chord into a hold', () => {
    // The G runs a full four bars: however fast its neighbours move, a chord
    // as long as the hold unit must survive with its own name.
    const reduced = reduceSegments(
      [seg(0, 'maj', 0, 2), seg(7, 'maj', 2, 10), seg(5, 'maj', 10, 12), seg(4, 'maj', 12, 14)],
      4,
    );
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['C', 'G', 'F']);
    expect(reduced[1].startBeat).toBe(2);
    expect(reduced[1].endBeat).toBe(10);
  });

  it('lets silence end a hold', () => {
    const reduced = reduceSegments(
      [seg(0, 'maj', 0, 2), seg(5, 'maj', 2, 4), ncSeg(4, 8), seg(7, 'maj', 8, 10), seg(9, 'min', 10, 12)],
      4,
    );
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['C', 'N.C.', 'G']);
    // The G after the gap starts a fresh hold rather than joining the C.
    expect(reduced[2].startBeat).toBe(8);
    expect(reduced[2].endBeat).toBe(12);
  });
});

describe('levelsWorthOffering', () => {
  it('offers only the standard reading for a song that is already plain', () => {
    // The demo is four open triads: nothing to reduce, nothing to be more
    // faithful to.
    const audio = renderProgression([...DEMO_PROGRESSION, ...DEMO_PROGRESSION], {
      sampleRate: 44100,
      bpm: 96,
      seed: 20240,
    });
    const analysis = analyzeAudio(audio, 44100);
    const standard = buildTab(analysis, { simplify: true });
    const faithful = buildTab(analysis, { simplify: false });
    const easy = buildTab(
      { ...analysis, segments: reduceSegments(analysis.segments, analysis.beatsPerBar) },
      { simplify: true },
    );
    const levels = levelsWorthOffering({ easy, standard, faithful });
    expect(levels).toContain('standard');
    expect(levels).toEqual(['standard']);
  });
});
