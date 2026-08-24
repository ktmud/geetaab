import { stft } from './dsp';

export const ONSET_SAMPLE_RATE = 22050;
export const ONSET_FFT_SIZE = 2048;
export const ONSET_HOP_SIZE = 512;

export interface OnsetEnvelope {
  values: Float32Array;
  fps: number;
}

/**
 * Spectral-flux onset strength.
 *
 * Flux is measured on log magnitudes so a quiet verse and a loud chorus produce
 * comparable peaks, and only rising bins count — falling energy is a note
 * ending, not a new one starting.
 */
export function onsetEnvelope(
  signal: Float32Array,
  sampleRate = ONSET_SAMPLE_RATE,
  fftSize = ONSET_FFT_SIZE,
  hopSize = ONSET_HOP_SIZE,
): OnsetEnvelope {
  const spec = stft(signal, sampleRate, { fftSize, hopSize });
  const { data, frames, bins } = spec;
  const maxBin = Math.min(bins - 1, Math.floor((8000 / (sampleRate / 2)) * (bins - 1)));
  const values = new Float32Array(frames);
  const gamma = 40;

  for (let f = 1; f < frames; f++) {
    let flux = 0;
    const cur = f * bins;
    const prev = (f - 1) * bins;
    for (let k = 1; k <= maxBin; k++) {
      const a = Math.log1p(gamma * data[cur + k]);
      const b = Math.log1p(gamma * data[prev + k]);
      const d = a - b;
      if (d > 0) flux += d;
    }
    values[f] = flux;
  }

  // Subtract a moving average so a sustained crescendo does not read as a
  // continuous stream of onsets.
  const window = Math.max(3, Math.round(0.35 * (sampleRate / hopSize)));
  const smoothed = new Float32Array(frames);
  let acc = 0;
  const half = window >> 1;
  for (let f = 0; f < frames + half; f++) {
    if (f < frames) acc += values[f];
    if (f - window >= 0) acc -= values[f - window];
    const centre = f - half;
    if (centre >= 0 && centre < frames) {
      const n = Math.min(f + 1, window, frames);
      smoothed[centre] = Math.max(0, values[centre] - acc / n);
    }
  }

  let max = 0;
  for (let f = 0; f < frames; f++) if (smoothed[f] > max) max = smoothed[f];
  if (max > 0) for (let f = 0; f < frames; f++) smoothed[f] /= max;

  return { values: smoothed, fps: sampleRate / hopSize };
}

export interface TempoCandidate {
  bpm: number;
  /** Score as a fraction of the winner's, so the winner is always 1. */
  confidence: number;
}

export interface TempoEstimate {
  bpm: number;
  strength: number;
  /** Runner-up, usually the half- or double-time reading. */
  alternate: number;
  /**
   * The readings worth offering a reader, best first, winner included.
   *
   * Tempo is the shakiest number this pipeline reports — on the sheet corpus
   * five of twelve songs with a known tempo come back at exactly double it —
   * and the reason is usually not that the estimate is bad but that the
   * question has more than one defensible answer. A ballad strummed in eighths
   * is 70 BPM to the person playing it and 140 to the autocorrelation, and both
   * readings put a chord in the same place. Where the runners-up score close to
   * the winner, saying so and letting the reader pick beats guessing for them.
   */
  candidates: TempoCandidate[];
}

/**
 * Read between the lag grid's teeth.
 *
 * The grid quantises tempo to whole envelope frames, which is over 1% at pop
 * tempi, so a parabola through a peak and its neighbours locates it better than
 * the sample it landed on.
 */
function refineLag(byLag: number[], index: number, minLag: number): number {
  let lag = minLag + index;
  if (index > 0 && index < byLag.length - 1) {
    const left = byLag[index - 1];
    const centre = byLag[index];
    const right = byLag[index + 1];
    const denom = left - 2 * centre + right;
    if (denom < 0) lag += Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom));
  }
  return lag;
}

/**
 * Centre and width (in octaves) of the log-normal tempo prior.
 *
 * Both were calibrated on GuitarSet's 360 annotated tempi (68-200 BPM, five
 * styles) plus the real-song corpus: narrowing the width from 0.9 to 0.6 cut
 * the files landing on a wrong octave or a triplet multiple from 140/360 to
 * 119/360 while leaving the corpus error count unchanged. Moving the centre
 * below ~110 instead halves genuinely fast songs far faster than it rescues
 * doubled ballads (at centre 80 GuitarSet falls from 61% to 36% correct), so
 * the centre stays where it was. A style-conditioned centre would beat any
 * global one (80% with oracle style labels) but predicting the style from
 * non-tempo features measured only 37%, which gave back the whole gain —
 * see the tempo study in the regression harness before re-tuning these.
 */
