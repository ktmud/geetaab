/* Score a transcription against a published chord sheet.

   The question a player actually has is "if I follow this tab, is my hand on
   the right chord?" — not "does the symbol match character for character".
   A book that writes Cadd11 and a transcriber that writes C put the same
   fingers down; a book that writes E and a transcriber that writes Em do not.
   So the primary number here is time-weighted agreement on root and triad
   family, with the stricter and looser readings reported alongside it.

     ffmpeg -i song.m4a -ac 1 -ar 22050 -f f32le song.f32
     npx vite-node scripts/score.mjs song.f32 22050 --ref "C,Cadd11,F,G,Am,Em,E,Dm7,G/B,Am7/G,C/G"
     npx vite-node scripts/score.mjs song.f32 22050 --ref-timeline song.chords.json
     npx vite-node scripts/score.mjs song.f32 22050 --ref "..." --sheet song.sheet.json

   --ref is the chord vocabulary of the reference sheet. Slash chords may be
   written either way round; the bass note is kept as an alternative root so a
   G/B read as a B-rooted chord counts as near, not wrong. Vocabulary scoring
   cannot see position — a scrambled order still scores perfectly — so when a
   stronger reference exists, pass it too:

   --ref-timeline <json> scores time-aligned chords ([[start,end,"D#:maj"],..]
   or {"chords":[...]}, Harte labels as in GuitarSet's .jams) as chord symbol
   recall on a 10 ms grid — the right chord at the right instant.

   --sheet <json> scores an ordered sheet (scripts/sheets.mjs output) by
   order-preserving alignment, and reports how many detected bars each matched
   sheet bar spans — near 2 when the tempo ran an octave fast.

   --transpose auto scores all twelve rotations and keeps the best, reporting the
   offset it used. A published sheet is written in whatever key is comfortable to
   read, and a recording can be a semitone off it — a pitch-shifted upload, a
   guitar tuned down, a capo. That is a constant, not a mistake: what matters is
   whether the changes land in the right places relative to each other.

   --before/--after <seconds> restrict scoring to segments starting in that window.
   A song that modulates partway through (a key-change final chorus) has no single
   transposition that fits start to end; score each stretch against the matching
   slice of the reference sheet rather than letting the shorter one register as
   noise under whichever shift wins the longer one.
*/
import { readFile } from 'node:fs/promises';
import { analyzeAudio } from '../src/core/analyze.ts';
import { chordName, isNoChord } from '../src/core/chordTypes.ts';
import {
  bestShiftAlignment,
  bestShiftRecall,
  detectedChangeSequence,
  parseHarte,
  parseSheetSymbol,
  sheetChangeSequence,
} from '../src/core/reference.ts';
import { buildTab } from '../src/music/tab.ts';
import { reduceSegments, levelsWorthOffering } from '../src/music/levels.ts';

