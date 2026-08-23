import { describe, expect, it } from 'vitest';
import {
  barsPerSystemFor,
  engraveBar,
  engraveSystems,
  stringY,
  CLEF_WIDTH,
  STRING_GAP,
  METRICS,
} from './tabEngrave';
import { patternsFor, type PlayableChord, type StrumPattern } from './arrange';
import { easiestShape } from './shapes';
import { pluckStringOf } from './pick';
import type { ChordQuality } from '../core/chordTypes';
import type { TabBar, TabEvent } from './tab';

function chord(root: number, quality: ChordQuality, label: string): PlayableChord {
  const shape = easiestShape({ root, quality });
  if (!shape) throw new Error(`no shape for ${label}`);
  return {
    sounding: { root, quality },
    shapeChord: { root, quality },
    shape,
    label,
    shapeLabel: label,
  };
}

/** One bar holding the given chords, split evenly across its beats. */
function bar(index: number, beats: number, chords: PlayableChord[]): TabBar {
  const each = beats / chords.length;
  const slots = chords.map((c, i) => {
    const event: TabEvent = {
      chord: c,
      startBeat: index * beats + i * each,
      endBeat: index * beats + (i + 1) * each,
      startTime: 0,
      endTime: 0,
      numeral: null,
    };
    return { event, offsetBeats: i * each, beats: each };
  });
  return {
    index,
    startBeat: index * beats,
    beats,
    startTime: 0,
    endTime: 0,
    slots,
    signature: chords.map((c) => c.label).join(' '),
  };
}

const patternById = (id: string): StrumPattern => {
  const found = patternsFor(4).find((p) => p.id === id);
  if (!found) throw new Error(`no pattern ${id}`);
  return found;
};

describe('the tablature staff', () => {
  it('puts the high E on top and the low E at the bottom, as it is written on paper', () => {
    expect(METRICS.stringLabels[0]).toBe('e');
    expect(stringY(1)).toBe(0);
    expect(stringY(6)).toBe(STRING_GAP * 5);
    expect(METRICS.stringLabels).toHaveLength(6);
  });
});

