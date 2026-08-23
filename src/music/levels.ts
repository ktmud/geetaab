import { mergeAdjacent, type ChordSegment } from '../core/chords';
import type { ChordQuality } from '../core/chordTypes';
import type { SongTab } from './tab';

/**
 * Three readings of the same song.
 *
 * `standard` is what the app has always produced: every change the analysis
 * heard, on shapes a beginner can finger. `faithful` keeps the exact chords
 * and exact shapes. `easy` goes the other way: extensions fold into the triads
 * they decorate and passing chords shorter than half a bar are absorbed, so a
 * first-year player gets fewer, plainer changes. The lower rungs only appear
 * when they actually differ — an already-simple song needs no ladder.
 */
export type TabLevel = 'easy' | 'standard' | 'faithful';

/** A seventh or a suspension is the triad's colour, not its identity. */
const REDUCED_QUALITY: Record<ChordQuality, ChordQuality> = {
  maj: 'maj',
  min: 'min',
  dom7: 'maj',
  min7: 'min',
  maj7: 'maj',
  sus4: 'maj',
  sus2: 'maj',
};

/**
 * The harmony a beginner should learn first: same song, fewer decisions.
 *
 * Reduction happens on the segments, before any shape or capo choice, so the
 * easy tab is not just easier fingerings — it is genuinely fewer chords.
 */
export function reduceSegments(segments: ChordSegment[], beatsPerBar: number): ChordSegment[] {
  const reduced = segments.map((seg) =>
    seg.chord.root < 0
      ? { ...seg }
      : { ...seg, chord: { root: seg.chord.root, quality: REDUCED_QUALITY[seg.chord.quality] } },
  );
  return mergeAdjacent(absorbShort(mergeAdjacent(reduced), beatsPerBar));
}

function absorbShort(segments: ChordSegment[], beatsPerBar: number): ChordSegment[] {
  const minBeats = Math.max(2, beatsPerBar / 2);
  const out: ChordSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const beats = (seg.endBeat ?? 0) - (seg.startBeat ?? 0);
    const previous = out[out.length - 1];
    if (seg.chord.root >= 0 && beats > 0 && beats < minBeats) {
      // A quick passing chord joins whichever neighbour is playing: the hand
      // simply stays put through it.
      if (previous && previous.chord.root >= 0) {
        previous.end = seg.end;
        previous.endBeat = seg.endBeat;
        previous.endIndex = seg.endIndex;
        continue;
      }
      const next = segments[i + 1];
      if (next && next.chord.root >= 0) {
        next.start = seg.start;
        next.startBeat = seg.startBeat;
        next.startIndex = seg.startIndex;
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/** Chord-change count, the thing the easy level exists to lower. */
function changeCount(tab: SongTab): number {
  return tab.events.filter((event) => event.chord).length;
}

function paletteIds(tab: SongTab): string {
  return tab.palette
    .map((chord) => `${chord.shapeChord.root}:${chord.shapeChord.quality}`)
    .sort()
    .join(',');
}

/**
 * Which levels are worth showing for this song.
 *
 * `standard` is always on offer. `easy` earns its place by removing chords or
 * shrinking the palette; `faithful` by actually differing from the beginner
 * shapes. A three-way switch where two answers are identical is noise.
 */
export function levelsWorthOffering(tabs: Record<TabLevel, SongTab>): TabLevel[] {
  const levels: TabLevel[] = [];
  const easierPalette = tabs.easy.palette.length < tabs.standard.palette.length;
  const fewerChanges = changeCount(tabs.easy) <= changeCount(tabs.standard) * 0.9;
  if (easierPalette || fewerChanges) levels.push('easy');
  levels.push('standard');
  if (paletteIds(tabs.faithful) !== paletteIds(tabs.standard)) levels.push('faithful');
  return levels;
}
