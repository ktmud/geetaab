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
           "expect": { "freeTime": false }   // optional assertions
         }
       ]
     }

   A song with no `ref` is still analysed and still guarded for regressions —
   useful for pieces with no published chords, where the thing to protect is
   that they keep coming back free-time, or keep their confidence.

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

   `--save-baseline` writes `baseline.json` beside the manifest. Later runs
   compare against it and exit non-zero if any song has gone backwards, so this
   can gate a change to src/core the way the unit tests gate everything else.
*/
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeAudio } from '../src/core/analyze.ts';
import { chordName, isNoChord, SHARP_NAMES, FLAT_NAMES } from '../src/core/chordTypes.ts';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
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

function pitchClass(name) {
  const i = SHARP_NAMES.indexOf(name);
  if (i >= 0) return i;
  const j = FLAT_NAMES.indexOf(name);
  if (j >= 0) return j;
  throw new Error(`unknown note: ${name}`);
}

// Suffixes that land on one of the app's seven vocabulary qualities. Anything
// else (add9, 6, dim, ...) has a root and a family but no exact answer, since
// the vocabulary has no symbol for it.
const VOCAB_QUALITY = { '': 'maj', m: 'min', 7: 'dom7', m7: 'min7', maj7: 'maj7', sus4: 'sus4', sus2: 'sus2' };

function parseSymbol(text) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(text.trim());
  if (!m) throw new Error(`unparsed chord: ${text}`);
  const [, letter, accidental, rest] = m;
  const [body, bassText] = rest.split('/');
  return {
    text,
    root: pitchClass(letter + accidental),
    family: /^m(?!aj)/.test(body) ? 'min' : 'maj',
    quality: Object.hasOwn(VOCAB_QUALITY, body) ? VOCAB_QUALITY[body] : null,
    bass: bassText ? pitchClass(bassText) : undefined,
  };
}

const familyOf = (q) => (q === 'min' || q === 'min7' ? 'min' : 'maj');

function agreementAt(segments, reference, shift) {
  const families = new Set(reference.map((r) => `${(r.root + shift + 12) % 12}:${r.family}`));
  const seen = new Map();
  for (const r of reference) {
    const key = `${(r.root + shift + 12) % 12}:${r.family}`;
    if (!seen.has(key)) seen.set(key, new Set());
    if (r.quality) seen.get(key).add(r.quality);
  }
  const exact = new Map();
  for (const [key, qs] of seen) if (qs.size === 1) exact.set(key, [...qs][0]);

  let played = 0;
  let hitFamily = 0;
  let hitQuality = 0;
  const misses = new Map();
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const dur = seg.end - seg.start;
    played += dur;
    const key = `${seg.chord.root}:${familyOf(seg.chord.quality)}`;
    if (families.has(key)) {
      hitFamily += dur;
      if (exact.get(key) === seg.chord.quality) hitQuality += dur;
    } else {
      const name = chordName(seg.chord);
      misses.set(name, (misses.get(name) ?? 0) + dur);
    }
  }
  return { shift, played, hitFamily, hitQuality, misses };
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
  const path = join(corpusDir, song.file);
  if (!existsSync(path)) {
    console.error(`  missing ${song.file} — skipped`);
    continue;
  }
  const buf = await readFile(path);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const started = Date.now();
  const res = analyzeAudio(samples, song.sampleRate ?? 22050);
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

  if (song.ref) {
    const reference = song.ref.split(',').map((s) => s.trim()).filter(Boolean).map(parseSymbol);
    const shifts = song.transpose === 'auto' ? Array.from({ length: 12 }, (_, i) => i) : [0];
    const best = shifts
      .map((shift) => agreementAt(windowed, reference, shift))
      .sort((a, b) => b.hitFamily - a.hitFamily)[0];
    row.shift = best.shift;
    row.family = +((best.hitFamily / (best.played || 1)) * 100).toFixed(1);
    row.exact = +((best.hitQuality / (best.played || 1)) * 100).toFixed(1);
    row.worstMiss = [...best.misses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
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
console.log(
  `\n${pad('song', 18)}${num('family', 7)}${num('Δ', 7)}${num('exact', 7)}${num('med', 5)}${num('sand', 5)}${num('ch/min', 7)}  key`,
);
console.log('-'.repeat(80));

const regressions = [];
const expectationFailures = [];
for (const { song, row } of rows) {
  const was = baseline?.[song.id];
  const delta = was && row.family != null && was.family != null ? +(row.family - was.family).toFixed(1) : null;
  if (delta != null && delta < -TOLERANCE) regressions.push({ id: song.id, was: was.family, now: row.family, delta });
  for (const [key, want] of Object.entries(song.expect ?? {})) {
    if (row[key] !== want) expectationFailures.push(`${song.id}: ${key} is ${row[key]}, expected ${want}`);
  }
  const mark = delta == null ? '' : delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0';
  console.log(
    pad(row.title.slice(0, 17), 18) +
      num(row.family, 7) +
      num(mark, 7) +
      num(row.exact, 7) +
      num(row.medianBeats, 5) +
      num(row.sandwiched, 5) +
      num(row.changesPerMin, 7) +
      `  ${row.key}${row.freeTime ? ' · free time' : ''}${row.shift ? ` · +${row.shift}` : ''}`,
  );
}

const scored = rows.filter(({ row }) => row.family != null);
if (scored.length) {
  const mean = scored.reduce((s, { row }) => s + row.family, 0) / scored.length;
  const sand = rows.reduce((s, { row }) => s + row.sandwiched, 0);
  console.log('-'.repeat(80));
  console.log(`${pad('mean of ' + scored.length, 18)}${num(mean.toFixed(2), 7)}${num('', 7)}${num('', 7)}${num('', 5)}${num(sand, 5)}`);
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
  console.error(`REGRESSION   ${r.id}: agreement ${r.was} → ${r.now} (${r.delta})`);
}
if (regressions.length || expectationFailures.length) {
  console.error(`\n${regressions.length + expectationFailures.length} problem(s). Tolerance is ${TOLERANCE} points.`);
  process.exit(1);
}
console.log('\nNo song went backwards.');
