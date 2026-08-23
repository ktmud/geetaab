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
  const eased = mergeAdjacent(absorbShort(mergeAdjacent(reduced), beatsPerBar));
  return mergeAdjacent(holdThroughFastChanges(eased, segments));
}

/** Above this, a first-year player is changing chords faster than they can
 * think; only then does the hold pass step in. */
const EASY_MAX_CHANGES_PER_MINUTE = 21;

/** A typical chord shorter than this marks a genuinely fast harmonic rhythm.
 * A song of unhurried bar-length chords can sit above the rate gate at a
 * brisk tempo — the demo progression does — and should still be left alone. */
const EASY_FAST_MEDIAN_SECONDS = 2.25;

/**
 * Coarsen a genuinely fast song to roughly its own bar.
 *
 * Some songs really do change every two beats, sheet and all — absorbing
 * "passing" chords cannot help there because nothing is passing. What a
 * teacher does instead is halve the harmonic rhythm: play the downbeat chord
 * and hold it through the next change. The hold unit is twice the analysis's
 * median chord length, which is the song's own bar wherever the sheet changes
 * twice a bar — and, usefully, is immune to the beat grid coming back an
 * octave high, because the median doubles right along with the beat count.
 *
 * A chord as long as the unit is never absorbed — the pass thins genuinely
 * quick changes, it does not swallow established harmony — and a song already
 * at a beginner-manageable rate is returned untouched.
 */
function holdThroughFastChanges(
  segments: ChordSegment[],
  source: ChordSegment[],
): ChordSegment[] {
  const chords = segments.filter((s) => s.chord.root >= 0);
  if (chords.length < 2) return segments;
  const span = chords[chords.length - 1].end - chords[0].start;
  if (span <= 0 || (chords.length / span) * 60 <= EASY_MAX_CHANGES_PER_MINUTE) return segments;

  const sourceChords = source.filter((s) => s.chord.root >= 0);
  if (sourceChords.length === 0) return segments;
  const secs = sourceChords.map((s) => s.end - s.start).sort((a, b) => a - b);
  if (secs[secs.length >> 1] >= EASY_FAST_MEDIAN_SECONDS) return segments;

  const lens = sourceChords
    .map((s) => (s.endBeat ?? 0) - (s.startBeat ?? 0))
    .sort((a, b) => a - b);
  const median = lens[lens.length >> 1];
  const unit = Math.max(2, Math.round(2 * median));

  const out: ChordSegment[] = [];
  let heldStart = -Infinity; // startBeat of the last change the player makes
  for (const seg of segments) {
    const previous = out[out.length - 1];
    if (seg.chord.root < 0) {
      out.push({ ...seg });
      heldStart = -Infinity; // silence ends the hold: the next chord is fresh
      continue;
    }
    const start = seg.startBeat ?? 0;
    const beats = (seg.endBeat ?? 0) - start;
    if (previous && previous.chord.root >= 0 && start - heldStart < unit && beats < unit) {
      previous.end = seg.end;
      previous.endBeat = seg.endBeat;
      previous.endIndex = seg.endIndex;
      continue;
    }
    out.push({ ...seg });
    heldStart = start;
  }
  return out;
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
