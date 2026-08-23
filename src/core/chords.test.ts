import { describe, expect, it } from 'vitest';
import { consolidateSegments, type ChordSegment } from './chords';
import { chordName, type ChordQuality } from './chordTypes';

/** Beat-chroma builder: named pitch-class weights over a small noise floor. */
function chromaBeat(entries: Array<[number, number]>): number[] {
  const v = new Array(12).fill(0.08);
  for (const [pc, w] of entries) v[pc] = w;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

const E = 4;
const Fsharp = 6;
const G = 7;
const B = 11;
const D = 2;
const Dsharp = 3;

const EM_TREBLE = chromaBeat([[E, 1.0], [G, 0.7], [B, 0.8]]);
// The fingerpicked-verse failure: melody on the ninth, third barely present.
// Locally this scores as Esus2, and by more than the refine step's margin.
const ESUS2ISH_TREBLE = chromaBeat([[E, 1.0], [Fsharp, 0.75], [B, 0.8], [G, 0.25]]);
const E_BASS = chromaBeat([[E, 1.0], [B, 0.35]]);

function grid(beats: number[][]): Float32Array {
  const out = new Float32Array(beats.length * 12);
  beats.forEach((b, i) => out.set(b, i * 12));
  return out;
}

function segment(
  root: number,
  quality: ChordQuality,
  startBeat: number,
  endBeat: number,
): ChordSegment {
  return {
    chord: { root, quality },
    start: startBeat,
    end: endBeat,
    startIndex: startBeat,
    endIndex: endBeat,
    startBeat,
    endBeat,
    confidence: 0.2,
  };
}

describe('consolidateSegments', () => {
  it('folds a melody-coloured bar into the chord the song has established', () => {
    // Six beats of clean Em around two beats where the melody's F# replaces
    // the third: locally Esus2 wins, but the song's vocabulary says Em.
    const treble = grid([
      EM_TREBLE, EM_TREBLE, EM_TREBLE,
      ESUS2ISH_TREBLE, ESUS2ISH_TREBLE,
      EM_TREBLE, EM_TREBLE, EM_TREBLE,
    ]);
    const bass = grid(Array.from({ length: 8 }, () => E_BASS));
    const segments = [
      segment(E, 'min', 0, 3),
      segment(E, 'sus2', 3, 5),
      segment(E, 'min', 5, 8),
    ];
    consolidateSegments(segments, treble, bass, 8);
    expect(segments.map((s) => chordName(s.chord))).toEqual(['Em', 'Em', 'Em']);
  });

  it('leaves a rare chord alone when the alternative is not established enough', () => {
    // Near-equal time on E and Esus2 (an intro that really alternates them):
    // neither dominates, so nothing is folded.
    const treble = grid([
      EM_TREBLE, EM_TREBLE, EM_TREBLE,
      ESUS2ISH_TREBLE, ESUS2ISH_TREBLE,
    ]);
    const bass = grid(Array.from({ length: 5 }, () => E_BASS));
    const segments = [segment(E, 'min', 0, 3), segment(E, 'sus2', 3, 5)];
    consolidateSegments(segments, treble, bass, 5);
    expect(segments.map((s) => chordName(s.chord))).toEqual(['Em', 'Esus2']);
  });

  it('never flips a plain major across the maj/min line, even when outnumbered', () => {
    // A key-change chorus: the new B major is globally rare against the old
    // song's B minor, and its local reading is ambiguous. It must survive.
    const BM_TREBLE = chromaBeat([[B, 1.0], [D, 0.7], [Fsharp, 0.8]]);
    const B_AMBIG_TREBLE = chromaBeat([[B, 1.0], [Dsharp, 0.55], [D, 0.5], [Fsharp, 0.8]]);
    const B_BASS = chromaBeat([[B, 1.0], [Fsharp, 0.35]]);
    const beats = [
      ...Array.from({ length: 10 }, () => BM_TREBLE),
      B_AMBIG_TREBLE, B_AMBIG_TREBLE,
    ];
    const treble = grid(beats);
    const bass = grid(Array.from({ length: 12 }, () => B_BASS));
    const segments = [segment(B, 'min', 0, 10), segment(B, 'maj', 10, 12)];
    consolidateSegments(segments, treble, bass, 12);
    expect(segments.map((s) => chordName(s.chord))).toEqual(['Bm', 'B']);
  });

  it('leaves unambiguous readings alone even when the alternative dominates', () => {
    // A song living on Em7 with one clean plain-Em bar: the seventh chords
    // are protected by their duration, and the Em is protected by its own
    // clear evidence — a missing seventh is not within the relabel margin.
    const EM7_TREBLE = chromaBeat([[E, 1.0], [G, 0.7], [B, 0.8], [D, 0.65]]);
    const treble = grid([
      EM7_TREBLE, EM7_TREBLE, EM7_TREBLE, EM7_TREBLE, EM7_TREBLE, EM7_TREBLE,
      EM_TREBLE, EM_TREBLE,
    ]);
    const bass = grid(Array.from({ length: 8 }, () => E_BASS));
    const segments = [segment(E, 'min7', 0, 6), segment(E, 'min', 6, 8)];
    consolidateSegments(segments, treble, bass, 8);
    expect(segments.map((s) => chordName(s.chord))).toEqual(['Em7', 'Em']);
  });
});
