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

export interface TempoEstimate {
  bpm: number;
  strength: number;
  /** Runner-up, usually the half- or double-time reading. */
  alternate: number;
}

/**
 * Tempo from the autocorrelation of the onset envelope, biased by a log-normal
 * prior around 120 BPM so half- and double-time peaks do not win by default.
 */
export function estimateTempo(onset: OnsetEnvelope, minBpm = 50, maxBpm = 210): TempoEstimate {
  const { values, fps } = onset;
  const n = values.length;
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * fps));
  const maxLag = Math.min(n - 1, Math.ceil((60 / minBpm) * fps));
  if (maxLag <= minLag) return { bpm: 120, strength: 0, alternate: 120 };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n || 1;

  const scores: { bpm: number; score: number }[] = [];
  const byLag: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += (values[i] - mean) * (values[i - lag] - mean);
    sum /= n - lag;
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    scores.push({ bpm, score: sum * prior });
    byLag.push(sum * prior);
  }
  let bestIdx = 0;
  for (let i = 1; i < byLag.length; i++) if (byLag[i] > byLag[bestIdx]) bestIdx = i;
  // The lag grid quantises tempo to whole envelope frames — over 1% at pop
  // tempi. A parabola through the peak and its neighbours reads between them.
  let lag = minLag + bestIdx;
  if (bestIdx > 0 && bestIdx < byLag.length - 1) {
    const left = byLag[bestIdx - 1];
    const centre = byLag[bestIdx];
    const right = byLag[bestIdx + 1];
    const denom = left - 2 * centre + right;
    if (denom < 0) lag += Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom));
  }
  const best = { bpm: (60 * fps) / lag, score: byLag[bestIdx] };
  scores.sort((a, b) => b.score - a.score);
  const alternate = scores.find((s) => Math.abs(Math.log2(s.bpm / best.bpm)) > 0.4)?.bpm ?? best.bpm;
  return { bpm: best.bpm, strength: best.score, alternate };
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
    const scale = 0.15 / (beatCount || 1);
    for (let b = 0; b < beatCount; b++) votes[b % beatsPerBar] += beatEnergy[b] * scale;
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
