/* Map a guitar recording onto the demo voice: derive targets, fit the knobs.

     npx vite-node scripts/voicefit.mjs recording.wav
     npx vite-node scripts/voicefit.mjs recording.wav --sweeps 2
     npx vite-node scripts/voicefit.mjs recording.wav --apply
     npx vite-node scripts/voicefit.mjs recording.wav --set-reference

   Give it any solo guitar recording — 16-bit PCM WAV, any rate, mono or
   stereo (convert with `afconvert -f WAVE -d LEI16 in.m4a out.wav` or
   ffmpeg) — and it does what took this repo a dozen hand-guided rounds for
   its first reference:

   1. Finds the playing on its own. Every onset is classified by the
      harmonicity of what follows it: a picked note is dominated by one
      fundamental and scores a high harmonic-to-noise ratio, a chord does
      not. Confident runs of one class become the strummed and picked
      windows a hand-built timeline supplied before. The split is a
      heuristic — check the printed seconds look like the recording.
   2. Derives the target battery from those windows (the same statistics
      scripts/timbre.mjs scores: band profiles, settle, floor, tick,
      24-band fine structure, flicker, per-register note stats, levels).
      Targets go to <recording>.targets.json; --set-reference writes them
      to reference/timbre-targets.json so the scorecard tracks them.
   3. Runs coordinate descent over every fitted knob of the voice — the
      TUNING object in src/audio/synth.ts: three contacts, decay stages,
      body gains, sweep mechanics, room send — against the battery.
      Structural choices (the Karplus-Strong string itself, the body's mode
      frequencies, the room's geometry) stay what they are: this maps a
      recording onto the algorithm, it does not invent a new one.

   The fitted TUNING prints and lands in <recording>.tuning.json; --apply
   also rewrites the values in src/audio/synth.ts. After applying: run
   `npm test`, regenerate fixtures (`npx vite-node scripts/golden.mjs`) —
   the chord-box strum digest legitimately changes with the voice — and
   above all listen. Four sweeps take tens of minutes; --sweeps 0 just
   scores the current voice against the new targets. */
import { readFile, writeFile } from 'node:fs/promises';
import { resample, toMono } from '../src/core/dsp.ts';
import { TUNING } from '../src/audio/synth.ts';
import {
  TARGETS_PATH, SR, fineFeatures, strumStats, pickStats, melDistance, renderContexts, noteHnr,
} from './timbrelib.mjs';

// --- input -------------------------------------------------------------------