const TEMPO_PRIOR_CENTRE = 120;
const TEMPO_PRIOR_WIDTH = 0.6;

/**
 * Tempo from the autocorrelation of the onset envelope, biased by a log-normal
 * prior around 120 BPM so half- and double-time peaks do not win by default.
 */
export function estimateTempo(onset: OnsetEnvelope, minBpm = 50, maxBpm = 210): TempoEstimate {
  const { values, fps } = onset;
  const n = values.length;
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * fps));
  const maxLag = Math.min(n - 1, Math.ceil((60 / minBpm) * fps));
  if (maxLag <= minLag) {
    return { bpm: 120, strength: 0, alternate: 120, candidates: [{ bpm: 120, confidence: 1 }] };
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n || 1;

  const scores: { bpm: number; score: number }[] = [];
  const byLag: number[] = [];
  // The unweighted autocorrelation is kept alongside, because the two answer
  // different questions. `byLag` decides which reading to use, prior included.
  // `rawByLag` says how well each reading explains the onsets on its own, and
  // that is what makes a rival a rival: at 65 BPM the prior alone is 0.34, so
  // ranking rivals by the weighted score would hide every half-time reading —
  // which is the one thing this list exists to offer.
  const rawByLag: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += (values[i] - mean) * (values[i - lag] - mean);
    sum /= n - lag;
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / TEMPO_PRIOR_CENTRE) / TEMPO_PRIOR_WIDTH, 2));
    scores.push({ bpm, score: sum * prior });
    byLag.push(sum * prior);
    rawByLag.push(sum);
  }
  let bestIdx = 0;
  for (let i = 1; i < byLag.length; i++) if (byLag[i] > byLag[bestIdx]) bestIdx = i;
  const best = { bpm: (60 * fps) / refineLag(byLag, bestIdx, minLag), score: byLag[bestIdx] };

  // Every local maximum, refined, then thinned: two peaks a hair apart are one
  // answer read twice, and offering both would be offering a choice that is not
  // one. Five per cent is comfortably wider than the grid's own quantisation
  // and comfortably narrower than the half- and double-time readings that are
  // the whole point of the list.
  // Peaks of the raw curve, refined against it, then thinned: two peaks a hair
  // apart are one answer read twice. Five per cent is comfortably wider than
  // the lag grid's own quantisation and comfortably narrower than the half- and
  // double-time readings that are the point of the list.
  const rawBest = Math.max(...rawByLag);
  const peaks: TempoCandidate[] = [];
  for (let i = 1; i < rawByLag.length - 1; i++) {
    if (rawByLag[i] <= rawByLag[i - 1] || rawByLag[i] < rawByLag[i + 1]) continue;
    if (rawByLag[i] <= 0) continue;
    const bpm = (60 * fps) / refineLag(rawByLag, i, minLag);
    if (peaks.some((p) => Math.abs(Math.log2(p.bpm / bpm)) < 0.07)) continue;
    peaks.push({ bpm, confidence: rawBest > 0 ? rawByLag[i] / rawBest : 0 });
  }
  peaks.sort((a, b) => b.confidence - a.confidence);
  // The reading actually chosen always appears, at the tempo the weighted scan
  // refined it to, whatever the raw curve made of it.
  const chosen = peaks.findIndex((p) => Math.abs(Math.log2(p.bpm / best.bpm)) < 0.07);
  if (chosen >= 0) peaks[chosen] = { bpm: best.bpm, confidence: peaks[chosen].confidence };
  else peaks.unshift({ bpm: best.bpm, confidence: 1 });

  scores.sort((a, b) => b.score - a.score);
  const alternate = scores.find((s) => Math.abs(Math.log2(s.bpm / best.bpm)) > 0.4)?.bpm ?? best.bpm;
  return { bpm: best.bpm, strength: best.score, alternate, candidates: peaks.slice(0, 5) };
}

/**
 * Dynamic-programming beat tracker (Ellis 2007).
 *
 * Picks the beat sequence that best trades off landing on onset peaks against
 * keeping a steady period, which survives the missing and syncopated onsets a
 * greedy peak-picker trips over.
 */
