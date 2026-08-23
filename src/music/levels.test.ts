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
    const reduced = reduceSegments(
      [seg(7, 'dom7', 0, 4), seg(7, 'maj', 4, 8), seg(0, 'maj7', 8, 12), seg(2, 'sus4', 12, 16)],
      4,
    );
    expect(reduced.map((s) => chordName(s.chord))).toEqual(['G', 'C', 'D']);
    expect(reduced[0].endBeat).toBe(8);
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
