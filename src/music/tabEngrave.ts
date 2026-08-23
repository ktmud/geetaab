import type { StrumPattern } from './arrange';
import { pluckStringOf } from './pick';
import type { ChordShape } from './shapes';
import type { SongTab, TabBar } from './tab';

/**
 * Laying out six-line tablature the way a printed sheet does it.
 *
 * The plain-text tab in `tabText.ts` still exists and still matters: it is what
 * survives being pasted into a forum post or a notes app, and no drawing does
 * that. But on paper monospace tab is a poor relation of the real thing. Every
 * column is the same width whatever it holds, so a bar of four strums and a bar
 * of eight look identical until you count them; the string lines are made of
 * hyphens, which break at every fret number; and a two-digit fret shoves the
 * whole column out of line with the ones above it.
 *
 * So this module produces coordinates instead of characters, and the renderer
 * draws continuous string lines with the fret numbers sitting on them, columns
 * spaced by when they actually fall in the bar, and bar lines where the bars
 * are. Nothing here knows about SVG or React — it is arithmetic, so it can be
 * checked by tests rather than by looking at it.
 *
 * All measurements are in one abstract unit that the renderer scales; think of
 * them as points on a page rather than pixels on a screen.
 */

/** Vertical gap between two adjacent string lines. */
export const STRING_GAP = 9;
/** Six strings, five gaps. */
export const STAFF_HEIGHT = STRING_GAP * 5;
/** The chord-name line above the staff. */
export const NAME_HEIGHT = 11;
/** The chord box under each name. */
export const DIAGRAM_HEIGHT = 26;
/** Air between the chord boxes and the top string, so the two rows read as
 * separate things rather than one crowded block. */
export const HEAD_GAP = 13;
/** Room above the staff for the chord names and their boxes. */
export const HEAD_HEIGHT = NAME_HEIGHT + DIAGRAM_HEIGHT + HEAD_GAP;
/** Room below it for the strumming or picking marks. */
export const FOOT_HEIGHT = 16;
/**
 * Horizontal room one column of the right hand needs.
 *
 * Wide enough for a two-digit fret and the gap punched out of the string line
 * around it, and no wider — this is what sets how many bars fit on a line.
 */
export const COLUMN_WIDTH = 12.5;
/** Blank space inside a bar, before its first column and after its last. The
 * first column of a bar is a full chord shape, so it needs room to clear the
 * bar line rather than sitting against it. */
const BAR_PAD = 7;
/**
 * How wide a system may get before it wraps.
 *
 * Bars are as wide as their own content, so this is what decides the count: a
 * song strummed in quarter notes gets six or more bars to a line, one in
 * eighths gets three or four, and a fingerpicked one lands in between. Fixing
 * the count instead would give the sparse songs a line of whitespace and the
 * busy ones a wall — which is the thing a drawn tab is supposed to fix.
 *
 * The figure is in staff units, and it pairs with the fixed pixels-per-unit the
 * renderer draws at: together they say "as many bars as fit across the page at
 * a size you can read", which is the rule an engraver works to.
 */
const SYSTEM_TARGET = 400;
/** Never fewer than this, however busy the bar. */
const MIN_BARS_PER_SYSTEM = 2;
/** Never more, however sparse: past this the staff is unreadably small. */
const MAX_BARS_PER_SYSTEM = 8;
/** The staff's left margin, where the string letters go. */
export const CLEF_WIDTH = 13;

/** A fret number sitting on one string line. */
export interface EngravedNote {
  /** Display numbering: 6 is the low E, 1 the high E. */
  string: number;
  /** Fret, or -1 for a muted string that the column mutes rather than plays. */
  fret: number;
  /** Distance down from the top of the staff. */
  y: number;
}

/** One moment in the bar where the right hand does something. */
export interface EngravedColumn {
  x: number;
  notes: EngravedNote[];
  direction: 'D' | 'U';
  accent: boolean;
  /** Present on picking patterns: the finger that takes this one string. */
  finger?: string;
}

