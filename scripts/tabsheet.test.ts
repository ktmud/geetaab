import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain script, imported for the one pure function in it.
import { tabToSheet } from './tabsheet.mjs';

/**
 * A tab in the shape the extractor has to survive, invented for the test: a
 * chords-in-use legend, a line of music with names over it, a repeat written
 * under the staff rather than beside the names, and a repeat written in prose
 * with a sentence trailing off after it.
 */
const TAB = `[A Piece]

Chords in use:

   G6     C   Cadd9  Dm    A/D    G
e|--x-----0-----0-----1-----x-----3-----|
B|--0-----1-----3-----3-----x-----3-----|

The song:

   Dm  C   G6
e|-0-1-3-6---5---|
B|-0----------- -|

   G6 C A/D
e|-------------|
G|-----2---0---| (x2)

Then just strumming:

G6  C  Dm  (x3, but with alternate timing at the end)

G6  C  G
`;

describe('tabToSheet', () => {
  it('reads the chords in playing order, legend dropped', () => {
    const sheet = tabToSheet(TAB, { skip: 1 });
    expect(sheet.events.map((e: { symbol: string }) => e.symbol).join(' ')).toBe(
      'Dm C G6 G6 C A/D G6 C A/D G6 C Dm G6 C Dm G6 C Dm G6 C G',
    );
  });

  it('finds a repeat written under the staff and one written in prose', () => {
    const symbols = tabToSheet(TAB, { skip: 1 }).events.map((e: { symbol: string }) => e.symbol);
    // (x2) under the tab: two G6 C A/D. (x3) in prose: three G6 C Dm.
    expect(symbols.filter((s: string) => s === 'A/D')).toHaveLength(2);
    expect(symbols.filter((s: string) => s === 'Dm')).toHaveLength(4);
  });

  it('keeps a legend when it is not skipped, so the flag is the only guard', () => {
    expect(tabToSheet(TAB, { skip: 0 }).chordLines).toBe(5);
    expect(tabToSheet(TAB, { skip: 1 }).events.length).toBeLessThan(
      tabToSheet(TAB, { skip: 0 }).events.length,
    );
  });

  it('says its positions are ordinal, because a text tab has no bars', () => {
    const sheet = tabToSheet(TAB, { skip: 1 });
    expect(sheet.positions).toBe('ordinal');
    expect(sheet.meter).toBeNull();
    expect(sheet.totalBars).toBe(sheet.events.length);
    expect(sheet.events.map((e: { bar: number }) => e.bar)).toEqual(
      sheet.events.map((_: unknown, i: number) => i),
    );
  });

  it('is not fooled by a staff line or by an aside in brackets', () => {
    const sheet = tabToSheet('e|--0--3--|\n  (fast)\n  C G\n', { skip: 0 });
    expect(sheet.events.map((e: { symbol: string }) => e.symbol)).toEqual(['C', 'G']);
  });
});