describe('engraveBar', () => {
  const C = chord(0, 'maj', 'C');
  const G = chord(7, 'maj', 'G');

  it('gives a bar the width its own content needs', () => {
    const quarters = engraveBar(bar(0, 4, [C]), patternById('quarters'), 0);
    const eighths = engraveBar(bar(0, 4, [C]), patternById('eighths'), 0);
    // Eight strums really is twice the writing of four, so the bar holding them
    // is wider. Forcing both into one width is what leaves a printed line half
    // empty on the sparse songs and unreadable on the busy ones.
    expect(eighths.columns.length).toBeGreaterThan(quarters.columns.length);
    expect(eighths.width).toBeGreaterThan(quarters.width);
    const xs = quarters.columns.map((c) => c.x);
    const gaps = xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(4));
    expect(new Set(gaps).size).toBe(1);
  });

  it('keeps every column inside its own bar', () => {
    const drawn = engraveBar(bar(3, 4, [C, G]), patternById('eighths'), 120);
    expect(drawn.x).toBe(120);
    for (const column of drawn.columns) {
      expect(column.x).toBeGreaterThanOrEqual(drawn.x);
      expect(column.x).toBeLessThanOrEqual(drawn.x + drawn.width);
    }
  });

  it('writes a strummed chord on all six strings, muted ones included', () => {
    // C is x 3 2 0 1 0: the muted low E has to say so, or the reader strums it.
    const drawn = engraveBar(bar(0, 4, [C]), patternById('quarters'), 0);
    const first = drawn.columns[0];
    expect(first.notes).toHaveLength(6);
    expect(first.notes.find((n) => n.string === 6)?.fret).toBe(-1);
    expect(first.notes.map((n) => n.string).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('writes a picked column on the one string it plucks, and no other', () => {
    const pattern = patternById('pick-53231323');
    const drawn = engraveBar(bar(0, 4, [G]), pattern, 0);
    expect(drawn.columns).toHaveLength(pattern.steps.length);
    for (const [i, column] of drawn.columns.entries()) {
      expect(column.notes).toHaveLength(1);
      expect(column.notes[0].string).toBe(pluckStringOf(pattern.steps[i].pluck!, G.shape));
      expect(column.notes[0].fret).toBeGreaterThanOrEqual(0);
      expect(column.finger).toBe(pattern.steps[i].pluck!.finger);
    }
    // G is rooted on the sixth string; the thumb must land there, not on C's fifth.
    expect(drawn.columns[0].notes[0].string).toBe(6);
  });

  it('does not restate a chord that is still ringing from the bar before', () => {
    const drawn = engraveBar(bar(1, 4, [C]), patternById('quarters'), 60, 'C');
    expect(drawn.names).toEqual([]);
    // ...but a different chord is announced, box and all.
    const changed = engraveBar(bar(1, 4, [G]), patternById('quarters'), 60, 'C');
    expect(changed.names.map((n) => n.label)).toEqual(['G']);
    expect(changed.names[0].shape).toBe(G.shape);
  });

  it('names a chord once where it starts, not once per column', () => {
    const drawn = engraveBar(bar(0, 4, [C, G]), patternById('eighths'), 0);
    expect(drawn.names.map((n) => n.label)).toEqual(['C', 'G']);
    expect(drawn.names[1].x).toBeGreaterThan(drawn.names[0].x);
    expect(drawn.names[0].x).toBeGreaterThanOrEqual(drawn.x);
    // The name on the bar line is set from it; one mid-bar is centred over it.
    expect(drawn.names[0].anchor).toBe('start');
    expect(drawn.names[1].anchor).toBe('middle');
  });

  it('says N.C. for a bar with nothing in it', () => {
    const empty: TabBar = { ...bar(0, 4, []), slots: [], signature: '' };
    const drawn = engraveBar(empty, patternById('quarters'), 0);
    expect(drawn.names).toEqual([
      { label: 'N.C.', x: expect.any(Number), anchor: 'start', shape: null },
    ]);
    for (const column of drawn.columns) expect(column.notes).toHaveLength(0);
  });
});

describe('engraveSystems', () => {
  const C = chord(0, 'maj', 'C');

  it('lays bars end to end with no gap and no overlap', () => {
    const bars = [0, 1, 2, 3].map((i) => bar(i, 4, [C]));
    const systems = engraveSystems(bars, patternById('quarters'), 2);
    expect(systems.every((s) => s.width === systems[0].width)).toBe(true);
    expect(systems).toHaveLength(2);
    for (const system of systems) {
      expect(system.bars[0].x).toBe(CLEF_WIDTH);
      for (let i = 1; i < system.bars.length; i++) {
        expect(system.bars[i].x).toBe(system.bars[i - 1].x + system.bars[i - 1].width);
      }
      const last = system.bars[system.bars.length - 1];
      expect(system.contentWidth).toBe(last.x + last.width);
    }
    expect(systems[1].startBar).toBe(2);
    expect(systems[1].bars.map((b) => b.index)).toEqual([2, 3]);
  });

  it('fits more bars on a line when the bars are sparser', () => {
    // The complaint this answers: a fixed two bars a line leaves a quarter-note
    // strum with half a page of white space.
    const sparse = barsPerSystemFor(4, patternById('quarters'));
    const busy = barsPerSystemFor(4, patternById('eighths'));
    expect(sparse).toBeGreaterThanOrEqual(6);
    expect(busy).toBeGreaterThanOrEqual(2);
    expect(sparse).toBeGreaterThan(busy);
    // Paper is wider than a phone and gets more of them.
    expect(barsPerSystemFor(4, patternById('eighths'), 900)).toBeGreaterThan(busy);
  });

  it('keeps every system the same drawing width so they scale alike', () => {
    // A four-bar song laid out three to a line: the second system holds one bar
    // and must not be blown up to the size of the first.
    const bars = [0, 1, 2, 3].map((i) => bar(i, 4, [C]));
    const systems = engraveSystems(bars, patternById('quarters'), 3);
    expect(systems).toHaveLength(2);
    expect(systems[1].width).toBe(systems[0].width);
    expect(systems[1].contentWidth).toBeLessThan(systems[0].contentWidth);
  });

  it('leaves room for the string letters before the first bar', () => {
    const systems = engraveSystems([bar(0, 4, [C])], patternById('quarters'), 2);
    expect(systems[0].bars[0].x).toBeGreaterThan(0);
    expect(METRICS.clefWidth).toBe(CLEF_WIDTH);
  });
});
