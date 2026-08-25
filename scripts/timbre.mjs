/* Score the demo voice against the reference recording, context by context.

   The chord-library voice is fitted to an unprocessed A/B of a Martin D-28
   and a Gibson J-45 (youtube.com/watch?v=QnYqnOW4la8 — one player, one room,
   one Zoom H8N). The audio is not committed; the numbers measured from it
   are, in reference/timbre-targets.json, and this script scores the current
   synth against them:

     npx vite-node scripts/timbre.mjs                  # scorecard
     npx vite-node scripts/timbre.mjs --derive v.wav   # rebuild targets from
                                                       # the 44.1 kHz mono
                                                       # PCM16 reference

   Contexts and metrics — every profile is in dB re the 480-960 Hz band,
   because the recording's bottom two octaves carry the room and the mic's
   proximity and referencing to them lets a fit hide dullness behind bass:

   - strum: attack (first 70 ms) and sustain (0.25-0.9 s) band profiles,
     per-band fall over the first half second, broadband drop at 0.5 s,
     `hiBody` (1920-7680 over 240-960 at 0.12-0.28 s — a muffle detector),
     and `floor` (the quietest moment between consecutive strums, re the
     strum's peak — a disconnection detector: chopped ring shows up here).
   - pick: per-register note stats (band centroid and hi/mid ratio at the
     attack and at 0.1-0.22 s; thumb and fingers separately), plus the same
     `floor` between plucks.

   A row is a number against its target; judgement stays with ears, but a
   tweak that moves rows away from the reference should have to say why.
*/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stft } from '../src/core/dsp.ts';
import { renderShapeStrum, renderShapePattern } from '../src/audio/synth.ts';
import { shapesFor } from '../src/music/shapes.ts';
import { STRUM_PATTERNS, patternsFor } from '../src/music/arrange.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS_PATH = join(repoRoot, 'reference', 'timbre-targets.json');

const BANDS = [[60, 120], [120, 240], [240, 480], [480, 960], [960, 1920], [1920, 3840], [3840, 7680]];
const FB = BANDS.map(([a, b]) => Math.sqrt(a * b));
const MIDREF = 3;
const SR = 44100;

/* Which seconds of the reference hold which playing, derived once from the
   storyboard frames (natural top: D-28, sunburst: J-45) and the analyzer's
   chord segments. Guitar switches and talking-free gaps excluded. */
const STRUM_WINDOWS = [[0.5, 20.0], [21.5, 41.5], [43.5, 59.5], [61.0, 77.8], [111.5, 125.0], [126.3, 139.5], [203.5, 218.0], [219.5, 234.3], [235.3, 256.3], [259.0, 280.2]];
const PICK_WINDOWS = [[78.8, 92.9], [95.1, 109.2], [140.6, 152.9], [154.5, 166.9]];

// --- measurement -------------------------------------------------------------

function fineFeatures(samples, rate) {
  const spec = stft(samples, rate, { fftSize: 1024, hopSize: 256 });
  const { data, frames, bins } = spec;
  const bandLo = BANDS.map(([lo]) => Math.max(1, Math.round((lo * 1024) / rate)));
  const bandHi = BANDS.map(([, hi]) => Math.max(1, Math.round((hi * 1024) / rate) - 1));
  const band = Array.from({ length: BANDS.length }, () => new Float64Array(frames));
  const total = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    let sum = 0;
    for (let k = 1; k < bins; k++) sum += data[base + k] * data[base + k];
    total[f] = sum;
    for (let b = 0; b < BANDS.length; b++) {
      let s = 0;
      for (let k = bandLo[b]; k <= Math.max(bandLo[b], bandHi[b]); k++) s += data[base + k] * data[base + k];
      band[b][f] = s;
    }
  }
  return { band, total, frames, fps: rate / 256 };
}

