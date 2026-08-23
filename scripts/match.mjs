/* Pair unlabelled recordings with reference chord sheets by distribution shape,
   not just vocabulary overlap. Two different pop songs in the same key share
   most of their chords (C, G, Am, F are everywhere), so "is this chord in the
   reference set" cannot tell two candidate sheets apart when both contain the
   detected chord. Which one is actually playing shows up in *how much of the
   song* each chord accounts for: the chord a sheet returns to constantly should
   be the chord the recording spends the most time on, at whatever transposition
   aligns the two.

   Usage: edit SONGS and SHEETS below, run with vite-node.
*/
import { readFile } from 'node:fs/promises';
import { analyzeAudio } from '../src/core/analyze.ts';
import { isNoChord } from '../src/core/chordTypes.ts';

const SONGS = [
  { name: 'songA', file: process.argv[2] },
  { name: 'songB', file: process.argv[3] },
  { name: 'songC', file: process.argv[4] },
];

// weight = how many times the sheet prints that symbol — a proxy for how much
// of the song it occupies, since a chord chart repeats a chord once per strum
// pattern it covers.
const SHEETS = {
  wojide: [
    ['C', 47], ['G/B', 23], ['Fsus2', 23], ['Am7', 23], ['Gsus4', 21], ['Am7/G', 21], ['G', 4], ['E', 2],
  ],
  xihu: [
    ['G', 19], ['Am7', 18], ['C', 10], ['Em7', 9], ['Cadd9', 9], ['Em', 7], ['G/B', 2], ['B', 2],
  ],
  yongbao: [
    ['C', 23], ['Fmaj7', 21], ['Em', 21], ['Dm7', 21], ['Cmaj7', 1],
  ],
};

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function pitchClass(name) {
  const i = SHARP_NAMES.indexOf(name);
  if (i >= 0) return i;
  const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  return flats.indexOf(name);
}
function familyOf(body) {
  return /^m(?!aj)/.test(body) ? 'min' : 'maj';
}
function sheetDistribution(entries) {
  const dist = new Map(); // "root:family" -> weight
  for (const [text, weight] of entries) {
    const m = /^([A-G][#b]?)(.*)$/.exec(text);
    const root = pitchClass(m[1]);
    const family = familyOf(m[2].split('/')[0]);
    const key = `${root}:${family}`;
    dist.set(key, (dist.get(key) ?? 0) + weight);
  }
  const total = [...dist.values()].reduce((a, b) => a + b, 0);
  for (const k of dist.keys()) dist.set(k, dist.get(k) / total);
  return dist;
}

function detectedDistribution(segments) {
  const dist = new Map();
  let total = 0;
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const dur = seg.end - seg.start;
    const family = seg.chord.quality === 'min' || seg.chord.quality === 'min7' ? 'min' : 'maj';
    const key = `${seg.chord.root}:${family}`;
    dist.set(key, (dist.get(key) ?? 0) + dur);
    total += dur;
  }
  for (const k of dist.keys()) dist.set(k, dist.get(k) / total);
  return dist;
}

function cosineAt(detected, sheetDist, shift) {
  let dot = 0;
  let a2 = 0;
  let b2 = 0;
  const shifted = new Map();
  for (const [key, w] of sheetDist) {
    const [root, family] = key.split(':');
    const newKey = `${(Number(root) + shift + 12) % 12}:${family}`;
    shifted.set(newKey, w);
  }
  const keys = new Set([...detected.keys(), ...shifted.keys()]);
  for (const k of keys) {
    const a = detected.get(k) ?? 0;
    const b = shifted.get(k) ?? 0;
    dot += a * b;
    a2 += a * a;
    b2 += b * b;
  }
  return dot / (Math.sqrt(a2) * Math.sqrt(b2) || 1);
}

function bestShift(detected, sheetDist) {
  let best = { shift: 0, score: -1 };
  for (let shift = 0; shift < 12; shift++) {
    const score = cosineAt(detected, sheetDist, shift);
    if (score > best.score) best = { shift, score };
  }
  return best;
}

const sheetDists = Object.fromEntries(Object.entries(SHEETS).map(([k, v]) => [k, sheetDistribution(v)]));

const matrix = [];
for (const song of SONGS) {
  if (!song.file) continue;
  const buf = await readFile(song.file);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const res = analyzeAudio(samples, 22050);
  const detected = detectedDistribution(res.segments);
  const row = { name: song.name, key: res.key.name };
  for (const sheetName of Object.keys(SHEETS)) {
    row[sheetName] = bestShift(detected, sheetDists[sheetName]);
  }
  matrix.push(row);
}

console.log('cosine similarity of time-weighted chord distribution (0-1, higher = better fit), best transposition shown:\n');
const sheetNames = Object.keys(SHEETS);
console.log(['song'.padEnd(8), 'heard key'.padEnd(12), ...sheetNames.map((s) => s.padEnd(16))].join(''));
for (const row of matrix) {
  console.log(
    [
      row.name.padEnd(8),
      row.key.padEnd(12),
      ...sheetNames.map((s) => `${row[s].score.toFixed(3)} (+${row[s].shift})`.padEnd(16)),
    ].join(''),
  );
}

// Best 1-1 assignment by brute force (3 songs, 3 sheets — 6 permutations).
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}
let bestAssign = null;
for (const perm of permutations(sheetNames)) {
  const total = matrix.reduce((sum, row, i) => sum + row[perm[i]].score, 0);
  if (!bestAssign || total > bestAssign.total) bestAssign = { perm, total };
}
console.log('\nbest 1:1 assignment:');
matrix.forEach((row, i) => {
  const sheet = bestAssign.perm[i];
  console.log(`  ${row.name} = ${sheet}  (similarity ${row[sheet].score.toFixed(3)}, shift +${row[sheet].shift})`);
});
