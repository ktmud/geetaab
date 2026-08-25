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
import { dirname } from 'node:path';
import {
  TARGETS_PATH, SR, STRUM_WINDOWS, PICK_WINDOWS,
  fineFeatures, strumStats, pickStats, melDistance, renderContexts,
} from './timbrelib.mjs';

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
reportScalar('melDist', melDistance(single.mel, targets.strum.mel), 0);
reportScalar('flicker', single.flicker, targets.strum.flicker);

console.log('\npattern strum (classic, 92 BPM):');
const pat = strumStats(fineFeatures(contexts.pattern, SR), null, 0.5);
reportBands('attack', pat.attack, targets.strum.attack);
reportBands('sustain', pat.sustain, targets.strum.sustain);
reportScalar('hiBody', pat.hiBody, targets.strum.hiBody);
reportScalar('floor', pat.floor, targets.strum.floor);
reportScalar('tick', pat.tick, targets.strum.tick);
reportScalar('melDist', melDistance(pat.mel, targets.strum.mel), 0);
reportScalar('flicker', pat.flicker, targets.strum.flicker);

console.log('\npicking (53231323, 84 BPM, C and Am):');
const pick = pickStats(fineFeatures(contexts.pick, SR), null, 0.4);
reportRegister('thumb', pick.thumb, targets.pick.thumb);
reportRegister('fingers', pick.fingers, targets.pick.fingers);
reportScalar('balance', pick.balance, targets.pick.balance);
reportScalar('fLevel', pick.fLevel, targets.pick.fLevel);
reportScalar('tLevel', pick.tLevel, targets.pick.tLevel);
reportScalar('floor', pick.floor, targets.pick.floor);
reportScalar('tick', pick.tick, targets.pick.tick);
reportScalar('melDist', melDistance(pick.mel, targets.pick.mel), 0);
reportScalar('flicker', pick.flicker, targets.pick.flicker);
reportScalar('hnr', pick.hnr, targets.pick.hnr);
