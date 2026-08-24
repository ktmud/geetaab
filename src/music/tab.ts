import type { AnalysisResult } from '../core/analyze';
import { isNoChord } from '../core/chordTypes';
import type { KeyEstimate } from '../core/key';
import { romanNumeral } from '../core/key';
import {
  chooseCapo,
  suggestStrum,
  toPlayableChord,
  type PlayableChord,
  type StrumPattern,
} from './arrange';

export interface TabEvent {
  /** Null for a stretch with no detectable chord. */
  chord: PlayableChord | null;
  startBeat: number;
  endBeat: number;
  startTime: number;
  endTime: number;
  numeral: string | null;
}

export interface TabBar {
  index: number;
  startBeat: number;
  beats: number;
  startTime: number;
  endTime: number;
  /** Events overlapping this bar, clipped to it. */
  slots: { event: TabEvent; offsetBeats: number; beats: number }[];
  signature: string;
}

export interface SongLoop {
  /** Chord labels of one time through the loop, one entry per bar. */
  bars: string[];
  length: number;
  /** Fraction of the song this loop accounts for. */
  coverage: number;
}

export interface SongTab {
  key: KeyEstimate;
  capo: number;
  capoOpenRatio: number;
  shapeKeyName: string;
  tempo: number;
  beatsPerBar: number;
  strum: StrumPattern;
  events: TabEvent[];
  bars: TabBar[];
  palette: PlayableChord[];
  loop: SongLoop | null;
  duration: number;
  confidence: number;
}

export interface BuildTabOptions {
  /** Override the chosen capo fret. */
  capo?: number;
  simplify?: boolean;
  strumId?: string;
  strum?: StrumPattern;
}

/**
 * Which event is sounding at a moment, or -1 before the first one is.
 *
 * A song does not necessarily start on a chord. The decode runs on the beat
 * grid, so anything before the first chord the arranger kept — a count-off, an
 * intro that proved nothing, a fade-in — is a run-in with no chord in it, and
 * on a real recording that is not a rounding error: one take measured here runs
 * 13.3 seconds before its first chord.
 *
 * Answering 0 for that stretch, which is what a plain scan does, tells a player
 * a chord is sounding when none is. Answering -1 says the truthful thing:
 * nothing yet, and here is what is coming.
 */
export function eventIndexAt(events: TabEvent[], time: number): number {
  if (events.length === 0 || time < events[0].startTime) return -1;
  for (let i = 0; i < events.length; i++) {
    if (time < events[i].endTime) return i;
  }
  return events.length - 1;
}

/** Time of a beat index, extrapolating past the end of the tracked grid. */
export function beatTime(beats: number[], index: number): number {
  if (beats.length === 0) return 0;
  if (index < 0) return beats[0] + index * beatPeriod(beats);
  if (index < beats.length) return beats[index];
  return beats[beats.length - 1] + (index - beats.length + 1) * beatPeriod(beats);
}

