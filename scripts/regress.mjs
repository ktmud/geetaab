/* Run the whole corpus through the analysis and compare it against a baseline.

   The corpus is real music with published tabs, so it lives outside this
   repository and no part of it is committed. Point this at a directory of your
   own and it reads a manifest from there:

     GEETAAB_CORPUS=/path/to/corpus npx vite-node scripts/regress.mjs
     npx vite-node scripts/regress.mjs --corpus /path/to/corpus --save-baseline

   The manifest is `corpus.json` in that directory:

     {
       "songs": [
         {
           "id": "song1",
           "title": "不再让你孤单",
           "file": "song1.f32",              // raw f32 mono, see below
           "sampleRate": 22050,
           "ref": "C,Cadd11,F,G,Am,Em,E,Dm7,G/B,Am7/G,C/G",
           "transpose": "auto",              // optional
           "before": 200, "after": 250,      // optional, seconds
           "expect": { "freeTime": false },  // optional assertions
           "refTimeline": [[0, 7.44, "D#:maj"], ...],  // optional, see below
           "sheet": "sheets/song1.sheet.json",         // optional, see below
           "sheetBars": [0, 62],                       // optional bar window
           "trueTempo": 65                             // optional, BPM
         }
       ]
     }

   A song with no `ref` is still analysed and still guarded for regressions —
   useful for pieces with no published chords, where the thing to protect is
   that they keep coming back free-time, or keep their confidence.

   Three grades of reference, three grades of scoring:

   - `ref`, a bare chord VOCABULARY, supports only "is the detected chord
     anywhere in this song" (the `family`/`exact` columns). It cannot see
     position: the right four chords in a scrambled order still score 100%.
   - `sheet`, an ORDERED sheet — from an engraved PDF via scripts/sheets.mjs,
     or from a plain-text tab via scripts/tabsheet.mjs — adds order: the `order` column is the fraction of the
     sheet's chord changes recovered in playing order (order-preserving
     alignment, best transposition when `transpose` is "auto"). Read it with
     `oprec` beside it — the fraction of DETECTED changes that landed in the
     sheet — because order recall alone rewards guessing, and `oF1`, their
     harmonic mean, is the number that does not. `barRatio` is
     the median count of detected bars per matched sheet bar — it sits near 1
     on a correct beat grid and near 2 when the tempo ran double, so it is a
     tempo-octave check that needs no BPM ground truth. It is left empty for a
     sheet marked `"positions": "ordinal"`, which is what a text tab produces:
     no bar lines to count into, so the order is real and the spacing is a
     fiction. `sheetBars` windows the sheet to a bar range, for songs that
     modulate partway.
   - `refTimeline`, TIME-ALIGNED chords (Harte labels, e.g. from GuitarSet's
     .jams), supports the strictest number: `recall` is chord symbol recall on
     a 10 ms grid — the fraction of reference chord time where the detection
     names the right chord at that instant. `exactR` is the same at exact
     vocabulary level where the reference uses a symbol the app models. Either
     an inline [[start, end, label], ...] array or a path to a JSON file
     containing one (or {"chords": [...]}).

   `trueTempo` (from the annotation, or printed on the sheet) adds a tempo
   column classifying the detected BPM as =, 2x, ½x, 3/2, 2/3 or "?" of it.

   Decode audio to the raw format with ffmpeg:

     ffmpeg -i song.m4a -ac 1 -ar 22050 -f f32le song.f32

   Two entries may share one `file` with different `ref` vocabularies. That is
   worth doing where a song has more than one published transcription, because
   it measures something no single reference can: how much of a score belongs
   to the recording and how much to whoever wrote the sheet. Measured on one
   song with two editions, agreement on root and major/minor moved by 1 point
   while the exact-symbol figure moved by 21 — so the first is a property of
   the analysis and the second largely is not. The exact column drops whenever
   a sheet spells one root two ways (Am and Am7, C and Cadd11), since there is
   then no single right symbol to hit; read it as texture, not as a score.

   `--separate` and `--separate-adaptive` analyse the accompaniment from a REPET
   separation rather than the mixture, which is the experiment written up at the
   top of src/core/separation.ts. Short version: it lifts the position-blind
   vocabulary number and costs eight to seventeen points of order F1, because
   the separator's model is a median across repeats and a chord change is what
   fails to repeat. Kept so the result can be re-derived rather than believed.

   `--only <id>[,<id>]` runs one song or a few. `--save-baseline` writes
   `baseline.json` beside the manifest. Later runs
   compare against it and exit non-zero if any song has gone backwards, so this
   can gate a change to src/core the way the unit tests gate everything else.
*/
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeAudio } from '../src/core/analyze.ts';
import { separateRepet } from '../src/core/separation.ts';
import { isNoChord } from '../src/core/chordTypes.ts';
import { keyRelation } from '../src/core/key.ts';
import {
  pitchClass,
  bestShiftAlignment,
  bestShiftRecall,
  classifyTempo,
  detectedChangeSequence,
  parseHarte,
  parseSheetSymbol,
  sheetChangeSequence,
  vocabularyAgreement,
} from '../src/core/reference.ts';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const separateFirst = args.includes('--separate') || args.includes('--separate-adaptive');
// Not `windowed`: that name is already a list of segments inside the loop
// below, and shadowing it put this one in that block's temporal dead zone —
// every separation threw a ReferenceError, was caught as a refusal, and the
// arm silently reported the baseline back.
const adaptive = args.includes('--separate-adaptive');
// How many loops go into one separation window. Enough repeats for a median,
// few enough that the model follows the song rather than averaging it.
const windowLoops = Number(flag('--window-loops') ?? 6);
/** Run one song, or a few, instead of the lot. */
const only = (flag('--only') ?? '').split(',').filter(Boolean);
const corpusDir = flag('--corpus') ?? process.env.GEETAAB_CORPUS;
const saveBaseline = args.includes('--save-baseline');
/** How far a song may slip before the run fails. */
const TOLERANCE = Number(flag('--tolerance') ?? 0.5);