function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF/WAVE file');
  let p = 12;
  let fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error(`need 16-bit PCM, got ${JSON.stringify(fmt)}`);
      const frames = Math.floor(size / 2 / fmt.channels);
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          channels[c][i] = buf.readInt16LE(p + 8 + (i * fmt.channels + c) * 2) / 32768;
        }
      }
      return { channels, rate: fmt.rate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

// --- find the playing --------------------------------------------------------

/** Classify every onset as strum or pick by attack bandwidth, then merge
    same-class runs into the windows the stats functions want. */
function autoWindows(feat) {
  const { total, frames, fps } = feat;
  const log = new Float64Array(frames);
  for (let f = 0; f < frames; f++) log[f] = Math.log10(total[f] + 1e-12);
  let globalPeak = 0;
  for (let f = 0; f < frames; f++) globalPeak = Math.max(globalPeak, total[f]);

  const events = [];
  const minGap = Math.round(0.16 * fps);
  let last = -minGap;
  for (let f = 4; f < frames - 1; f++) {
    const jump = log[f + 1] - Math.min(log[f - 3], log[f - 2]);
    if (jump < 0.45 || f - last < minGap) continue;
    last = f;
    const a1 = f + Math.round(0.07 * fps);
    let att = 0;
    for (let t = f; t < a1 && t < frames; t++) att = Math.max(att, total[t]);
    // Quiet onsets are handling noise or speech consonants, not playing.
    if (att < globalPeak * 1e-4) continue;
    // One string or six: a picked note is dominated by a single fundamental
    // and scores a high harmonic-to-noise ratio at it; a chord does not.
    const hnr = noteHnr(feat.samples, feat.rate, f / fps);
    // Confident calls vote; the ambiguous middle rides along with its run.
    const cls = hnr == null ? null : hnr >= 7 ? 'pick' : hnr < 4 ? 'strum' : null;
    events.push({ sec: f / fps, gap: 0, cls });
  }
  for (let i = 0; i < events.length; i++) {
    events[i].gap = (events[i + 1]?.sec ?? events[i].sec + 1.2) - events[i].sec;
  }

  // Runs with at least 4 confident votes, 75% one way, become windows.
  const windows = { strum: [], pick: [] };
  let run = [];
  const majority = (r) => {
    const votes = r.filter((e) => e.cls);
    if (votes.length < 4) return null;
    const picks = votes.filter((e) => e.cls === 'pick').length;
    const frac = picks / votes.length;
    return frac >= 0.75 ? 'pick' : frac <= 0.25 ? 'strum' : null;
  };
  const flush = () => {
    const cls = majority(run);
    if (cls) windows[cls].push([run[0].sec - 0.1, run[run.length - 1].sec + Math.min(run[run.length - 1].gap, 1.2)]);
    run = [];
  };
  for (const e of events) {
    if (run.length && e.sec - run[run.length - 1].sec > 2.5) flush();
    const settled = majority(run);
    if (settled && e.cls && e.cls !== settled) flush();
    run.push(e);
  }
  flush();
  return windows;
}

// --- the battery and the descent ---------------------------------------------

function deriveTargets(feat, windows) {
  return {
    source: {
      what: 'derived by scripts/voicefit.mjs',
      derived: new Date().toISOString().slice(0, 10),
      note: 'profiles in dB re 480-960 Hz; windows classified automatically by per-onset harmonicity',
      windows,
    },
    strum: strumStats(feat, windows.strum, 0.75),
    pick: pickStats(feat, windows.pick, 0.5),
  };
}

function score(T) {
  const ctx = renderContexts();
  const single = strumStats(fineFeatures(ctx.single, SR), null, 0.5);
  const pat = strumStats(fineFeatures(ctx.pattern, SR), null, 0.5);
  const pick = pickStats(fineFeatures(ctx.pick, SR), null, 0.4);
  let cost = 0;
  cost += 1.0 * melDistance(single.mel, T.strum.mel);
  cost += 0.5 * Math.abs(single.flicker - T.strum.flicker);
  cost += 1.2 * melDistance(pat.mel, T.strum.mel);
  cost += 0.25 * Math.abs((pat.tick ?? 0) - T.strum.tick);
  cost += 0.2 * Math.abs((pat.floor ?? -20) - T.strum.floor);
  cost += 0.3 * Math.abs(pat.hiBody - T.strum.hiBody);
  cost += 0.5 * Math.abs(pat.flicker - T.strum.flicker);
  cost += 1.2 * melDistance(pick.mel, T.pick.mel);
  cost += 0.25 * Math.abs((pick.tick ?? 0) - T.pick.tick);
  cost += 0.3 * Math.abs((pick.floor ?? -20) - T.pick.floor);
  cost += 0.4 * Math.abs(pick.fLevel - T.pick.fLevel);
  cost += 0.2 * Math.abs(pick.tLevel - T.pick.tLevel);
  cost += 0.1 * Math.abs((pick.hnr ?? 25) - T.pick.hnr);
  if (pick.fingers.cB && T.pick.fingers.cB) cost += 3 * Math.abs(Math.log2(pick.fingers.cB / T.pick.fingers.cB));
  if (pick.thumb.cB && T.pick.thumb.cB) cost += 3 * Math.abs(Math.log2(pick.thumb.cB / T.pick.thumb.cB));
  if (pick.fingers.hB != null && T.pick.fingers.hB != null) cost += 0.4 * Math.abs(pick.fingers.hB - T.pick.fingers.hB);
  return cost;
}

const SPECS = [
  ['acoustic.seedCutoff', 'mul', 1.3, 400, 2500],
  ['acoustic.cutoff', 'mul', 1.25, 8000, 22000],
  ['nail.seedCutoff', 'mul', 1.3, 500, 3000],
  ['nail.cutoff', 'mul', 1.3, 2500, 16000],
  ['thumb.seedCutoff', 'mul', 1.3, 300, 1200],
  ['thumb.cutoff', 'mul', 1.3, 2000, 16000],
  ['nailMix', 'add', 0.06, 0.35, 0.85],
  ['thumbMix', 'add', 0.05, 0.15, 0.5],
  ['nailTick', 'add', 0.08, 0, 0.6],
  ['sweepTick', 'add', 0.15, 0, 1.4],
  ['fingerAmp', 'add', 0.07, 0.6, 1.4],
  ['thumbAmp', 'add', 0.07, 0.45, 1.1],
  ['sweepDown', 'mul', 1.25, 0.004, 0.016],
  ['sweepUp', 'mul', 1.25, 0.0025, 0.008],
  ['roomWet', 'add', 0.06, 0.25, 0.85],
  ['ring.slow', 'mul', 1.3, 4, 15],
  ['ring.fast', 'mul', 1.3, 0.12, 0.8],
  ['ring.fastMix', 'add', 0.06, 0.4, 0.88],
  ['body.r1g', 'add', 0.5, 0, 5],
  ['body.r2g', 'add', 0.4, 0, 4],
  ['body.p1db', 'add', 1.2, -14, 0],
  ['body.p3f', 'mul', 1.15, 900, 2400],
  ['body.p3q', 'add', 0.12, 0.5, 1.6],
  ['body.p3db', 'add', 1.2, -18, -4],
  ['body.shf', 'mul', 1.2, 1500, 5000],
  ['body.shdb', 'add', 1.2, -20, -6],
];

const get = (path) => path.split('.').reduce((o, k) => o[k], TUNING);
const set = (path, v) => {
  const ks = path.split('.');
  const o = ks.slice(0, -1).reduce((o, k) => o[k], TUNING);
  o[ks[ks.length - 1]] = v;
};

function descend(T, sweeps) {
  let best = score(T);
  console.log(`current voice against these targets: ${best.toFixed(3)}`);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const shrink = Math.pow(0.62, sweep);
    let improved = false;
    for (const [path, kind, step0, lo, hi] of SPECS) {
      const step = kind === 'mul' ? Math.pow(step0, shrink) : step0 * shrink;
      for (const dir of [1, -1]) {
        for (;;) {
          const cur = get(path);
          let cand = kind === 'mul' ? cur * Math.pow(step, dir) : cur + dir * step;
          cand = Math.min(hi, Math.max(lo, cand));
          if (cand === cur) break;
          set(path, cand);
          const val = score(T);
          if (val < best - 1e-4) {
            best = val;
            improved = true;
          } else {
            set(path, cur);
            break;
          }
        }
      }
    }
    console.log(`sweep ${sweep + 1}: ${best.toFixed(3)}`);
    if (!improved && sweep > 0) break;
  }
  return best;
}

