/* Turn a plain-text guitar tab into the ordered sheet the regression reads.

   The other extractor, scripts/sheets.mjs, works on engraved PDFs, where every
   chord sits at a known place in a known bar. A text tab is the other kind of
   source: six ASCII strings with chord names typed above them, no bar lines
   anywhere, and repeats written in prose. What survives that is the ORDER of
   the changes and nothing else — no bar numbers, no durations, no meter.

   That is still worth having. Order recall and its precision are the two
   position-aware numbers the corpus is scored on, and neither needs a clock:
   they align two sequences and count what lines up. What it cannot support is
   `barRatio`, the tempo-octave check, which divides detected bars by printed
   ones — so sheets from here are marked `"positions": "ordinal"` and the
   regression leaves that column empty rather than printing a number computed
   from bar positions this file invented.

     node scripts/tabsheet.mjs <tab.txt> <out.sheet.json> [--skip N] [--title T]

   A chord line is a line whose every token is a chord symbol. `--skip N` drops
   the first N of them, because a tab conventionally opens with a chords-in-use
   legend — a row of names over a row of shapes — which is a key to the piece
   rather than part of it. Look at the file and count them; there is no way to
   tell a legend from a first line of music by shape alone.

   Repeats are read from `(xN)` appearing on the chord line itself or anywhere
   in the block of tab under it, since a transcriber may write it in either
   place. A chord repeated within a line stays as written: collapsing runs is
   the scoring's job, and doing it here would throw away the difference between
   a chord struck twice and a chord held.
*/
import { readFile, writeFile } from 'node:fs/promises';

/** One token, and whether it is plausibly a chord rather than a word. */
const CHORD = /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add|M)?\d*(sus\d|add\d+|maj\d|m\d)*(\/[A-G](#|b)?)?$/;

/** A line of six ASCII strings looks like this; a line of chords does not. */
const STAFF = /^\s*[eEBGDAa]\s*\|/;

function tokensOf(line) {
  // Parentheticals are the transcriber talking — (fast), (s), (x2), (T).
  return line.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function isChordLine(line) {
  if (STAFF.test(line)) return false;
  const tokens = tokensOf(line);
  if (tokens.length === 0) return false;
  return tokens.every((token) => CHORD.test(token));
}

/**
 * How many times the block under a chord line is played.
 *
 * Looked for on the chord line and on every line down to the next chord line
 * or the next stretch of blank lines, because `(x2)` turns up under the tab as
 * often as beside the names.
 */
function repeatsAfter(lines, index) {
  let blanks = 0;
  for (let i = index; i < lines.length; i++) {
    if (i > index && isChordLine(lines[i])) break;
    if (lines[i].trim() === '') {
      if (++blanks >= 2) break;
      continue;
    }
    blanks = 0;
    const found = /\(\s*x\s*(\d+)/i.exec(lines[i]);
    if (found) return Math.max(1, Number(found[1]));
  }
  return 1;
}

export function tabToSheet(text, { skip = 0, title = null } = {}) {
  const lines = text.split(/\r?\n/);
  const chordLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (isChordLine(lines[i])) chordLines.push(i);
  }
  const symbols = [];
  for (const index of chordLines.slice(skip)) {
    const line = tokensOf(lines[index]);
    const times = repeatsAfter(lines, index);
    for (let n = 0; n < times; n++) symbols.push(...line);
  }
  return {
    title,
    // Unknown, and not guessable: a text tab has no bar lines to count into.
    meter: null,
    printedTempo: null,
    playedKey: null,
    originalKey: null,
    // Ordinal, not measured. One slot per chord written, so the sequence is
    // right and the spacing is a fiction — which is why it says so.
    positions: 'ordinal',
    totalBars: symbols.length,
    events: symbols.map((symbol, bar) => ({ bar, symbol })),
    chordLines: chordLines.length,
    skipped: skip,
  };
}

const [source, out, ...rest] = process.argv.slice(2);
if (source && out) {
  const flag = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const sheet = tabToSheet(await readFile(source, 'utf8'), {
    skip: Number(flag('--skip') ?? 0),
    title: flag('--title') ?? null,
  });
  await writeFile(out, `${JSON.stringify(sheet, null, 1)}\n`);
  const seen = sheet.events.map((e) => e.symbol);
  console.log(`${out}: ${seen.length} chords from ${sheet.chordLines} chord lines (${sheet.skipped} skipped)`);
  console.log(`  ${seen.join(' ')}`);
}