if (!corpusDir) {
  console.error(
    'No corpus. Set GEETAAB_CORPUS or pass --corpus <dir>.\n' +
      'The corpus is real music and is deliberately not part of this repository;\n' +
      'see the comment at the top of this file for the manifest format.',
  );
  process.exit(2);
}

const manifestPath = join(corpusDir, 'corpus.json');
if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}.`);
  process.exit(2);
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

/** Load a time-aligned reference: inline [[start,end,label]] or a JSON path. */
async function loadTimeline(spec, dir) {
  let raw = spec;
  if (typeof spec === 'string') {
    raw = JSON.parse(await readFile(join(dir, spec), 'utf8'));
  }
  if (raw && !Array.isArray(raw)) raw = raw.chords;
  return raw.map(([start, end, label]) => ({ start, end, chord: parseHarte(label) }));
}

/** Load an ordered sheet (scripts/sheets.mjs output), optionally windowed. */
async function loadSheet(path, dir, barRange) {
  const sheet = JSON.parse(await readFile(join(dir, path), 'utf8'));
  const [from, to] = barRange ?? [0, sheet.totalBars];
  const events = sheet.events
    .filter((e) => e.bar >= from && e.bar < to)
    .map((e) => ({ chord: parseSheetSymbol(e.symbol), bar: e.bar }));
  return {
    events,
    totalBars: Math.min(to, sheet.totalBars),
    meter: sheet.meter ?? 4,
    // A text tab has no bar lines, so scripts/tabsheet.mjs numbers the chords
    // one to a slot. The order is real; the spacing is not, and barRatio is
    // computed entirely from spacing.
    ordinal: sheet.positions === 'ordinal',
  };
}

/** Fragmentation: what makes a chart look chopped up even when it is right. */
function shape(res, segments) {
  const lengths = [];
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const beats = (seg.endBeat ?? 0) - (seg.startBeat ?? 0);
    if (beats > 0) lengths.push(beats);
  }
  lengths.sort((a, b) => a - b);
  const median = lengths.length ? lengths[lengths.length >> 1] : 0;
  // A brief chord between two runs of the same neighbour is almost always an
  // artifact, and is exactly what reads as over-segmentation.
  let sandwiched = 0;
  for (let i = 1; i < segments.length - 1; i++) {
    const [a, b, c] = [segments[i - 1], segments[i], segments[i + 1]];
    if (isNoChord(a.chord) || isNoChord(b.chord) || isNoChord(c.chord)) continue;
    const beats = (b.endBeat ?? 0) - (b.startBeat ?? 0);
    if (beats <= 2 && a.chord.root === c.chord.root && a.chord.quality === c.chord.quality) {
      sandwiched++;
    }
  }
  const changes = segments.filter((s) => !isNoChord(s.chord)).length;
  return {
    medianBeats: +median.toFixed(1),
    sandwiched,
    changesPerMin: res.duration > 0 ? +((changes / res.duration) * 60).toFixed(1) : 0,
  };
}

const results = {};
const rows = [];
for (const song of manifest.songs ?? []) {
  if (only.length && !only.includes(song.id)) continue;
  const path = join(corpusDir, song.file);
  if (!existsSync(path)) {
    console.error(`  missing ${song.file} — skipped`);
    continue;
  }
  const buf = await readFile(path);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const started = Date.now();
  // `--separate` runs REPET first and analyses the accompaniment rather than
  // the mixture, to answer whether pulling the voice out helps the chords. The
  // period comes from a first pass's own tempo and loop, since REPET's one
  // fragile step is finding a period and this pipeline already reports one.
  let input = samples;
  let separated = null;
  if (separateFirst) {
    const first = analyzeAudio(samples, song.sampleRate ?? 22050);
    const bar = (60 / first.tempo) * (first.beatsPerBar || 4);
    const hint = first.loop?.length ? bar * first.loop.length : bar * 4;
    const rate = song.sampleRate ?? 22050;
    try {
      if (adaptive) {
        // Adaptive REPET, roughly: plain REPET models the accompaniment as one
        // pattern for the whole song, so a chord that differs between the verse
        // and the chorus is not in the median at that phase and gets stripped
        // out with the voice. Separating a window at a time lets the model
        // follow the song instead of averaging over it.
        const span = Math.max(rate, Math.round(windowLoops * hint * rate));
        const out = new Float32Array(samples.length);
        let done = 0;
        let repeats = 0;
        let chunks = 0;
        for (let at = 0; at < samples.length; at += span) {
          const slice = samples.subarray(at, Math.min(samples.length, at + span));
          try {
            const split = separateRepet(slice, rate, { periodHint: hint });
            out.set(split.accompaniment, at);
            repeats += split.repetitions;
            done += slice.length;
          } catch {
            // A window too short to fold keeps the mixture, which is the
            // honest fallback: no separation is better than a bad one.
            out.set(slice, at);
          }
          chunks++;
        }
        input = out;
        separated = { windows: chunks, covered: +(done / samples.length).toFixed(2), repeats: Math.round(repeats / Math.max(1, chunks)) };
      } else {
        const split = separateRepet(samples, rate, { periodHint: hint });
        input = split.accompaniment;
        separated = { period: +split.periodSeconds.toFixed(2), repeats: split.repetitions };
      }
    } catch (error) {
      separated = { refused: error?.kind ?? String(error?.message ?? error) };
    }
  }
  const res = analyzeAudio(input, song.sampleRate ?? 22050);
  const seconds = (Date.now() - started) / 1000;

  const windowed = res.segments.filter(
    (s) => s.start >= (song.after ?? -Infinity) && s.start < (song.before ?? Infinity),
  );

  const row = {
    id: song.id,
    title: song.title ?? song.id,
    key: res.key.name,
    tempo: +res.tempo.toFixed(1),
    freeTime: res.freeTime,
    confidence: +res.confidence.toFixed(3),
    seconds: +seconds.toFixed(1),
    ...shape(res, windowed),
  };

  const shifts = song.transpose === 'auto' ? Array.from({ length: 12 }, (_, i) => i) : [0];

  if (song.ref) {
    const reference = song.ref.split(',').map((s) => s.trim()).filter(Boolean).map(parseSheetSymbol);
    const best = shifts
      .map((shift) => vocabularyAgreement(windowed, reference, shift))
      .sort((a, b) => b.hitFamily - a.hitFamily)[0];
    row.shift = best.shift;
    row.family = +((best.hitFamily / (best.played || 1)) * 100).toFixed(1);
    row.exact = +((best.hitQuality / (best.played || 1)) * 100).toFixed(1);
    row.worstMiss = [...best.misses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  if (song.refTimeline) {
    // Time-aligned reference: chord symbol recall on a 10 ms grid, plus the
    // old vocabulary reading of the SAME reference so the gap between "right
    // chord somewhere" and "right chord right there" stays visible.
    const timeline = await loadTimeline(song.refTimeline, corpusDir);
    const rec = bestShiftRecall(windowed, timeline, shifts);
    row.recall = +((rec.familyHit / (rec.chordTime || 1)) * 100).toFixed(1);
    row.exactR = +((rec.exactHit / (rec.exactTime || 1)) * 100).toFixed(1);
    row.recallNc = +((rec.ncTime / (rec.chordTime || 1)) * 100).toFixed(1);
    if (row.family == null) {
      const vocabMap = new Map();
      for (const iv of timeline) {
        if (iv.chord) vocabMap.set(`${iv.chord.root}:${iv.chord.family}:${iv.chord.quality}`, iv.chord);
      }
      const voc = vocabularyAgreement(windowed, [...vocabMap.values()], rec.shift);
      row.family = +((voc.hitFamily / (voc.played || 1)) * 100).toFixed(1);
      row.exact = +((voc.hitQuality / (voc.played || 1)) * 100).toFixed(1);
      row.shift = rec.shift;
    }
  }

  if (separated) {
    row.separated = separated;
    // Printed as it goes: a separation arm that silently refused every window
    // looks exactly like a baseline run, and that is a easy hour to lose.
    console.log(`  ${song.id}: ${JSON.stringify(separated)}`);
  }

  if (song.sheet) {
    // Ordered sheet: how much of the printed chord sequence comes back in
    // playing order, and how many detected bars each matched sheet bar spans
    // (near 2 when the beat grid ran double).
    const sheet = await loadSheet(song.sheet, corpusDir, song.sheetBars);
    const sheetSeq = sheetChangeSequence(sheet.events, sheet.totalBars);
    const detSeq = detectedChangeSequence(windowed);
    const align = bestShiftAlignment(sheetSeq, detSeq, shifts);
    row.order = +((align.matched.length / (sheetSeq.length || 1)) * 100).toFixed(1);
    row.orderPrec = +((align.matched.length / (detSeq.length || 1)) * 100).toFixed(1);
    // Order recall alone rewards guessing: emit twice as many changes and more
    // of the sheet's sequence is bound to be covered. Measured on this corpus,
    // dropping the decoder's change cost from 2.2 to 1.2 lifts order recall
    // from 84.2 to 86.9 while nearly quadrupling one-chord sandwiches, and
    // time-aligned recall on GuitarSet — which cannot be gamed that way,
    // because a spurious chord is wrong at every instant it covers — falls.
    // So the number to read is the harmonic mean of the two.
    row.orderF1 =
      row.order + row.orderPrec > 0
        ? +((2 * row.order * row.orderPrec) / (row.order + row.orderPrec)).toFixed(1)
        : 0;
    const ratios = align.matched
      .map(({ sheet: si, detected: di }) => {
        const bars = detSeq[di].beats / (res.beatsPerBar || 4);
        return sheetSeq[si].bars > 0 ? bars / sheetSeq[si].bars : null;
      })
      .filter((r) => r != null && Number.isFinite(r))
      .sort((a, b) => a - b);
    row.barRatio = sheet.ordinal || !ratios.length ? null : +ratios[ratios.length >> 1].toFixed(2);
    if (row.shift == null) row.shift = align.shift;

    // Slash-chord bass pass: of the slash basses the sheet prints inside
    // aligned runs, how many ring through with the right pitch class, and how
    // many detected annotations have no printed slash behind them.
    let slashRef = 0;
    let slashHit = 0;
    let slashFP = 0;
    for (const { sheet: si, detected: di } of align.matched) {
      const want = sheetSeq[si].slashBasses.map((b) => (b + align.shift + 12) % 12);
      slashRef += want.length;
      for (const b of want) if (detSeq[di].basses.has(b)) slashHit++;
      for (const pc of detSeq[di].basses.keys()) if (!want.includes(pc)) slashFP++;
    }
    const slashAll = sheetSeq.reduce((s, e) => s + e.slashBasses.length, 0);
    if (slashAll || slashFP) {
      row.slashAll = slashAll;
      row.slashRef = slashRef;
      row.slashHit = slashHit;
      row.slashFP = slashFP;
    }
  }

  if (song.trueTempo) {
    row.trueTempo = song.trueTempo;
    row.tempoClass = classifyTempo(res.tempo, song.trueTempo);
  }

  if (song.gsKey) {
    // Annotated key ("Eb:major"): classify the estimate into the MIREX-style
    // near-miss classes, so a dominant read as the tonic is visible as such.
    const [tonicName, modeName] = song.gsKey.split(':');
    row.gsKey = song.gsKey;
    row.keyClass = keyRelation(res.key, pitchClass(tonicName), modeName.trim());
  }
  results[song.id] = row;
  rows.push({ song, row });
}

const baselinePath = join(corpusDir, 'baseline.json');
const baseline = !saveBaseline && existsSync(baselinePath)
  ? JSON.parse(await readFile(baselinePath, 'utf8'))
  : null;

const pad = (v, n) => String(v ?? '—').padEnd(n);
const num = (v, n) => String(v ?? '—').padStart(n);
const TEMPO_MARK = { correct: '=', half: '1/2', double: '2x', twothirds: '2/3', threehalves: '3/2', other: '?' };
console.log(
  `\n${pad('song', 18)}${num('family', 7)}${num('Δ', 6)}${num('recall', 7)}${num('order', 7)}${num('oprec', 7)}${num('oF1', 6)}${num('bars', 6)}${num('exact', 7)}${num('med', 5)}${num('sand', 5)}${num('ch/min', 7)}${num('T', 5)}  key`,
);
console.log('-'.repeat(117));

const regressions = [];
const expectationFailures = [];
for (const { song, row } of rows) {
  const was = baseline?.[song.id];
  const delta = was && row.family != null && was.family != null ? +(row.family - was.family).toFixed(1) : null;
  if (delta != null && delta < -TOLERANCE) regressions.push({ id: song.id, metric: 'family', was: was.family, now: row.family, delta });
  // The position-aware number is gated exactly like the vocabulary one.
  const deltaR = was && row.recall != null && was.recall != null ? +(row.recall - was.recall).toFixed(1) : null;
  if (deltaR != null && deltaR < -TOLERANCE) regressions.push({ id: song.id, metric: 'recall', was: was.recall, now: row.recall, delta: deltaR });
  // A key that was exactly right must stay exactly right.
  if (was?.keyClass === 'exact' && row.keyClass && row.keyClass !== 'exact') {
    regressions.push({ id: song.id, metric: 'key', was: 'exact', now: row.keyClass, delta: '' });
  }
  for (const [key, want] of Object.entries(song.expect ?? {})) {
    if (row[key] !== want) expectationFailures.push(`${song.id}: ${key} is ${row[key]}, expected ${want}`);
  }
  const mark = delta == null ? '' : delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0';
  console.log(
    pad(row.title.slice(0, 17), 18) +
      num(row.family, 7) +
      num(mark, 6) +
      num(row.recall, 7) +
      num(row.order, 7) +
      num(row.orderPrec, 7) +
      num(row.orderF1, 6) +
      num(row.barRatio, 6) +
      num(row.exact, 7) +
      num(row.medianBeats, 5) +
      num(row.sandwiched, 5) +
      num(row.changesPerMin, 7) +
      num(row.tempoClass ? TEMPO_MARK[row.tempoClass] : '—', 5) +
      `  ${row.key}${row.keyClass ? (row.keyClass === 'exact' ? ' · key ok' : ` · KEY ${row.keyClass} (truth ${row.gsKey})`) : ''}${row.freeTime ? ' · free time' : ''}${row.shift ? ` · +${row.shift}` : ''}`,
  );
}

const scored = rows.filter(({ row }) => row.family != null);
if (scored.length) {
  const mean = scored.reduce((s, { row }) => s + row.family, 0) / scored.length;
  const recalled = rows.filter(({ row }) => row.recall != null);
  const meanRecall = recalled.length
    ? (recalled.reduce((s, { row }) => s + row.recall, 0) / recalled.length).toFixed(2)
    : null;
  const ordered = rows.filter(({ row }) => row.order != null);
  const meanOf = (key) =>
    ordered.length ? (ordered.reduce((s, { row }) => s + row[key], 0) / ordered.length).toFixed(2) : null;
  const meanOrder = meanOf('order');
  const meanPrec = meanOf('orderPrec');
  const meanF1 = meanOf('orderF1');
  const sand = rows.reduce((s, { row }) => s + row.sandwiched, 0);
  console.log('-'.repeat(117));
  console.log(
    `${pad('mean of ' + scored.length, 18)}${num(mean.toFixed(2), 7)}${num('', 6)}${num(meanRecall, 7)}${num(meanOrder, 7)}${num(meanPrec, 7)}${num(meanF1, 6)}${num('', 6)}${num('', 7)}${num('', 5)}${num(sand, 5)}`,
  );
  const slashed = rows.filter(({ row }) => row.slashAll != null);
  if (slashed.length) {
    const t = (k) => slashed.reduce((s, { row }) => s + (row[k] ?? 0), 0);
    console.log(
      `slash basses: ${t('slashHit')} heard of ${t('slashRef')} aligned ` +
        `(${t('slashAll')} printed in the sheets), ${t('slashFP')} annotated with no slash printed`,
    );
  }
  const tempoed = rows.filter(({ row }) => row.tempoClass);
  if (tempoed.length) {
    const counts = {};
    for (const { row } of tempoed) counts[row.tempoClass] = (counts[row.tempoClass] ?? 0) + 1;
    console.log(
      `tempo vs truth (${tempoed.length} songs): ` +
        Object.entries(counts)
          .map(([k, v]) => `${TEMPO_MARK[k]} ${v}`)
          .join('  '),
    );
  }
  const keyed = rows.filter(({ row }) => row.keyClass);
  if (keyed.length) {
    const counts = {};
    for (const { row } of keyed) counts[row.keyClass] = (counts[row.keyClass] ?? 0) + 1;
    // MIREX weighting as mir_eval applies it: only the fifth ABOVE gets the
    // 0.5 near-miss credit; the subdominant counts as a plain error.
    const MIREX_WEIGHT = { exact: 1, fifthUp: 0.5, fifthDown: 0, relative: 0.3, parallel: 0.2, other: 0 };
    const weighted = keyed.reduce((s, { row }) => s + MIREX_WEIGHT[row.keyClass], 0) / keyed.length;
    console.log(
      `key vs truth (${keyed.length} songs): ` +
        ['exact', 'fifthUp', 'fifthDown', 'relative', 'parallel', 'other']
          .filter((k) => counts[k])
          .map((k) => `${k} ${counts[k]}`)
          .join('  ') +
        `  ·  MIREX ${weighted.toFixed(4)}`,
    );
  }
}

if (saveBaseline) {
  await writeFile(baselinePath, JSON.stringify(results, null, 2) + '\n');
  console.log(`\nBaseline written to ${baselinePath}.`);
  process.exit(0);
}

if (!baseline) {
  console.log('\nNo baseline yet. Run again with --save-baseline to record this as the reference.');
  process.exit(0);
}

for (const line of expectationFailures) console.error(`EXPECTATION  ${line}`);
for (const r of regressions) {
  console.error(`REGRESSION   ${r.id}: ${r.metric} ${r.was} → ${r.now} (${r.delta})`);
}
if (regressions.length || expectationFailures.length) {
  console.error(`\n${regressions.length + expectationFailures.length} problem(s). Tolerance is ${TOLERANCE} points.`);
  process.exit(1);
}
console.log('\nNo song went backwards.');