/** A chord name over the staff, with the box that shows how to hold it. */
export interface EngravedName {
  label: string;
  x: number;
  /** A name on the bar line is set from it rather than centred over it, or it
   * hangs back into the previous bar. */
  anchor: 'start' | 'middle';
  /** The shape to draw under the name; null where there is no chord to hold. */
  shape: ChordShape | null;
}

export interface EngravedBar {
  /** 0-based index in the song. */
  index: number;
  x: number;
  width: number;
  /** Chord names over the bar, at the moment each one starts. */
  names: EngravedName[];
  columns: EngravedColumn[];
}

export interface EngravedSystem {
  startBar: number;
  bars: EngravedBar[];
  /** Drawing width shared by every system, so they all scale alike. */
  width: number;
  /** Where this system's own music ends; the closing bar line goes here. */
  contentWidth: number;
}

/** What the renderer needs that is the same for every system. */
export interface EngraveMetrics {
  stringGap: number;
  staffHeight: number;
  headHeight: number;
  /** Height of the chord-name line inside the head. */
  nameHeight: number;
  /** Height of the chord box under it. */
  diagramHeight: number;
  footHeight: number;
  clefWidth: number;
  /** Total height of one drawn system. */
  height: number;
  /** High E first, as tablature is written on paper. */
  stringLabels: string[];
}

export const METRICS: EngraveMetrics = {
  stringGap: STRING_GAP,
  staffHeight: STAFF_HEIGHT,
  headHeight: HEAD_HEIGHT,
  nameHeight: NAME_HEIGHT,
  diagramHeight: DIAGRAM_HEIGHT,
  footHeight: FOOT_HEIGHT,
  clefWidth: CLEF_WIDTH,
  height: HEAD_HEIGHT + STAFF_HEIGHT + FOOT_HEIGHT,
  stringLabels: ['e', 'B', 'G', 'D', 'A', 'E'],
};

/**
 * Distance down from the top of the staff to a string's line.
 *
 * Tablature is written with the high E on top, so string 1 is at zero and the
 * low E — string 6, the lowest sounding and the lowest on the page — is five
 * gaps down. Getting this backwards draws a staff that is upside down and
 * otherwise entirely plausible.
 */
export function stringY(displayString: number): number {
  return (displayString - 1) * STRING_GAP;
}

function chordAtOffset(bar: TabBar, offsetBeats: number) {
  for (const slot of bar.slots) {
    if (offsetBeats >= slot.offsetBeats - 1e-6 && offsetBeats < slot.offsetBeats + slot.beats - 1e-6) {
      return slot.event.chord;
    }
  }
  return bar.slots.length ? bar.slots[bar.slots.length - 1].event.chord : null;
}

function notesFor(shape: number[] | null): EngravedNote[] {
  if (!shape) return [];
  // Muted strings are kept, at fret -1: a printed tab writes an x on them, and
  // for a chord like D that x is half the instruction.
  return shape.map((fret, index) => ({ string: 6 - index, fret, y: stringY(6 - index) }));
}

/**
 * Lay out one bar.
 *
 * A column's place in the bar comes from its beat, not from its position in the
 * list, so a bar of eighth notes is twice as busy as a bar of quarters and
 * looks it. That is the whole reason to draw this rather than print it.
 */