// --- applying ----------------------------------------------------------------

const round = (v, places) => +(+v).toFixed(places);
function tidy() {
  for (const voice of ['acoustic', 'nail', 'thumb']) {
    const v = get(voice);
    v.cutoff = round(v.cutoff, 0);
    v.seedCutoff = round(v.seedCutoff, 0);
  }
  for (const k of ['nailMix', 'thumbMix', 'nailTick', 'sweepTick', 'fingerAmp', 'thumbAmp', 'roomWet']) set(k, round(get(k), 2));
  for (const k of ['sweepDown', 'sweepUp']) set(k, round(get(k), 4));
  TUNING.ring.slow = round(TUNING.ring.slow, 1);
  TUNING.ring.fast = round(TUNING.ring.fast, 2);
  TUNING.ring.fastMix = round(TUNING.ring.fastMix, 2);
  const B = TUNING.body;
  B.r1g = round(B.r1g, 1);
  B.r2g = round(B.r2g, 1);
  B.p1db = round(B.p1db, 1);
  B.p3f = round(B.p3f, 0);
  B.p3q = round(B.p3q, 2);
  B.p3db = round(B.p3db, 1);
  B.shf = round(B.shf, 0);
  B.shdb = round(B.shdb, 1);
}

async function applyToSource() {
  const path = new URL('../src/audio/synth.ts', import.meta.url).pathname;
  let src = await readFile(path, 'utf8');
  const lines = {
    acoustic: `  acoustic: { cutoff: ${TUNING.acoustic.cutoff}, pluckPos: ${TUNING.acoustic.pluckPos}, seedCutoff: ${TUNING.acoustic.seedCutoff} } as PluckVoice,`,
    nail: `  nail: { cutoff: ${TUNING.nail.cutoff}, pluckPos: ${TUNING.nail.pluckPos}, seedCutoff: ${TUNING.nail.seedCutoff} } as PluckVoice,`,
    thumb: `  thumb: { cutoff: ${TUNING.thumb.cutoff}, pluckPos: ${TUNING.thumb.pluckPos}, seedCutoff: ${TUNING.thumb.seedCutoff} } as PluckVoice,`,
    ring: `  ring: { slow: ${TUNING.ring.slow}, fast: ${TUNING.ring.fast}, fastMix: ${TUNING.ring.fastMix} },`,
    body: `  body: { r1g: ${TUNING.body.r1g}, r2g: ${TUNING.body.r2g}, p1db: ${TUNING.body.p1db}, p3f: ${TUNING.body.p3f}, p3q: ${TUNING.body.p3q}, p3db: ${TUNING.body.p3db}, shf: ${TUNING.body.shf}, shdb: ${TUNING.body.shdb} },`,
  };
  for (const [key, line] of Object.entries(lines)) {
    const re = new RegExp(`^  ${key}: \\{[^\\n]*$`, 'm');
    if (!re.test(src)) throw new Error(`could not find the ${key} line to rewrite`);
    src = src.replace(re, line);
  }
  for (const k of ['nailMix', 'thumbMix', 'nailTick', 'sweepTick', 'fingerAmp', 'thumbAmp', 'sweepDown', 'sweepUp', 'preDamp', 'roomWet']) {
    const re = new RegExp(`^  ${k}: [^,]+,$`, 'm');
    if (!re.test(src)) throw new Error(`could not find the ${k} line to rewrite`);
    src = src.replace(re, `  ${k}: ${get(k)},`);
  }
  await writeFile(path, src);
  console.log(`applied to ${path} — now: npm test, npx vite-node scripts/golden.mjs, and listen`);
}

