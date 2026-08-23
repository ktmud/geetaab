/* Recover the ordered, bar-positioned chord sequence from a published tab PDF.

   Targets one widespread engraved-tab layout, described here by what it puts
   on the page rather than by who produced it: each system prints its chord
   symbols in a row above the TAB block, at the x where the change lands, with
   a small bar number at the system's left edge. `pdftotext -bbox` emits every
   word with its box; from that the playing order is exact, and bar positions
   follow from the bar numbers plus each chord's horizontal position.

     npx vite-node scripts/sheets.mjs song.pdf [more.pdf ...] [--out <dir>]

   Writes <out>/<basename>.sheet.json:

     {
       "title": "<whatever the sheet's own title line says>",
       "meter": 4, "playedKey": "C", "originalKey": "E", "printedTempo": null,
       "totalBars": 118,
       "events": [{ "bar": 0, "symbol": "C" }, ...]   // bar is 0-based, fractional
     }

   The scoring side (scripts/regress.mjs, scripts/score.mjs) compares these
   events against the transcription by order-preserving alignment; a corpus
   manifest entry points at the file with `"sheet": "<name>.sheet.json"`.

   The heuristics, and the layout facts each one rests on:
   - Chord symbols all share one glyph height (≈11.3 pt at letter size), while
     lyric text and the numbered-notation row are ≈13.2 pt and the title ≈20 pt.
     The modal height of the chord-parseable words is therefore enough to tell
     a chord symbol from an English lyric that happens to read as one — "A",
     "Am", "Look" — which no amount of spelling rules would settle.
   - Bar numbers are small digits to the left of the TAB block (xMin ≈ 98);
     the numbered-notation digits start ≈ 106 and TAB fret digits sit further
     right again, so a left-edge cut plus clustering on (x, height) separates
     them from stray digits such as a printed capo position.
   - A metadata header line, when present, gives metre, tempo and key; its bare
     key letters are kept out of the chord scan by their glyph height.
   Needs pdftotext (poppler) on PATH. A PDF laid out some other way — plain
   chords over lyrics, say — is out of scope, and fails loudly rather than
   guessing at it. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseSheetSymbol } from '../src/core/reference.ts';

const run = promisify(execFile);

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : '.';
const pdfs = args.filter((a, i) => a !== '--out' && i !== outIdx + 1);
if (pdfs.length === 0) {
  console.error('usage: vite-node scripts/sheets.mjs <pdf...> [--out <dir>]');
  process.exit(1);
}

/** Parse pdftotext -bbox output into words with boxes, per page. */
function parseBbox(xml) {
  const pages = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  let pm;
  while ((pm = pageRe.exec(xml))) {
    const words = [];
    let wm;
    while ((wm = wordRe.exec(pm[3]))) {
      const [, x0, y0, x1, y1, raw] = wm;
      const text = raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#34;|&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .trim();
      if (!text) continue;
      words.push({ x0: +x0, y0: +y0, x1: +x1, y1: +y1, h: +y1 - +y0, text });
    }
    pages.push({ width: +pm[1], height: +pm[2], words });
  }
  const title = /<title>([^<]*)<\/title>/.exec(xml)?.[1] ?? null;
  return { pages, title };
}