export function engraveBar(
  bar: TabBar,
  strum: StrumPattern,
  x: number,
  /** The chord still sounding from the previous bar; its name is not restated. */
  carried?: string,
): EngravedBar {
  const steps = strum.steps.filter((s) => s.beat < bar.beats);
  // A bar is as wide as what it holds: eight strums to the bar really is twice
  // as much writing as four, and stretching four of them across the same space
  // is what leaves a printed line looking half empty.
  const width = BAR_PAD * 2 + Math.max(bar.beats, steps.length) * COLUMN_WIDTH;
  const inner = width - BAR_PAD * 2;
  const at = (beat: number): number => x + BAR_PAD + (bar.beats > 0 ? (beat / bar.beats) * inner : 0);

  const columns: EngravedColumn[] = steps.map((step) => {
    const chord = chordAtOffset(bar, step.beat);
    const shape = chord?.shape.frets ?? null;
    // A picking step sounds one string, so only that string carries a number;
    // drawing the whole shape would say the player strummed it.
    const only = step.pluck && chord ? pluckStringOf(step.pluck, chord.shape) : 0;
    // A picked column names one string and stays silent about the rest — no
    // x's either, since nothing was muted, it simply was not played.
    const notes = notesFor(shape).filter((note) =>
      only === 0 ? true : note.string === only,
    );
    return {
      x: at(step.beat),
      notes,
      direction: step.direction,
      accent: Boolean(step.accent),
      finger: step.pluck?.finger,
    };
  });

  // A chord is named where it starts and nowhere else: a sheet that reprints
  // the same name every bar teaches the reader to stop looking at the names.
  const names: EngravedName[] = [];
  let running = carried;
  for (const slot of bar.slots) {
    const label = slot.event.chord?.shapeLabel ?? 'N.C.';
    if (running === label) continue;
    running = label;
    const first = slot.offsetBeats < 1e-6;
    names.push({
      label,
      x: first ? x + 2 : at(slot.offsetBeats),
      anchor: first ? 'start' : 'middle',
      shape: slot.event.chord?.shape ?? null,
    });
  }
  if (!names.length && !bar.slots.length && carried === undefined) {
    names.push({ label: 'N.C.', x: x + 2, anchor: 'start', shape: null });
  }

  return { index: bar.index, x, width, names, columns };
}

/**
 * How many bars fit on one line of this song.
 *
 * Derived from the song rather than fixed, because the same number cannot serve
 * both: at four bars a line a quarter-note strum leaves half the page empty,
 * and at eight an eighth-note pattern is unreadable. `targetWidth` lets a
 * caller with more paper than screen ask for more.
 */
export function barsPerSystemFor(
  beatsPerBar: number,
  strum: StrumPattern,
  targetWidth = SYSTEM_TARGET,
): number {
  const columns = strum.steps.filter((s) => s.beat < beatsPerBar).length;
  const barWidth = BAR_PAD * 2 + Math.max(beatsPerBar, columns) * COLUMN_WIDTH;
  const fit = Math.floor((targetWidth - CLEF_WIDTH) / Math.max(1, barWidth));
  return Math.max(MIN_BARS_PER_SYSTEM, Math.min(MAX_BARS_PER_SYSTEM, fit));
}

/**
 * The whole song as drawn systems.
 *
 * Every system is reported at the same `width` — the widest one — so they all
 * scale identically when drawn. A short last system leaves space at its right
 * rather than being blown up to fill the line, which is what a printed sheet
 * does and what stops the final bar of a song looking twice the size of the
 * rest. `contentWidth` is where that system's music actually ends.
 */
export function engraveSystems(
  bars: TabBar[],
  strum: StrumPattern,
  barsPerSystem?: number,
): EngravedSystem[] {
  const perSystem = barsPerSystem ?? barsPerSystemFor(bars[0]?.beats ?? 4, strum);
  const systems: EngravedSystem[] = [];
  for (let i = 0; i < bars.length; i += perSystem) {
    const group = bars.slice(i, i + perSystem);
    let x = CLEF_WIDTH;
    // Every system restates the chord it opens on, the way a printed sheet
    // does: a reader who looks away and back needs the name on the line in
    // front of them, not on the one above.
    let carried: string | undefined;
    const engraved = group.map((bar) => {
      const drawn = engraveBar(bar, strum, x, carried);
      x += drawn.width;
      const last = bar.slots[bar.slots.length - 1];
      carried = last ? (last.event.chord?.shapeLabel ?? 'N.C.') : carried;
      return drawn;
    });
    systems.push({ startBar: i, bars: engraved, width: x, contentWidth: x });
  }
  const widest = systems.reduce((max, s) => Math.max(max, s.contentWidth), 0);
  for (const system of systems) system.width = widest;
  return systems;
}

/** Convenience for callers that have a whole tab and want it drawn. */
export function engraveTab(tab: SongTab, barsPerSystem?: number): EngravedSystem[] {
  return engraveSystems(tab.bars, tab.strum, barsPerSystem);
}