const args = process.argv.slice(2);
const path = args[0];
const sampleRate = Number(args[1] ?? 22050);
const refArg = valueOf('--ref');
const timelineArg = valueOf('--ref-timeline');
const sheetArg = valueOf('--sheet');
if (!path || (!refArg && !timelineArg && !sheetArg)) {
  console.error(
    'usage: vite-node scripts/score.mjs <file.f32> [sampleRate] --ref "C,Am,F,G" [--ref-timeline chords.json] [--sheet song.sheet.json]',
  );
  process.exit(1);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const parseSymbol = parseSheetSymbol;

const reference = (refArg ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(parseSymbol);
const wantTranspose = valueOf('--transpose');
const windowStart = Number(valueOf('--after') ?? -Infinity);
const windowEnd = Number(valueOf('--before') ?? Infinity);

const buf = await readFile(path);
const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const fullRes = analyzeAudio(samples, sampleRate);
const res = {
  ...fullRes,
  segments: fullRes.segments.filter((seg) => seg.start >= windowStart && seg.start < windowEnd),
};

const familyOf = (q) => (q === 'min' || q === 'min7' ? 'min' : 'maj');

function scoreAt(shift) {
  // Keyed by "root:family", not just root — a sheet can use both a root's
  // major and minor form (a borrowed V/vi resolving to V, say), and those
  // need to stay distinguishable rather than one clobbering the other.
  const refFamilies = new Set(reference.map((r) => `${(r.root + shift + 12) % 12}:${r.family}`));
  const wantQuality = new Map(); // "root:family" -> exact vocabulary quality, only if unambiguous
  const seenQuality = new Map(); // "root:family" -> Set of qualities the sheet uses there
  for (const r of reference) {
    const key = `${(r.root + shift + 12) % 12}:${r.family}`;
    if (!seenQuality.has(key)) seenQuality.set(key, new Set());
    if (r.quality) seenQuality.get(key).add(r.quality);
  }
  for (const [key, qs] of seenQuality) {
    if (qs.size === 1) wantQuality.set(key, [...qs][0]);
  }
  const refRoots = new Set(reference.map((r) => (r.root + shift + 12) % 12));
  const refBasses = new Set(
    reference.filter((r) => r.bass !== undefined).map((r) => (r.bass + shift + 12) % 12),
  );

  let played = 0;
  let nc = 0;
  let hitFamily = 0;
  let hitQuality = 0;
  let hitRoot = 0;
  let nearSlash = 0;
  const misses = new Map();

  for (const seg of res.segments) {
    const dur = seg.end - seg.start;
    if (isNoChord(seg.chord)) {
      nc += dur;
      continue;
    }
    played += dur;
    const root = seg.chord.root;
    const family = familyOf(seg.chord.quality);
    const key = `${root}:${family}`;
    if (refFamilies.has(key)) {
      hitFamily += dur;
      if (wantQuality.get(key) === seg.chord.quality) hitQuality += dur;
    } else if (refRoots.has(root)) {
      hitRoot += dur;
      misses.set(chordName(seg.chord), (misses.get(chordName(seg.chord)) ?? 0) + dur);
    } else if (refBasses.has(root)) {
      nearSlash += dur;
    } else {
      misses.set(chordName(seg.chord), (misses.get(chordName(seg.chord)) ?? 0) + dur);
    }
  }
  return { shift, played, nc, hitFamily, hitQuality, hitRoot, nearSlash, misses };
}

const candidates = wantTranspose ? Array.from({ length: 12 }, (_, i) => i) : [0];
const scored = (reference.length ? candidates : [0]).map(scoreAt).sort((a, b) => b.hitFamily - a.hitFamily);
const { shift, played, nc, hitFamily, hitQuality, hitRoot, nearSlash, misses } = scored[0];

if (wantTranspose && reference.length) {
  console.log(
    `transpose search: best fit at +${shift} semitones (tried all 12; runner-up +${scored[1].shift} ` +
      `at ${((scored[1].hitFamily / (played || 1)) * 100).toFixed(1)}% vs best ${((hitFamily / (played || 1)) * 100).toFixed(1)}%)`,
  );
}

const total = played + nc || 1;
const pct = (x, base = played || 1) => `${(Math.max(0, x / base) * 100).toFixed(1)}%`;

const windowNote =
  Number.isFinite(windowStart) || Number.isFinite(windowEnd)
    ? `  [scoring ${Number.isFinite(windowStart) ? windowStart : 0}s–${Number.isFinite(windowEnd) ? windowEnd : '∞'}s only]`
    : '';
console.log(`${path}  ${(samples.length / sampleRate).toFixed(0)}s${windowNote}`);
console.log(
  `heard: ${res.key.name}, ${res.tempo.toFixed(1)} BPM, ${res.beatsPerBar}/4, ` +
    `confidence ${res.confidence.toFixed(3)}${res.freeTime ? ', free time' : ''}`,
);
if (reference.length) {
  console.log(`reference vocabulary: ${reference.map((r) => r.text).join(' ')}`);
  console.log('');
  console.log('vocabulary agreement (position-blind — the WEAKEST reading):');
  console.log(`  right chord (root + major/minor)  ${pct(hitFamily)}  of played time`);
  console.log(`  ...and the exact vocabulary color ${pct(hitQuality)}`);
  console.log(`  right root, wrong colour          ${pct(hitRoot)}`);
  console.log(`  slash-chord bass read as the root ${pct(nearSlash)}`);
  console.log(`  outside the sheet entirely        ${pct(played - hitFamily - hitRoot - nearSlash)}`);
  console.log(`  declared "no chord"               ${pct(nc, total)}  of the whole track`);

  if (misses.size) {
    console.log('\ndisagreements, by time:');
    for (const [name, dur] of [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`  ${name.padEnd(8)} ${pct(dur)}`);
    }
  }
}

const shifts = wantTranspose ? Array.from({ length: 12 }, (_, i) => i) : [0];

if (timelineArg) {
  let raw = JSON.parse(await readFile(timelineArg, 'utf8'));
  if (raw && !Array.isArray(raw)) raw = raw.chords;
  const timeline = raw.map(([start, end, label]) => ({ start, end, chord: parseHarte(label) }));
  const rec = bestShiftRecall(res.segments, timeline, shifts);
  const p = (hit, base) => `${((hit / (base || 1)) * 100).toFixed(1)}%`;
  console.log('\ntime-aligned chord symbol recall (10 ms grid — right chord, right instant):');
  console.log(`  root + major/minor at that instant ${p(rec.familyHit, rec.chordTime)}  of reference chord time`);
  console.log(`  the exact vocabulary symbol        ${p(rec.exactHit, rec.exactTime)}  where the reference uses one the app models`);
  console.log(`  left as N.C.                       ${p(rec.ncTime, rec.chordTime)}`);
  if (rec.shift) console.log(`  (best at +${rec.shift} semitones)`);
  if (rec.misses.size) {
    console.log('  wrong-place time went to: ' +
      [...rec.misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([n, d]) => `${n} ${p(d, rec.chordTime)}`).join('  '));
  }
}

if (sheetArg) {
  const sheet = JSON.parse(await readFile(sheetArg, 'utf8'));
  const events = sheet.events.map((e) => ({ chord: parseSymbol(e.symbol), bar: e.bar }));
  const sheetSeq = sheetChangeSequence(events, sheet.totalBars);
  const detSeq = detectedChangeSequence(res.segments);
  const align = bestShiftAlignment(sheetSeq, detSeq, shifts);
  const ratios = align.matched
    .map(({ sheet: si, detected: di }) => {
      const bars = detSeq[di].beats / (res.beatsPerBar || 4);
      return sheetSeq[si].bars > 0 ? bars / sheetSeq[si].bars : null;
    })
    .filter((r) => r != null && Number.isFinite(r))
    .sort((a, b) => a - b);
  console.log('\nordered-sheet alignment (right chords in the right ORDER):');
  console.log(
    `  ${align.matched.length} of the sheet's ${sheetSeq.length} changes recovered in order ` +
      `(${((align.matched.length / (sheetSeq.length || 1)) * 100).toFixed(1)}%); ` +
      `${detSeq.length} changes detected` +
      (align.shift ? `; best at +${align.shift} semitones` : ''),
  );
  if (ratios.length) {
    const median = ratios[ratios.length >> 1];
    console.log(
      `  detected bars per sheet bar: median ${median.toFixed(2)}` +
        (median > 1.6 ? '  — the beat grid is running DOUBLE time' : median < 0.6 ? '  — the beat grid is running HALF time' : ''),
    );
  }
}

// What the player is actually handed — the whole song, regardless of any
// --before/--after window narrowing the scoring above.
const levels = {
  easy: buildTab({ ...fullRes, segments: reduceSegments(fullRes.segments, fullRes.beatsPerBar) }, { simplify: true }),
  standard: buildTab(fullRes, { simplify: true }),
  faithful: buildTab(fullRes, { simplify: false }),
};
console.log(`\noffered levels: ${levelsWorthOffering(levels).join(', ')}`);
for (const [name, tab] of Object.entries(levels)) {
  const open = tab.palette.filter((c) => c.shape.difficulty === 1).length;
  const barre = tab.palette.filter((c) => c.shape.difficulty >= 3).length;
  const changes = tab.events.filter((e) => e.chord).length;
  const perMinute = tab.duration > 0 ? (changes / tab.duration) * 60 : 0;
  console.log(
    `  ${name.padEnd(9)} ${String(tab.palette.length).padStart(2)} chords ` +
      `(${open} open, ${barre} barre)  capo ${tab.capo}  ` +
      `${perMinute.toFixed(0)} changes/min  ` +
      `loop ${tab.loop ? `${tab.loop.bars.join('-')} (${Math.round(tab.loop.coverage * 100)}%)` : '—'}`,
  );
}
