/* Measurement library for the demo-voice scorecard: fine spectral
   features, per-context statistics, and the rendered contexts themselves.
   scripts/timbre.mjs is the CLI; fitting scripts import from here. */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stft } from '../src/core/dsp.ts';
import { FFT, hannWindow } from '../src/core/fft.ts';
import { renderShapeStrum, renderShapePattern } from '../src/audio/synth.ts';
import { shapesFor } from '../src/music/shapes.ts';
import { STRUM_PATTERNS, patternsFor } from '../src/music/arrange.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS_PATH = join(repoRoot, 'reference', 'timbre-targets.json');

export const BANDS = [[60, 120], [120, 240], [240, 480], [480, 960], [960, 1920], [1920, 3840], [3840, 7680]];
const FB = BANDS.map(([a, b]) => Math.sqrt(a * b));
const MIDREF = 3;
export const SR = 44100;

/* Which seconds of the reference hold which playing, derived once from the
   storyboard frames (natural top: D-28, sunburst: J-45) and the analyzer's
   chord segments. Guitar switches and talking-free gaps excluded. */
export const STRUM_WINDOWS = [[0.5, 20.0], [21.5, 41.5], [43.5, 59.5], [61.0, 77.8], [111.5, 125.0], [126.3, 139.5], [203.5, 218.0], [219.5, 234.3], [235.3, 256.3], [259.0, 280.2]];
export const PICK_WINDOWS = [[78.8, 92.9], [95.1, 109.2], [140.6, 152.9], [154.5, 166.9]];

// --- measurement -------------------------------------------------------------

/* 24 log-spaced bands, 70-7500 Hz: fine enough to see holes and tilts the
   seven octaves smear over. */
const MEL_N = 24;
const MEL_EDGES = Array.from({ length: MEL_N + 1 }, (_, i) => 70 * Math.pow(7500 / 70, i / MEL_N));

export function fineFeatures(samples, rate) {
  const spec = stft(samples, rate, { fftSize: 1024, hopSize: 256 });
  const { data, frames, bins } = spec;
  const bandLo = BANDS.map(([lo]) => Math.max(1, Math.round((lo * 1024) / rate)));
  const bandHi = BANDS.map(([, hi]) => Math.max(1, Math.round((hi * 1024) / rate) - 1));
  const melLo = MEL_EDGES.slice(0, -1).map((lo) => Math.max(1, Math.round((lo * 1024) / rate)));
  const melHi = MEL_EDGES.slice(1).map((hi) => Math.max(1, Math.round((hi * 1024) / rate) - 1));
  const band = Array.from({ length: BANDS.length }, () => new Float64Array(frames));
  const mel = Array.from({ length: MEL_N }, () => new Float64Array(frames));
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
    for (let m = 0; m < MEL_N; m++) {
      let s = 0;
      for (let k = melLo[m]; k <= Math.max(melLo[m], melHi[m]); k++) s += data[base + k] * data[base + k];
      mel[m][f] = s;
    }
  }
  return { band, mel, total, frames, fps: rate / 256, samples, rate };
}

/** Mean log-band profile over frame ranges, level-normalised (mean removed). */
export function melProfile(feat, ranges) {
  const sums = new Float64Array(MEL_N);
  let n = 0;
  for (const [f0, f1] of ranges) {
    for (let f = Math.max(0, f0); f < f1 && f < feat.frames; f++) {
      for (let m = 0; m < MEL_N; m++) sums[m] += feat.mel[m][f];
      n++;
    }
  }
  const db = Array.from(sums, (s) => 10 * Math.log10(s / Math.max(1, n) + 1e-15));
  const mean = db.reduce((a, b) => a + b, 0) / MEL_N;
  return db.map((v) => v - mean);
}

export const melDistance = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / MEL_N;

/** Frame-to-frame instability of the ring, dB per ~17 ms step, median over
    bands 240-3840 and frames: flutter and boil live here, and a steady real
    string keeps it low. */
export function flicker(feat, ranges) {
  const diffs = [];
  for (const [f0, f1] of ranges) {
    for (let f = Math.max(3, f0) + 3; f < f1 && f < feat.frames; f += 3) {
      for (let b = 2; b <= 5; b++) {
        const a = 10 * Math.log10(feat.band[b][f] + 1e-15);
        const p = 10 * Math.log10(feat.band[b][f - 3] + 1e-15);
        diffs.push(Math.abs(a - p));
      }
    }
  }
  return median(diffs);
}

/** Harmonic-to-noise ratio of one picked note: f0 by autocorrelation, then
    energy within ±2 bins of each harmonic against everything else 60-7000 Hz.
    Clean tone scores high; synthetic fuzz between the partials drags it down. */