// --- main --------------------------------------------------------------------

const args = process.argv.slice(2).filter((a) => !a.endsWith('voicefit.mjs'));
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: npx vite-node scripts/voicefit.mjs recording.wav [--sweeps N] [--apply] [--set-reference]');
  process.exit(1);
}
const sweepsIdx = args.indexOf('--sweeps');
const sweeps = sweepsIdx >= 0 ? Number(args[sweepsIdx + 1]) : 4;

const { channels, rate } = decodeWav(await readFile(input));
let mono = toMono(channels);
if (rate !== SR) mono = resample(mono, rate, SR);
console.log(`${input}: ${(mono.length / SR).toFixed(0)}s at ${SR} Hz`);

const feat = fineFeatures(mono, SR);
const windows = autoWindows(feat);
const secs = (ws) => ws.reduce((n, [a, b]) => n + (b - a), 0).toFixed(0);
console.log(`found ${windows.strum.length} strummed windows (${secs(windows.strum)}s), ${windows.pick.length} picked (${secs(windows.pick)}s)`);
if (!windows.strum.length || !windows.pick.length) {
  console.error('need both strummed and picked playing to fit the whole voice; fitting with what exists');
}

const targets = deriveTargets(feat, windows);
const targetsOut = `${input.replace(/\.wav$/i, '')}.targets.json`;
await writeFile(targetsOut, JSON.stringify(targets, null, 1));
console.log(`targets -> ${targetsOut}`);
if (args.includes('--set-reference')) {
  await writeFile(TARGETS_PATH, JSON.stringify(targets, null, 1));
  console.log(`targets -> ${TARGETS_PATH}`);
}

descend(targets, sweeps);
tidy();
const tuningOut = `${input.replace(/\.wav$/i, '')}.tuning.json`;
await writeFile(tuningOut, JSON.stringify(TUNING, null, 1));
console.log(`\nfitted TUNING -> ${tuningOut}`);
console.log(JSON.stringify(TUNING, null, 1));
if (args.includes('--apply')) await applyToSource();
