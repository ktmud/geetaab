import type { StrumPattern } from './arrange';
import { pluckStringOf } from './pick';
import type { SongTab, TabBar } from './tab';

/** Display order for tablature: high E on top, as it is written on paper. */
const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'];

function chordAtOffset(bar: TabBar, offsetBeats: number) {
  for (const slot of bar.slots) {
    if (offsetBeats >= slot.offsetBeats - 1e-6 && offsetBeats < slot.offsetBeats + slot.beats - 1e-6) {
      return slot.event.chord;
    }
  }
  return bar.slots.length ? bar.slots[bar.slots.length - 1].event.chord : null;
}

export interface BarTab {
  /** Six rows, high E first, each already padded to the same width. */
  rows: string[];
  /** Strum directions, aligned under the rows. */
  directions: string;
  /** Chord names, aligned over the rows. */
  names: string;
}

/**
 * Six-line tablature for one bar under a strumming pattern.
 *
 * Every column is one strum, so the tab shows rhythm as well as pitch — which
 * is the part a chord chart alone leaves out and beginners most often get
 * wrong. Rhythm means spacing as well as order: a stroke lasts until the next
 * one, so the eighths a pattern does not strike are not silence but the chord
 * ringing on, and a column that rings for a quarter sits twice as far from
 * its neighbour as one that rings for an eighth. Columns of equal width would
 * say every stroke is worth the same, which of D · D U · U D U is not true of
 * a single one.
 */
export function barTab(bar: TabBar, strum: StrumPattern): BarTab {
  const steps = strum.steps.filter((s) => s.beat < bar.beats);
  const columns = steps.map((step) => {
    const chord = chordAtOffset(bar, step.beat);
    // A picking step sounds one string; only that string carries a fret, or
    // the tab would read as a full strum on every eighth.
    const only = step.pluck && chord ? 6 - pluckStringOf(step.pluck, chord.shape) : -1;
    const cells = chord
      ? chord.shape.frets.map((f, i) =>
          f < 0 ? 'x' : only >= 0 && i !== only ? '-' : String(f),
        )
      : new Array(6).fill('-');
    return { cells, step, chord };
  });

  const width = Math.max(1, ...columns.flatMap((c) => c.cells.map((cell) => cell.length)));
  const pad = (text: string): string => text.padStart(Math.floor((width - text.length) / 2) + text.length, '-').padEnd(width, '-');

  // How long each stroke rings, in eighths, and therefore how much room the
  // bar gives it: one eighth is a column and its two separators.
  const gaps = columns.map((c, i) => {
    const until = i + 1 < columns.length ? columns[i + 1].step.beat : bar.beats;
    const eighths = Math.max(1, Math.round((until - c.step.beat) * 2));
    return (i + 1 < columns.length ? 2 : 0) + (eighths - 1) * (width + 2);
  });
  const weave = (cells: string[], filler: string): string =>
    cells.map((cell, i) => cell + filler.repeat(gaps[i])).join('');

  const rows = STRING_LABELS.map((label, displayIndex) => {
    const stringIndex = 5 - displayIndex; // rows run high E to low E
    return `${label}|-${weave(columns.map((c) => pad(c.cells[stringIndex])), '-')}-|`;
  });

  const prefix = ' '.repeat(STRING_LABELS[0].length + 2);
  const directions = prefix + weave(columns.map((c) => center(c.step.direction, width)), ' ') + ' ';
  const names =
    prefix +
    weave(
      columns.map((c, i) => {
        const previous = i > 0 ? columns[i - 1].chord : null;
        const changed = i === 0 || c.chord?.label !== previous?.label;
        return center(changed ? (c.chord?.label ?? 'N.C.') : '', width);
      }),
      ' ',
    ) +
    ' ';

  return { rows, directions, names };
}

function center(text: string, width: number): string {
  if (text.length >= width) return text;
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - text.length - left);
}

export interface TabSystem {
  /** Which bars the system covers, e.g. "Bars 5–6", for the plain-text export. */
  label: string;
  /** The bars rendered side by side: names, six strings, directions. */
  text: string;
  /** Index of the system's first bar. */
  startBar: number;
  /** How many bars are on this line, so a caller can word its own label. */
  bars: number;
}

/**
 * The whole song's tablature as printable systems, a few bars to a line.
 *
 * One bar per system reads fine on a phone but turns a three-minute song into
 * seven pages of paper; side-by-side bars are how printed tab has always
 * managed the length.
 */