const HNR_FFT = 8192;
const hnrFft = new FFT(HNR_FFT);
const hnrWin = hannWindow(HNR_FFT);
export function noteHnr(samples, rate, atSec) {
  const start = Math.floor((atSec + 0.1) * rate);
  if (start + HNR_FFT > samples.length) return null;
  const frame = new Float64Array(HNR_FFT);
  for (let i = 0; i < HNR_FFT; i++) frame[i] = samples[start + i] * hnrWin[i];
  // f0: autocorrelation over 60-450 Hz on a shorter stretch.
  const n = Math.min(Math.floor(0.25 * rate), samples.length - start);
  let bestLag = 0;
  let best = -Infinity;
  for (let lag = Math.floor(rate / 450); lag <= Math.floor(rate / 60); lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i += 2) s += samples[start + i] * samples[start + i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (!bestLag) return null;
  const f0 = rate / bestLag;
  const mags = new Float64Array(HNR_FFT / 2 + 1);
  hnrFft.magnitudes(frame, mags);
  const binHz = rate / HNR_FFT;
  const lo = Math.ceil(60 / binHz);
  const hi = Math.floor(7000 / binHz);
  let totalE = 0;
  for (let k = lo; k <= hi; k++) totalE += mags[k] * mags[k];
  let harm = 0;
  for (let h = 1; h * f0 < 7000; h++) {
    const c = Math.round((h * f0) / binHz);
    for (let k = Math.max(lo, c - 2); k <= Math.min(hi, c + 2); k++) harm += mags[k] * mags[k];
  }
  const noise = Math.max(totalE - harm, 1e-15);
  return 10 * Math.log10(harm / noise + 1e-15);
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

export function median(xs) {
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
export function strumStats(feat, windows, thresh) {
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
  const ticks = [];
  const sustainRanges = [];
  const hiIn = (f0, f1) => {
    let s = 0;
    for (let t = Math.max(0, f0); t < f1 && t < feat.frames; t++) s += feat.band[5][t] + feat.band[6][t];
    return s / Math.max(1, f1 - f0);
  };
  for (let i = 0; i < ons.length; i++) {
    const f = ons[i];
    const next = ons[i + 1] ?? feat.frames;
    const gap = (next - f) / fps;
    let peak = 0;
    for (let t = f; t < f + Math.round(0.07 * fps); t++) peak = Math.max(peak, feat.total[t]);
    // Crispness: how far the top two octaves spike in the first ~12 ms over
    // their level shortly after. Averages cannot see this; ears lead with it.
    ticks.push(10 * Math.log10(hiIn(f, f + 2) / (hiIn(f + Math.round(0.06 * fps), f + Math.round(0.12 * fps)) + 1e-15) + 1e-15));
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
    sustainRanges.push([f + Math.round(0.25 * fps), Math.min(f + Math.round(0.9 * fps), next - Math.round(0.1 * fps))]);
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
    tick: median(ticks),
    mel: melProfile(feat, sustainRanges),
    flicker: flicker(feat, sustainRanges),
  };
}

/** Pick-context statistics: per-register note stats plus the between-note floor. */
export function pickStats(feat, windows, thresh) {
  const fps = feat.fps;
  const ons = onsets(feat, thresh).filter((f) => inWindows(f / fps, windows));
  const notes = [];
  const floors = [];
  const around = (arr, c) => {
    const vals = [];
    for (let k = -2; k <= 2; k++) vals.push(arr[Math.min(feat.frames - 1, Math.max(0, c + k))]);
    return median(vals);
  };
  const ticks = [];
  const bodyRanges = [];
  const hnrs = [];
  const hiIn = (f0, f1) => {
    let s = 0;
    for (let t = Math.max(0, f0); t < f1 && t < feat.frames; t++) s += feat.band[5][t] + feat.band[6][t];
    return s / Math.max(1, f1 - f0);
  };
  for (let i = 0; i < ons.length; i++) {
    const f = ons[i];
    const next = ons[i + 1] ?? feat.frames;
    const gap = (next - f) / fps;
    let peak = 0;
    for (let t = f; t < f + Math.round(0.05 * fps); t++) peak = Math.max(peak, feat.total[t]);
    ticks.push(10 * Math.log10(hiIn(f, f + 2) / (hiIn(f + Math.round(0.06 * fps), f + Math.round(0.12 * fps)) + 1e-15) + 1e-15));
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
    bodyRanges.push([f + Math.round(0.1 * fps), f + Math.round(0.22 * fps)]);
    if (gap >= 0.3) hnrs.push(noteHnr(feat.samples, feat.rate, f / fps));
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
  // Each register's peak against the passage's own level: "the same level as
  // the video" means these two rows, not any absolute number.
  let sumP = 0;
  let nP = 0;
  const f0 = windows ? 0 : (ons[0] ?? 0);
  const f1 = windows ? feat.frames : Math.min(feat.frames, (ons[ons.length - 1] ?? 0) + Math.round(0.3 * fps));
  for (let f = f0; f < f1; f++) {
    if (!inWindows(f / fps, windows)) continue;
    sumP += feat.total[f];
    nP++;
  }
  const passDb = 10 * Math.log10(sumP / Math.max(1, nP) + 1e-15);
  return {
    events: ons.length,
    thumb,
    fingers,
    balance,
    fLevel: fingers.peakDb != null ? fingers.peakDb - passDb : null,
    tLevel: thumb.peakDb != null ? thumb.peakDb - passDb : null,
    floor: median(floors),
    tick: median(ticks),
    mel: melProfile(feat, bodyRanges),
    flicker: flicker(feat, bodyRanges),
    hnr: median(hnrs),
  };
}

// --- render the contexts the library actually plays --------------------------

function pad(rendered) {
  const out = new Float32Array(Math.floor(0.3 * SR) + rendered.length);
  out.set(rendered, Math.floor(0.3 * SR));
  return out;
}

export function renderContexts() {
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