function tryChord(text) {
  // Strip trailing punctuation an engraver sometimes attaches.
  const cleaned = text.replace(/[.,;]+$/, '');
  if (!/^[A-G][#b]?[A-Za-z0-9#/+()-]*$/.test(cleaned)) return null;
  try {
    return { symbol: cleaned, parsed: parseSheetSymbol(cleaned) };
  } catch {
    return null;
  }
}

/** Header metadata: the value is the nearest word to the label's right on the same line. */
function headerValue(words, label) {
  const lab = words.find((w) => w.text === label);
  if (!lab) return null;
  const right = words
    .filter((w) => w !== lab && Math.abs(w.y0 - lab.y0) < 3 && w.x0 > lab.x1 && w.x0 - lab.x1 < 30)
    .sort((a, b) => a.x0 - b.x0)[0];
  return right?.text ?? null;
}

async function extract(pdf) {
  const { stdout } = await run('pdftotext', ['-bbox', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 });
  const { pages, title } = parseBbox(stdout);

  const page1 = pages[0]?.words ?? [];
  const meterText = headerValue(page1, '拍号');
  const tempoText = headerValue(page1, '拍速');
  const playedKey = headerValue(page1, '选调');
  const originalKey = headerValue(page1, '原唱调');
  if (!meterText && !playedKey) {
    throw new Error(
      `${pdf}: no metadata header (拍号/选调) found — a layout this extractor does not know`,
    );
  }

  // Every chord-parseable word, with its height; the modal height is the
  // chord font, which separates real symbols from lyric words like "A".
  const candidates = [];
  pages.forEach((page, pageIdx) => {
    for (const w of page.words) {
      const c = tryChord(w.text);
      if (c) candidates.push({ ...w, ...c, page: pageIdx });
    }
  });
  const heightCounts = new Map();
  for (const c of candidates) {
    const key = Math.round(c.h * 2) / 2;
    heightCounts.set(key, (heightCounts.get(key) ?? 0) + 1);
  }
  const modalHeight = [...heightCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const chords = candidates.filter((c) => Math.abs(c.h - modalHeight) <= 0.75);

  // Bar numbers: small digits at the left edge of each system. Their glyph
  // height sits below the jianpu and TAB digit fonts, which is what separates
  // a bar number at x=91 from a fret digit at the same x.
  const markCandidates = [];
  pages.forEach((page, pageIdx) => {
    for (const w of page.words) {
      if (!/^\d{1,3}$/.test(w.text)) continue;
      if (w.h > 11 || w.x0 < 80 || w.x0 > 106) continue;
      markCandidates.push({ page: pageIdx, y: w.y0, x0: w.x0, x1: w.x1, h: w.h, n: Number(w.text) });
    }
  });
  // Real bar numbers share one exact x and glyph height per sheet; stray
  // digits (capo notes, annotations) land near the edge but in another font
  // or a few points off. Keep only the modal (x, height) cluster.
  const clusterCounts = new Map();
  for (const m of markCandidates) {
    const key = `${Math.round(m.x0)}:${Math.round(m.h * 2) / 2}`;
    clusterCounts.set(key, (clusterCounts.get(key) ?? 0) + 1);
  }
  const modalKey = [...clusterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const [modalX, modalH] = (modalKey ?? '0:0').split(':').map(Number);
  const barMarks = markCandidates.filter(
    (m) => Math.abs(m.x0 - modalX) <= 1.5 && Math.abs(m.h - modalH) <= 0.5,
  );
  barMarks.sort((a, b) => a.page - b.page || a.y - b.y);
  if (barMarks.length === 0) throw new Error(`${pdf}: no bar numbers found`);

  // Chord rows: group by page and y.
  const rows = new Map();
  for (const c of chords) {
    const key = `${c.page}:${Math.round(c.y0)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(c);
  }

  // Each chord row belongs to the first bar mark below it on the same page.
  // A system's bar count is the gap to the next printed number; its x extent
  // runs from just right of the bar number to the sheet's content edge.
  // Playing order and absolute bar positions come from GEOMETRY (page, then
  // y), accumulated system by system: printed numbers only supply each
  // system's bar count, so a sheet whose numbering restarts partway (a second
  // vocal part, an outro numbered from 1) stays in order instead of folding
  // onto the front.
  const rightEdge = Math.max(...chords.map((c) => c.x1), 560);
  const systems = barMarks.map((m, i) => {
    const next = barMarks[i + 1];
    return {
      page: m.page,
      y: m.y,
      printed: m.n,
      bars: next && next.n > m.n ? next.n - m.n : null,
      left: m.x1 + 4,
      right: rightEdge,
      chords: [],
    };
  });
  // A system with no forward gap (the last one, or one before a numbering
  // restart) gets the median bar count; the engraver keeps systems even.
  const known = systems.map((s) => s.bars).filter((b) => b);
  known.sort((a, b) => a - b);
  const medianBars = known[known.length >> 1] ?? 4;
  for (const s of systems) if (!s.bars) s.bars = medianBars;
  let running = 0;
  for (const s of systems) {
    s.barStart = running + 1;
    running += s.bars;
  }

  let orphaned = 0;
  for (const [, rowChords] of rows) {
    rowChords.sort((a, b) => a.x0 - b.x0);
    const first = rowChords[0];
    const sys = systems.find(
      (s) => s.page === first.page && s.y > first.y0 && s.y - first.y0 < 130,
    );
    if (!sys) {
      orphaned += rowChords.length;
      continue;
    }
    sys.chords.push(...rowChords);
  }

  const events = [];
  for (const sys of systems) {
    sys.chords.sort((a, b) => a.x0 - b.x0);
    const width = Math.max(1, sys.right - sys.left);
    for (const c of sys.chords) {
      const frac = Math.min(0.999, Math.max(0, (c.x0 - sys.left) / width));
      events.push({ bar: +(sys.barStart - 1 + frac * sys.bars).toFixed(2), symbol: c.symbol });
    }
  }
  events.sort((a, b) => a.bar - b.bar);

  // Where the printed numbering restarts (kept for the human reading the
  // output — the cumulative bar positions above already absorb it).
  const gaps = [];
  for (let i = 1; i < barMarks.length; i++) {
    if (barMarks[i].n <= barMarks[i - 1].n) gaps.push(`${barMarks[i - 1].n}->${barMarks[i].n}`);
  }

  const totalBars = running;
  return {
    title,
    meter: meterText ? Number(meterText.split('/')[0]) || 4 : 4,
    printedTempo: tempoText && /^\d+$/.test(tempoText) ? Number(tempoText) : null,
    playedKey,
    originalKey,
    totalBars,
    systems: systems.length,
    orphanedChords: orphaned,
    barNumberGaps: gaps,
    events,
  };
}

await mkdir(outDir, { recursive: true });
let failed = 0;
for (const pdf of pdfs) {
  try {
    const sheet = await extract(pdf);
    const name = basename(pdf).replace(/\.pdf$/i, '') + '.sheet.json';
    await writeFile(join(outDir, name), JSON.stringify(sheet, null, 1) + '\n');
    const uniq = new Set(sheet.events.map((e) => e.symbol));
    console.log(
      `${basename(pdf)}: "${sheet.title}" ${sheet.totalBars} bars, ${sheet.systems} systems, ` +
        `${sheet.events.length} chord events (${uniq.size} distinct), meter ${sheet.meter}/4` +
        (sheet.printedTempo ? `, printed tempo ${sheet.printedTempo}` : '') +
        (sheet.playedKey ? `, played in ${sheet.playedKey}` : '') +
        (sheet.originalKey ? ` (original ${sheet.originalKey})` : '') +
        (sheet.orphanedChords ? `  [WARN ${sheet.orphanedChords} chords matched no system]` : '') +
        (sheet.barNumberGaps.length ? `  [printed numbering restarts at: ${sheet.barNumberGaps.join(' ')}]` : ''),
    );
    console.log(`  -> ${join(outDir, name)}`);
  } catch (err) {
    failed++;
    console.error(`${basename(pdf)}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