function beatPeriod(beats: number[]): number {
  if (beats.length < 2) return 0.5;
  return (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
}

/**
 * Turn a raw analysis into something a beginner can read and play.
 *
 * This is where the app stops describing the recording and starts making
 * choices for the player: which capo, which shapes, which strum.
 */
export function buildTab(analysis: AnalysisResult, opts: BuildTabOptions = {}): SongTab {
  const { key, beats, beatsPerBar, barPhase, tempo } = analysis;
  const simplify = opts.simplify ?? true;
  const capoChoice = chooseCapo(analysis.segments, key, { simplify });
  const capo = opts.capo ?? capoChoice.fret;

  const allEvents: TabEvent[] = analysis.segments.map((seg) => {
    const chord = isNoChord(seg.chord) ? null : toPlayableChord(seg.chord, { capo, key, simplify });
    return {
      chord,
      startBeat: seg.startBeat ?? 0,
      endBeat: seg.endBeat ?? (seg.startBeat ?? 0) + 1,
      startTime: seg.start,
      endTime: seg.end,
      numeral: isNoChord(seg.chord) ? null : romanNumeral(seg.chord.root, key),
    };
  });

  // Silence before the first chord and after the last is not part of the song;
  // leaving it in adds empty bars the player would have to count through.
  const events = trimSilentEdges(allEvents);
  const strum = opts.strum ?? suggestStrum(tempo, beatsPerBar);
  const bars = layOutBars(events, beats, beatsPerBar, barPhase);
  const palette = buildPalette(events);
  const loop = findLoop(bars);

  return {
    key,
    capo,
    capoOpenRatio: capoChoice.openRatio,
    shapeKeyName: opts.capo === undefined || opts.capo === capoChoice.fret ? capoChoice.shapeKeyName : shiftedKeyName(key, opts.capo),
    tempo,
    beatsPerBar,
    strum,
    events,
    bars,
    palette,
    loop,
    duration: analysis.duration,
    confidence: analysis.confidence,
  };
}

function trimSilentEdges(events: TabEvent[]): TabEvent[] {
  let first = 0;
  while (first < events.length && !events[first].chord) first++;
  let last = events.length - 1;
  while (last >= first && !events[last].chord) last--;
  return first <= last ? events.slice(first, last + 1) : events;
}

function shiftedKeyName(key: KeyEstimate, capo: number): string {
  const tonic = ((key.tonic - capo) % 12 + 12) % 12;
  const names = key.useFlats
    ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
    : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[tonic]} ${key.mode}`;
}

function layOutBars(
  events: TabEvent[],
  beats: number[],
  beatsPerBar: number,
  barPhase: number,
): TabBar[] {
  if (events.length === 0) return [];
  const lastBeat = events[events.length - 1].endBeat;
  const bars: TabBar[] = [];
  // The first bar is short when the recording starts mid-bar; keeping that
  // pickup as its own bar is what makes every later downbeat land correctly.
  let start = barPhase > 0 ? barPhase - beatsPerBar : 0;
  let index = 0;
  while (start < lastBeat) {
    const barStart = Math.max(0, start);
    const barEnd = Math.min(lastBeat, start + beatsPerBar);
    if (barEnd > barStart) {
      const slots: TabBar['slots'] = [];
      for (const event of events) {
        const from = Math.max(event.startBeat, barStart);
        const to = Math.min(event.endBeat, barEnd);
        if (to > from) slots.push({ event, offsetBeats: from - barStart, beats: to - from });
      }
      bars.push({
        index,
        startBeat: barStart,
        beats: barEnd - barStart,
        startTime: beatTime(beats, barStart),
        endTime: beatTime(beats, barEnd),
        slots,
        signature: slots.map((s) => s.event.chord?.label ?? 'N.C.').join(' '),
      });
      index++;
    }
    start += beatsPerBar;
  }
  // A recording that opens or closes on silence leaves bars with nothing in
  // them; numbering those would have the player counting through empty air.
  let first = 0;
  while (first < bars.length && bars[first].slots.length === 0) first++;
  let last = bars.length - 1;
  while (last >= first && bars[last].slots.length === 0) last--;
  return bars.slice(first, last + 1).map((bar, i) => ({ ...bar, index: i }));
}

function buildPalette(events: TabEvent[]): PlayableChord[] {
  const seen = new Map<string, PlayableChord>();
  for (const event of events) {
    if (!event.chord) continue;
    const id = `${event.chord.shapeChord.root}:${event.chord.shapeChord.quality}`;
    if (!seen.has(id)) seen.set(id, event.chord);
  }
  return [...seen.values()];
}

/**
 * The repeating progression the song is built on.
 *
 * Beginners do not learn a three-minute song; they learn its four-bar loop and
 * then play it twenty times. Surfacing that loop is most of the value of the
 * whole tab.
 */
export function findLoop(bars: TabBar[]): SongLoop | null {
  const signatures = bars.map((b) => b.signature).filter((s) => s.length > 0);
  if (signatures.length < 4) return null;

  let best: { loop: SongLoop; repeat: number } | null = null;
  for (const length of [4, 2, 8]) {
    // Two bars past the pattern is the least that can confirm it repeats.
    if (signatures.length < length + 2) continue;

    const firstSeen = new Map<string, number>();
    const counts = new Map<string, number>();
    for (let i = 0; i + length <= signatures.length; i++) {
      const key = signatures.slice(i, i + length).join(' | ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!firstSeen.has(key)) firstSeen.set(key, i);
    }
    let topKey = '';
    let topCount = 0;
    for (const [k, c] of counts) {
      if (c > topCount) {
        topCount = c;
        topKey = k;
      }
    }
    if (!topKey) continue;

    const pattern = topKey.split(' | ');
    const start = firstSeen.get(topKey) ?? 0;
    const predicts = (i: number): boolean =>
      signatures[i] === pattern[(((i - start) % length) + length) % length];

    // Score the pattern only on the bars it did not come from. Any window
    // trivially matches itself, so counting those would let a song that never
    // repeats at all report a loop, and would let an eight-bar window outscore
    // the four-bar loop it is simply made of.
    let outside = 0;
    let outsideMatches = 0;
    let total = 0;
    for (let i = 0; i < signatures.length; i++) {
      if (predicts(i)) total++;
      if (i >= start && i < start + length) continue;
      outside++;
      if (predicts(i)) outsideMatches++;
    }
    if (outside === 0) continue;
    const repeat = outsideMatches / outside;

    // Prefer the shortest loop that explains the song; a four-bar answer beats
    // an eight-bar one that is just the same thing said twice.
    const score = repeat + (length === 4 ? 0.05 : 0);
    const bestScore = best ? best.repeat + (best.loop.length === 4 ? 0.05 : 0) : -1;
    if (score > bestScore) {
      best = { loop: { bars: pattern, length, coverage: total / signatures.length }, repeat };
    }
  }
  return best && best.repeat >= 0.6 ? best.loop : null;
}

/** Six-line tablature rows for one chord shape under a strumming pattern. */
export interface TabStrumColumn {
  beat: number;
  direction: 'D' | 'U';
  accent: boolean;
  /** Fret per string, low E first; null for a string that is not struck. */
  frets: (number | null)[];
}

export function strumColumns(chord: PlayableChord, strum: StrumPattern): TabStrumColumn[] {
  return strum.steps.map((step) => ({
    beat: step.beat,
    direction: step.direction,
    accent: step.accent ?? false,
    frets: chord.shape.frets.map((f) => (f < 0 ? null : f)),
  }));
}