export function tabSystems(bars: TabBar[], strum: StrumPattern, barsPerSystem = 2): TabSystem[] {
  const systems: TabSystem[] = [];
  for (let i = 0; i < bars.length; i += barsPerSystem) {
    const group = bars.slice(i, i + barsPerSystem);
    const rendered = group.map((bar) => {
      const r = barTab(bar, strum);
      const lines = [r.names, ...r.rows, r.directions];
      const width = Math.max(...lines.map((line) => line.length));
      return lines.map((line) => line.padEnd(width, ' '));
    });
    const lines: string[] = [];
    for (let line = 0; line < 8; line++) {
      lines.push(rendered.map((r) => r[line]).join('  ').trimEnd());
    }
    systems.push({
      label: group.length > 1 ? `Bars ${i + 1}–${i + group.length}` : `Bar ${i + 1}`,
      text: lines.join('\n'),
      startBar: i,
      bars: group.length,
    });
  }
  return systems;
}

/** The prose in the exported text, so it can follow the interface language. */
export interface TabTextLabels {
  /** Label separator, which is full-width in Chinese. */
  colon: string;
  key: string;
  tempo: string;
  capo: string;
  capoFret: (fret: number, key: string) => string;
  capoNone: string;
  strum: string;
  /** The chosen pattern's name, already in the reader's language. */
  strumName: string;
  /** Key names are spelled differently in each language. */
  translateKey: (name: string) => string;
  chordsYouNeed: string;
  inPlaceOf: (chord: string) => string;
  loop: (bars: number, percent: number) => string;
  chordChart: string;
  tablature: string;
  foot: string;
}

const EN_LABELS: TabTextLabels = {
  colon: ': ',
  key: 'Key',
  tempo: 'Tempo',
  capo: 'Capo',
  capoFret: (fret, key) => `fret ${fret} (play in ${key})`,
  capoNone: 'none',
  strum: 'Strum',
  strumName: '',
  translateKey: (name) => name,
  chordsYouNeed: 'Chords you need',
  inPlaceOf: (chord) => `(in place of ${chord})`,
  loop: (bars, percent) => `The loop (${bars} bars, ${percent}% of the song)`,
  chordChart: 'Chord chart',
  tablature: 'Tablature (one time through)',
  foot: 'Generated by Geetaab. Chords are a machine transcription — trust your ears over them.',
};

/**
 * The whole tab as plain text, for pasting anywhere.
 *
 * Chord charts live in forum posts and notes apps far more than in any one
 * tool, so the output has to survive being copied out of this one.
 */
export function songTabText(tab: SongTab, title: string, labels?: TabTextLabels): string {
  const l = labels ?? { ...EN_LABELS, strumName: tab.strum.name };
  const rule = (text: string): string => '-'.repeat(Math.max(4, [...text].length));
  const lines: string[] = [];
  lines.push(title);
  lines.push('='.repeat(Math.max(4, title.length)));
  lines.push('');
  lines.push(`${l.key}${l.colon}${l.translateKey(tab.key.name)}`);
  lines.push(`${l.tempo}${l.colon}${Math.round(tab.tempo)} BPM, ${tab.beatsPerBar}/4`);
  lines.push(
    `${l.capo}${l.colon}${
      tab.capo > 0 ? l.capoFret(tab.capo, l.translateKey(tab.shapeKeyName)) : l.capoNone
    }`,
  );
  lines.push(`${l.strum}${l.colon}${l.strumName}`);
  lines.push('');

  if (tab.palette.length) {
    lines.push(l.chordsYouNeed);
    lines.push(rule(l.chordsYouNeed));
    for (const chord of tab.palette) {
      const frets = chord.shape.frets.map((f) => (f < 0 ? 'x' : String(f))).join(' ');
      const sub = chord.substitutedFrom ? `  ${l.inPlaceOf(chord.label)}` : '';
      lines.push(`  ${chord.shapeLabel.padEnd(7)} ${frets}${sub}`);
    }
    lines.push('');
  }

  if (tab.loop) {
    lines.push(l.loop(tab.loop.length, Math.round(tab.loop.coverage * 100)));
    lines.push('  | ' + tab.loop.bars.join(' | ') + ' |');
    lines.push('');
  }

  lines.push(l.chordChart);
  lines.push(rule(l.chordChart));
  const perLine = 4;
  for (let i = 0; i < tab.bars.length; i += perLine) {
    const group = tab.bars.slice(i, i + perLine);
    lines.push(
      `${String(i + 1).padStart(3)}  ` +
        group.map((bar) => '| ' + (bar.signature || 'N.C.').padEnd(16)).join('') +
        '|',
    );
  }
  lines.push('');

  const sample = tab.bars.slice(0, Math.min(tab.bars.length, tab.loop?.length ?? 4));
  if (sample.length) {
    lines.push(l.tablature);
    lines.push(rule(l.tablature));
    for (const bar of sample) {
      const rendered = barTab(bar, tab.strum);
      lines.push(rendered.names);
      lines.push(...rendered.rows);
      lines.push(rendered.directions);
      lines.push('');
    }
  }

  lines.push(l.foot);
  return lines.join('\n');
}