export function trackBeats(onset: OnsetEnvelope, bpm: number, tightness = 100): number[] {
  const { values, fps } = onset;
  const n = values.length;
  if (n < 4) return [];
  const period = (60 / bpm) * fps;
  if (!Number.isFinite(period) || period < 2) return [];

  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const searchLo = Math.round(-2 * period);
  const searchHi = Math.round(-period / 2);

  for (let t = 0; t < n; t++) {
    let bestScore = -Infinity;
    let bestIdx = -1;
    for (let d = searchLo; d <= searchHi; d++) {
      const prev = t + d;
      if (prev < 0) continue;
      const ratio = -d / period;
      if (ratio <= 0) continue;
      const penalty = -tightness * Math.pow(Math.log(ratio), 2);
      const v = score[prev] + penalty;
      if (v > bestScore) {
        bestScore = v;
        bestIdx = prev;
      }
    }
    if (bestIdx < 0) {
      score[t] = values[t];
      back[t] = -1;
    } else {
      score[t] = values[t] + bestScore;
      back[t] = bestIdx;
    }
  }

  // Start the backtrace from a late, strong beat rather than the global max,
  // which otherwise clips the tail of the track.
  let tail = n - 1;
  let bestTail = -Infinity;
  const from = Math.max(0, n - Math.ceil(period * 2));
  for (let t = from; t < n; t++) {
    if (score[t] > bestTail) {
      bestTail = score[t];
      tail = t;
    }
  }

  const framesOut: number[] = [];
  for (let t = tail; t >= 0; t = back[t]) {
    framesOut.push(t);
    if (back[t] < 0) break;
  }
  framesOut.reverse();
  return framesOut.map((f) => f / fps);
}

/**
 * Extend a beat list backwards to zero and forwards to `duration` using the
 * median inter-beat interval, so the grid covers the whole recording.
 */
export function padBeatGrid(beats: number[], duration: number): number[] {
  if (beats.length < 2) {
    return beats.slice();
  }
  const deltas = [];
  for (let i = 1; i < beats.length; i++) deltas.push(beats[i] - beats[i - 1]);
  deltas.sort((a, b) => a - b);
  const period = deltas[deltas.length >> 1];
  if (!Number.isFinite(period) || period <= 0) return beats.slice();

  const out = beats.slice();
  let t = out[0] - period;
  while (t > 0) {
    out.unshift(t);
    t -= period;
  }
  t = out[out.length - 1] + period;
  while (t < duration) {
    out.push(t);
    t += period;
  }
  return out;
}

/**
 * Bar phase in 0..beatsPerBar-1, chosen so that chord changes land on downbeats.
 *
 * Harmony changing at the top of a bar is one of the most reliable cues in
 * popular music, and it is a far better downbeat signal than accent strength on
 * a recording captured through a phone microphone.
 */
export function estimateBarPhase(
  changeBeats: number[],
  beatsPerBar: number,
  beatCount: number,
  beatEnergy?: Float32Array,
): number {
  if (beatsPerBar <= 1) return 0;
  const votes = new Array(beatsPerBar).fill(0);
  for (const b of changeBeats) {
    if (b < 0 || b >= beatCount) continue;
    votes[((b % beatsPerBar) + beatsPerBar) % beatsPerBar] += 1;
  }
  if (beatEnergy) {
    // A tie-break worth 0.15 of a vote in total, which is what dividing by the
    // beat count was reaching for and did not achieve: `beatEnergy` holds raw
    // magnitude sums, so `energy / beatCount` is the *mean* energy — measured
    // between 75 and 400 on real recordings. The term was therefore worth
    // fifteen votes or more against a change count of about thirteen, which is
    // not a tie-break but the loudest downbeat outvoting the chord changes. It
    // also scaled with recording level, so it moved when nothing about the
    // playing had. Dividing by the mean as well makes the term sum to 0.15
    // across all phases, and makes it scale-free.
    let total = 0;
    for (let b = 0; b < beatCount; b++) total += beatEnergy[b];
    const mean = total / (beatCount || 1);
    if (mean > 1e-9) {
      const scale = 0.15 / (beatCount * mean);
      for (let b = 0; b < beatCount; b++) votes[b % beatsPerBar] += beatEnergy[b] * scale;
    }
  }
  let best = 0;
  for (let p = 1; p < beatsPerBar; p++) if (votes[p] > votes[best]) best = p;
  return best;
}

/**
 * Guess between 4/4 and 3/4 from how far apart chord changes sit.
 *
 * Only a clear preference flips the answer: 4/4 is overwhelmingly the common
 * case, and a wrong guess reshapes every bar in the generated tab.
 */
export function estimateBeatsPerBar(changeBeats: number[]): number {
  if (changeBeats.length < 4) return 4;
  const gaps: number[] = [];
  for (let i = 1; i < changeBeats.length; i++) {
    const g = changeBeats[i] - changeBeats[i - 1];
    if (g > 0 && g <= 16) gaps.push(g);
  }
  if (gaps.length < 3) return 4;
  let four = 0;
  let three = 0;
  for (const g of gaps) {
    if (g % 4 === 0) four++;
    if (g % 3 === 0) three++;
  }
  return three > four * 1.5 ? 3 : 4;
}