function onsets(feat, thresh) {
  const { total, frames, fps } = feat;
  const log = new Float64Array(frames);
  for (let f = 0; f < frames; f++) log[f] = Math.log10(total[f] + 1e-12);
  const out = [];
  const minGap = Math.round(0.16 * fps);
  for (let f = 4; f < frames - 1; f++) {
    const jump = log[f + 1] - Math.min(log[f - 3], log[f - 2]);
    if (jump > thresh && (out.length === 0 || f - out[out.length - 1] >= minGap)) out.push(f);
  }
  return out;
}

function median(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

const inWindows = (sec, windows) => !windows || windows.some(([a, b]) => sec >= a && sec < b);

function windowSums(feat, f0, f1) {
  const sums = BANDS.map(() => 0);
  for (let f = Math.max(0, f0); f < f1 && f < feat.frames; f++) {
    for (let b = 0; b < BANDS.length; b++) sums[b] += feat.band[b][f];
  }
  return sums;
}
const profileOf = (sums) => sums.map((s) => 10 * Math.log10(s / (sums[MIDREF] || 1e-12) + 1e-15));

/** Strum-context statistics over every onset with >=0.9 s of clear air, plus
    the between-strum floor over denser onsets. */
function strumStats(feat, windows, thresh) {
  const fps = feat.fps;
  const ons = onsets(feat, thresh).filter((f) => inWindows(f / fps, windows));
  const attacks = [];
  const sustains = [];
  const drops = [];
  const bandDrops = [];
  const hiBodies = [];
  const floors = [];
  const around = (arr, c) => {
    const vals = [];
    for (let k = -2; k <= 2; k++) vals.push(arr[Math.min(feat.frames - 1, Math.max(0, c + k))]);
    return median(vals);
  };
  for (let i = 0; i < ons.length; i++) {
    const f = ons[i];
    const next = ons[i + 1] ?? feat.frames;
    const gap = (next - f) / fps;
    let peak = 0;
    for (let t = f; t < f + Math.round(0.07 * fps); t++) peak = Math.max(peak, feat.total[t]);
    // The quietest moment before the next strum, however close it is.
    if (gap >= 0.28 && gap <= 1.2) {
      let lo = Infinity;
      for (let t = f + Math.round(0.12 * fps); t < next - Math.round(0.06 * fps); t++) {
        lo = Math.min(lo, around(feat.total, t));
      }
      if (Number.isFinite(lo)) floors.push(10 * Math.log10((lo + 1e-15) / (peak + 1e-15)));
    }
    const bodySums = windowSums(feat, f + Math.round(0.12 * fps), f + Math.round(0.28 * fps));
    hiBodies.push(10 * Math.log10((bodySums[5] + bodySums[6]) / (bodySums[2] + bodySums[3] + 1e-15) + 1e-15));
    if (gap < 0.9) continue;
    attacks.push(profileOf(windowSums(feat, f, f + Math.round(0.07 * fps))));
    sustains.push(profileOf(windowSums(feat, f + Math.round(0.25 * fps), Math.min(f + Math.round(0.9 * fps), next - Math.round(0.1 * fps)))));
    drops.push(10 * Math.log10((peak + 1e-15) / (around(feat.total, f + Math.round(0.5 * fps)) + 1e-15)));
    bandDrops.push(
      BANDS.map((_, b) => {
        let p = 0;
        for (let t = f; t < f + Math.round(0.07 * fps); t++) p = Math.max(p, feat.band[b][t]);
        return 10 * Math.log10((p + 1e-15) / (around(feat.band[b], f + Math.round(0.5 * fps)) + 1e-15));
      }),
    );
  }
  const medBands = (rows) => BANDS.map((_, b) => median(rows.map((r) => r[b])));
  return {
    events: ons.length,
    attack: medBands(attacks),
    sustain: medBands(sustains),
    bandDrop: medBands(bandDrops),
    drop: median(drops),
    hiBody: median(hiBodies),
    floor: median(floors),
  };
}

/** Pick-context statistics: per-register note stats plus the between-note floor. */
function pickStats(feat, windows, thresh) {
  const fps = feat.fps;
  const ons = onsets(feat, thresh).filter((f) => inWindows(f / fps, windows));
  const notes = [];
  const floors = [];
  const around = (arr, c) => {
    const vals = [];
    for (let k = -2; k <= 2; k++) vals.push(arr[Math.min(feat.frames - 1, Math.max(0, c + k))]);
    return median(vals);
  };
  for (let i = 0; i < ons.length; i++) {
    const f = ons[i];
    const next = ons[i + 1] ?? feat.frames;
    const gap = (next - f) / fps;
    let peak = 0;
    for (let t = f; t < f + Math.round(0.05 * fps); t++) peak = Math.max(peak, feat.total[t]);
    if (gap >= 0.22 && gap <= 1.2) {
      let lo = Infinity;
      for (let t = f + Math.round(0.1 * fps); t < next - Math.round(0.05 * fps); t++) {
        lo = Math.min(lo, around(feat.total, t));
      }
      if (Number.isFinite(lo)) floors.push(10 * Math.log10((lo + 1e-15) / (peak + 1e-15)));
    }
    if (gap < 0.24) continue;
    const stat = (sums) => {
      const total = sums.reduce((a, s) => a + s, 0) + 1e-15;
      return {
        centroid: sums.reduce((a, s, b) => a + s * FB[b], 0) / total,
        hi: 10 * Math.log10((sums[5] + sums[6]) / (sums[1] + sums[2] + sums[3] + 1e-15) + 1e-15),
      };
    };
    const attack = stat(windowSums(feat, f, f + Math.round(0.05 * fps)));
    const bodySums = windowSums(feat, f + Math.round(0.1 * fps), f + Math.round(0.22 * fps));
    const body = stat(bodySums);
    const bass = bodySums[0] + bodySums[1] > bodySums[2] + bodySums[3];
    notes.push({ attack, body, bass, peakDb: 10 * Math.log10(peak + 1e-15) });
  }
  const cls = (want) => {
    const sel = notes.filter((n) => n.bass === want);
    return {
      n: sel.length,
      cA: median(sel.map((n) => n.attack.centroid)),
      cB: median(sel.map((n) => n.body.centroid)),
      hA: median(sel.map((n) => n.attack.hi)),
      hB: median(sel.map((n) => n.body.hi)),
      peakDb: median(sel.map((n) => n.peakDb)),
    };
  };
  const thumb = cls(true);
  const fingers = cls(false);
  // How loud a finger note stands over a thumb note: the pattern's balance.
  const balance = thumb.peakDb != null && fingers.peakDb != null ? fingers.peakDb - thumb.peakDb : null;
  return { events: ons.length, thumb, fingers, balance, floor: median(floors) };
}

// --- render the contexts the library actually plays --------------------------

function pad(rendered) {
  const out = new Float32Array(Math.floor(0.3 * SR) + rendered.length);
  out.set(rendered, Math.floor(0.3 * SR));
  return out;
}

function renderContexts() {
  const G = shapesFor({ root: 7, quality: 'maj' })[0].frets;
  const C = shapesFor({ root: 0, quality: 'maj' })[0].frets;
  const Am = shapesFor({ root: 9, quality: 'min' })[0].frets;
  const classic = STRUM_PATTERNS.find((p) => p.id === 'classic');
  const eight = patternsFor(4).find((p) => p.id === 'pick-53231323');
  const cat = (list) => {
    const total = list.reduce((n, x) => n + x.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const x of list) {
      out.set(x, at);
      at += x.length;
    }
    return out;
  };
  const seeds = [20, 7, 99];
  return {
    single: cat(seeds.map((seed) => pad(renderShapeStrum(G.slice(), { sampleRate: SR, seed })))),
    pattern: cat(seeds.map((seed) => pad(renderShapePattern(G, classic, { sampleRate: SR, bpm: 92, bars: 2, seed })))),
    pick: cat(seeds.flatMap((seed) => [
      pad(renderShapePattern(C, eight, { sampleRate: SR, bpm: 84, bars: 2, seed })),
      pad(renderShapePattern(Am, eight, { sampleRate: SR, bpm: 84, bars: 2, seed })),
    ])),
  };
}

// --- reporting ---------------------------------------------------------------

const fmt = (v, w = 6) => String(v == null ? '  --' : (+v).toFixed(1)).padStart(w);
function reportBands(label, ours, ref) {
  const gap = ours.map((v, i) => (v == null || ref[i] == null ? null : v - ref[i]));
  console.log(`  ${label.padEnd(9)} ours [${ours.map((v) => fmt(v)).join(',')}]`);
  console.log(`  ${''.padEnd(9)} ref  [${ref.map((v) => fmt(v)).join(',')}]   |gap| ${fmt(gap.reduce((s, g) => s + Math.abs(g ?? 0), 0) / gap.filter((g) => g != null).length, 4)}`);
}
function reportScalar(label, ours, ref) {
  console.log(`  ${label.padEnd(9)} ours ${fmt(ours)}   ref ${fmt(ref)}   gap ${fmt(ours != null && ref != null ? ours - ref : null)}`);
}
function reportRegister(label, ours, ref) {
  console.log(
    `  ${label.padEnd(9)} ours ${Math.round(ours.cA)}->${Math.round(ours.cB)} Hz, hi ${fmt(ours.hA, 5)}->${fmt(ours.hB, 5)}   ref ${Math.round(ref.cA)}->${Math.round(ref.cB)} Hz, hi ${fmt(ref.hA, 5)}->${fmt(ref.hB, 5)}`,
  );
}

// --- main --------------------------------------------------------------------

function decodeWav16(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'data') {
      const n = Math.floor(size / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data');
}

const deriveIdx = process.argv.indexOf('--derive');
if (deriveIdx >= 0) {
  const audio = decodeWav16(await readFile(process.argv[deriveIdx + 1]));
  const feat = fineFeatures(audio, SR);
  const targets = {
    source: {
      video: 'youtube.com/watch?v=QnYqnOW4la8',
      what: 'Martin D-28 / Gibson J-45 A/B, Zoom H8N, no processing; 44.1 kHz mono decode',
      derived: '2026-08-24',
      note: 'profiles in dB re 480-960 Hz; windows exclude talking, transitions and guitar switches',
    },
    strum: strumStats(feat, STRUM_WINDOWS, 0.75),
    pick: pickStats(feat, PICK_WINDOWS, 0.5),
  };
  await mkdir(dirname(TARGETS_PATH), { recursive: true });
  await writeFile(TARGETS_PATH, JSON.stringify(targets, null, 1));
  console.log(`targets derived from ${process.argv[deriveIdx + 1]} -> ${TARGETS_PATH}`);
  process.exit(0);
}

const targets = JSON.parse(await readFile(TARGETS_PATH, 'utf8'));
const contexts = renderContexts();

console.log('single strum (one downstroke, the chord-box tap):');
const single = strumStats(fineFeatures(contexts.single, SR), null, 0.5);
reportBands('attack', single.attack, targets.strum.attack);
reportBands('sustain', single.sustain, targets.strum.sustain);
reportBands('drop@.5s', single.bandDrop, targets.strum.bandDrop);
reportScalar('drop', single.drop, targets.strum.drop);
reportScalar('hiBody', single.hiBody, targets.strum.hiBody);

console.log('\npattern strum (classic, 92 BPM):');
const pat = strumStats(fineFeatures(contexts.pattern, SR), null, 0.5);
reportBands('attack', pat.attack, targets.strum.attack);
reportBands('sustain', pat.sustain, targets.strum.sustain);
reportScalar('hiBody', pat.hiBody, targets.strum.hiBody);
reportScalar('floor', pat.floor, targets.strum.floor);

console.log('\npicking (53231323, 84 BPM, C and Am):');
const pick = pickStats(fineFeatures(contexts.pick, SR), null, 0.4);
reportRegister('thumb', pick.thumb, targets.pick.thumb);
reportRegister('fingers', pick.fingers, targets.pick.fingers);
reportScalar('balance', pick.balance, targets.pick.balance);
reportScalar('floor', pick.floor, targets.pick.floor);
