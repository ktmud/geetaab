/* Score a transcription against a published chord sheet.

   The question a player actually has is "if I follow this tab, is my hand on
   the right chord?" — not "does the symbol match character for character".
   A book that writes Cadd11 and a transcriber that writes C put the same
   fingers down; a book that writes E and a transcriber that writes Em do not.
   So the primary number here is time-weighted agreement on root and triad
   family, with the stricter and looser readings reported alongside it.

     ffmpeg -i song.m4a -ac 1 -ar 22050 -f f32le song.f32
     npx vite-node scripts/score.mjs song.f32 22050 --ref "C,Cadd11,F,G,Am,Em,E,Dm7,G/B,Am7/G,C/G"

   --ref is the chord vocabulary of the reference sheet. Slash chords may be
   written either way round; the bass note is kept as an alternative root so a
   G/B read as a B-rooted chord counts as near, not wrong.

   --transpose auto scores all twelve rotations and keeps the best, reporting the
   offset it used. A published sheet is written in whatever key is comfortable to
   read, and a recording can be a semitone off it — a pitch-shifted upload, a
   guitar tuned down, a capo. That is a constant, not a mistake: what matters is
   whether the changes land in the right places relative to each other.
*/
import { readFile } from 'node:fs/promises';
import { analyzeAudio } from '../src/core/analyze.ts';
import { chordName, isNoChord, SHARP_NAMES, FLAT_NAMES } from '../src/core/chordTypes.ts';
import { buildTab } from '../src/music/tab.ts';
import { reduceSegments, levelsWorthOffering } from '../src/music/levels.ts';

const args = process.argv.slice(2);
const path = args[0];
const sampleRate = Number(args[1] ?? 22050);
const refArg = valueOf('--ref');
if (!path || !refArg) {
  console.error('usage: vite-node scripts/score.mjs <file.f32> [sampleRate] --ref "C,Am,F,G"');
  process.exit(1);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// Suffixes that land exactly on one of the app's 7 vocabulary qualities.
// Anything else (add9, 6, 9, dim, aug, ...) still has a known root/family for
// the headline metric, but has no single right answer at the quality level —
// the app's vocabulary simply has no symbol for it.
const VOCAB_QUALITY = {
  '': 'maj',
  m: 'min',
  7: 'dom7',
  m7: 'min7',
  maj7: 'maj7',
  sus4: 'sus4',
  sus2: 'sus2',
};

/** "Cadd9", "Dm7", "G/B" → { root, family, quality, bass }. */
function parseSymbol(text) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(text.trim());
  if (!m) throw new Error(`unparsed chord: ${text}`);
  const [, letter, accidental, rest] = m;
  const root = pitchClass(letter + accidental);
  const [body, bassText] = rest.split('/');
  // A leading "m" is minor; "maj" is a major seventh, still a major triad.
  const family = /^m(?!aj)/.test(body) ? 'min' : 'maj';
  const quality = Object.hasOwn(VOCAB_QUALITY, body) ? VOCAB_QUALITY[body] : null;
  const bass = bassText ? pitchClass(bassText) : undefined;
  return { text, root, family, quality, bass };
}

function pitchClass(name) {
  const i = SHARP_NAMES.indexOf(name);
  if (i >= 0) return i;
  const j = FLAT_NAMES.indexOf(name);
  if (j >= 0) return j;
  throw new Error(`unknown note: ${name}`);
}

const reference = refArg.split(',').map((s) => s.trim()).filter(Boolean).map(parseSymbol);
const wantTranspose = valueOf('--transpose');

const buf = await readFile(path);
const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const res = analyzeAudio(samples, sampleRate);

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
const scored = candidates.map(scoreAt).sort((a, b) => b.hitFamily - a.hitFamily);
const { shift, played, nc, hitFamily, hitQuality, hitRoot, nearSlash, misses } = scored[0];

if (wantTranspose) {
  console.log(
    `transpose search: best fit at +${shift} semitones (tried all 12; runner-up +${scored[1].shift} ` +
      `at ${((scored[1].hitFamily / (played || 1)) * 100).toFixed(1)}% vs best ${((hitFamily / (played || 1)) * 100).toFixed(1)}%)`,
  );
}

const total = played + nc || 1;
const pct = (x, base = played || 1) => `${(Math.max(0, x / base) * 100).toFixed(1)}%`;

console.log(`${path}  ${(samples.length / sampleRate).toFixed(0)}s`);
console.log(
  `heard: ${res.key.name}, ${res.tempo.toFixed(1)} BPM, ${res.beatsPerBar}/4, ` +
    `confidence ${res.confidence.toFixed(3)}${res.freeTime ? ', free time' : ''}`,
);
console.log(`reference vocabulary: ${reference.map((r) => r.text).join(' ')}`);
console.log('');
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

// What the player is actually handed.
const levels = {
  easy: buildTab({ ...res, segments: reduceSegments(res.segments, res.beatsPerBar) }, { simplify: true }),
  standard: buildTab(res, { simplify: true }),
  faithful: buildTab(res, { simplify: false }),
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
