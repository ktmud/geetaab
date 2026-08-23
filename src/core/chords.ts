import {
  NO_CHORD,
  QUALITIES,
  QUALITY_INTERVALS,
  type ChordQuality,
  type ChordSymbol,
} from './chordTypes';

export const CHORD_STATES = 12 * QUALITIES.length;
export const NC_STATE = CHORD_STATES;
export const TOTAL_STATES = CHORD_STATES + 1;

export function stateToChord(state: number): ChordSymbol {
  if (state >= CHORD_STATES) return NO_CHORD;
  const root = Math.floor(state / QUALITIES.length);
  const quality = QUALITIES[state % QUALITIES.length];
  return { root, quality };
}

export function chordToState(chord: ChordSymbol): number {
  if (chord.root < 0) return NC_STATE;
  return chord.root * QUALITIES.length + QUALITIES.indexOf(chord.quality);
}

/** Pitch class a harmonic lands on, relative to its fundamental. */
function harmonicOffset(h: number): number {
  return Math.round(12 * Math.log2(h)) % 12;
}

/**
 * Chord templates that include each tone's first few harmonics.
 *
 * A plain triad template misreads real instruments: the root's fifth harmonic
 * puts major-third energy under every minor chord. Modelling that energy is
 * what keeps major and minor apart instead of letting it look like evidence.
 */
function buildTemplates(): Float32Array {
  const templates = new Float32Array(CHORD_STATES * 12);
  const harmonics = [1, 2, 3, 4, 5, 6];
  const decay = 0.6;
  for (let root = 0; root < 12; root++) {
    for (let q = 0; q < QUALITIES.length; q++) {
      const quality = QUALITIES[q];
      const state = root * QUALITIES.length + q;
      const base = state * 12;
      const intervals = QUALITY_INTERVALS[quality];
      intervals.forEach((iv, idx) => {
        // The root anchors the chord; upper extensions are voiced more quietly.
        const voiceWeight = idx === 0 ? 1 : idx === intervals.length - 1 && intervals.length > 3 ? 0.7 : 0.85;
        for (let hi = 0; hi < harmonics.length; hi++) {
          const h = harmonics[hi];
          const pc = (root + iv + harmonicOffset(h)) % 12;
          templates[base + pc] += voiceWeight * Math.pow(decay, hi);
        }
      });
      centerAndNormalize12(templates, base);
    }
  }
  return templates;
}

function buildBassTemplates(): Float32Array {
  const templates = new Float32Array(CHORD_STATES * 12);
  for (let root = 0; root < 12; root++) {
    for (let q = 0; q < QUALITIES.length; q++) {
      const state = root * QUALITIES.length + q;
      const base = state * 12;
      const intervals = QUALITY_INTERVALS[QUALITIES[q]];
      templates[base + root] += 1;
      templates[base + (root + 7) % 12] += 0.35;
      templates[base + (root + intervals[1]) % 12] += 0.2;
      centerAndNormalize12(templates, base);
    }
  }
  return templates;
}

/**
 * Centre a template on zero, then scale it to unit length.
 *
 * Chroma from a real recording sits on a broad noise floor. Against uncentred
 * templates that floor is free score for whichever chord has the most notes, so
 * every triad drifts toward being read as a seventh. A zero-mean template
 * ignores any constant offset and scores only the shape.
 */
function centerAndNormalize12(buf: Float32Array, base: number): void {
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += buf[base + i];
  mean /= 12;
  for (let i = 0; i < 12; i++) buf[base + i] -= mean;
  normalize12(buf, base);
}

function normalize12(buf: Float32Array, base: number): void {
  let s = 0;
  for (let i = 0; i < 12; i++) s += buf[base + i] * buf[base + i];
  const n = Math.sqrt(s);
  if (n < 1e-9) return;
  for (let i = 0; i < 12; i++) buf[base + i] /= n;
}

export const CHORD_TEMPLATES = buildTemplates();
export const BASS_TEMPLATES = buildBassTemplates();

/**
 * Nudges the decoder toward chords a beginner can actually use.
 *
 * Sevenths and suspensions contain the triad they decorate, so they never score
 * worse and a whole song comes back spelled in extensions. The gap is
 * calibrated between the two margins measured on synthesized chords: a plain
 * major beats its dominant seventh by only about 0.007, while a real dominant
 * seventh beats the plain major by about 0.043.
 */
const QUALITY_PRIOR: Record<ChordQuality, number> = {
  maj: 0.018,
  min: 0.018,
  dom7: 0,
  min7: 0,
  maj7: -0.012,
  sus4: -0.02,
  sus2: -0.02,
};

export interface ScoreOptions {
  /** Weight of the bass chroma in the combined score. */
  bassWeight?: number;
  /** Frames quieter than this fraction of the median are treated as silence. */
  silenceRatio?: number;
}

export interface ScoredFrames {
  scores: Float32Array; // frames x TOTAL_STATES
  frames: number;
}

/** Cosine similarity of every frame against every chord template. */
export function scoreChords(
  treble: Float32Array,
  bass: Float32Array,
  frames: number,
  energy?: Float32Array,
  opts: ScoreOptions = {},
): ScoredFrames {
  const bassWeight = opts.bassWeight ?? 0.3;
  const silenceRatio = opts.silenceRatio ?? 0.06;
  const scores = new Float32Array(frames * TOTAL_STATES);

  let energyThreshold = -1;
  if (energy) {
    const sorted = Array.from(energy).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    energyThreshold = median * silenceRatio;
  }

  for (let f = 0; f < frames; f++) {
    const tBase = f * 12;
    const outBase = f * TOTAL_STATES;
    for (let s = 0; s < CHORD_STATES; s++) {
      const tmplBase = s * 12;
      let dotT = 0;
      let dotB = 0;
      for (let i = 0; i < 12; i++) {
        dotT += treble[tBase + i] * CHORD_TEMPLATES[tmplBase + i];
        dotB += bass[tBase + i] * BASS_TEMPLATES[tmplBase + i];
      }
      const quality = QUALITIES[s % QUALITIES.length];
      scores[outBase + s] = (1 - bassWeight) * dotT + bassWeight * dotB + QUALITY_PRIOR[quality];
    }
    const silent = energy ? energy[f] < energyThreshold : false;
    scores[outBase + NC_STATE] = silent ? 1 : 0;
  }
  return { scores, frames };
}

export interface DecodeOptions {
  /** Emission sharpness: scales similarity differences into log-probabilities. */
  beta?: number;
  /** Log-odds cost of changing chord between consecutive frames. */
  changePenalty?: number;
  /** Discount on the change cost for chords sharing pitch classes. */
  relatedBonus?: number;
}

const sharedPitchClasses = buildSharedTable();

function buildSharedTable(): Uint8Array {
  const table = new Uint8Array(TOTAL_STATES * TOTAL_STATES);
  const pcs: number[][] = [];
  for (let s = 0; s < CHORD_STATES; s++) {
    const chord = stateToChord(s);
    pcs.push(QUALITY_INTERVALS[chord.quality].map((iv) => (chord.root + iv) % 12));
  }
  for (let a = 0; a < CHORD_STATES; a++) {
    for (let b = 0; b < CHORD_STATES; b++) {
      let n = 0;
      for (const p of pcs[a]) if (pcs[b].includes(p)) n++;
      table[a * TOTAL_STATES + b] = n;
    }
  }
  return table;
}

/**
 * Viterbi decode over the chord lattice.
 *
 * Frame-wise argmax flickers between neighbouring chords many times a second;
 * the transition cost turns that into the handful of sustained changes a player
 * would actually write down.
 */
export function decodeChords(scored: ScoredFrames, opts: DecodeOptions = {}): number[] {
  const beta = opts.beta ?? 22;
  const changePenalty = opts.changePenalty ?? 5;
  const relatedBonus = opts.relatedBonus ?? 0.5;
  const { scores, frames } = scored;
  if (frames === 0) return [];

  const prev = new Float64Array(TOTAL_STATES);
  const next = new Float64Array(TOTAL_STATES);
  const back = new Int16Array(frames * TOTAL_STATES);

  for (let s = 0; s < TOTAL_STATES; s++) prev[s] = beta * scores[s];

  for (let f = 1; f < frames; f++) {
    const inBase = f * TOTAL_STATES;
    // The best predecessor for a *changed* chord is the same for every target,
    // so find it once instead of scanning all states per target.
    let bestPrev = -Infinity;
    let bestPrevIdx = 0;
    for (let s = 0; s < TOTAL_STATES; s++) {
      if (prev[s] > bestPrev) {
        bestPrev = prev[s];
        bestPrevIdx = s;
      }
    }
    for (let s = 0; s < TOTAL_STATES; s++) {
      let bestScore = prev[s]; // stay
      let bestFrom = s;
      const changeBase = bestPrev - changePenalty;
      if (changeBase > bestScore) {
        bestScore = changeBase;
        bestFrom = bestPrevIdx;
      }
      // Related chords get a discount, which can beat the generic best path.
      if (relatedBonus > 0 && s < CHORD_STATES) {
        const row = s * TOTAL_STATES;
        for (let p = 0; p < CHORD_STATES; p++) {
          if (p === s) continue;
          const bonus = (relatedBonus * sharedPitchClasses[row + p]) / 3;
          const v = prev[p] - changePenalty + bonus;
          if (v > bestScore) {
            bestScore = v;
            bestFrom = p;
          }
        }
      }
      next[s] = bestScore + beta * scores[inBase + s];
      back[inBase + s] = bestFrom;
    }
    prev.set(next);
  }

  let best = 0;
  for (let s = 1; s < TOTAL_STATES; s++) if (prev[s] > prev[best]) best = s;
  const path = new Array<number>(frames);
  path[frames - 1] = best;
  for (let f = frames - 1; f > 0; f--) path[f - 1] = back[f * TOTAL_STATES + path[f]];
  return path;
}

export interface ChordSegment {
  chord: ChordSymbol;
  start: number; // seconds
  end: number; // seconds
  /** Index range in the decoded sequence; beat indices for a beat-level decode. */
  startIndex: number;
  endIndex: number;
  startBeat?: number;
  endBeat?: number;
  confidence: number;
}

/** Collapse a per-frame state path into timed segments. */
export function pathToSegments(
  path: number[],
  times: number[],
  endTime: number,
  scores?: Float32Array,
): ChordSegment[] {
  const segments: ChordSegment[] = [];
  if (path.length === 0) return segments;
  let start = 0;
  for (let i = 1; i <= path.length; i++) {
    if (i === path.length || path[i] !== path[start]) {
      const state = path[start];
      let confidence = 0;
      if (scores) {
        let sum = 0;
        for (let f = start; f < i; f++) sum += scores[f * TOTAL_STATES + state];
        confidence = sum / (i - start);
      }
      segments.push({
        chord: stateToChord(state),
        start: times[start],
        end: i === path.length ? endTime : times[i],
        startIndex: start,
        endIndex: i,
        confidence,
      });
      start = i;
    }
  }
  return segments;
}

/**
 * Median-aggregate chroma frames inside each beat.
 *
 * Beat-synchronous features are the standard way to stop chord boundaries from
 * drifting off the grid, and they make the decode an order of magnitude cheaper.
 */
export function aggregateByBeats(
  chroma: Float32Array,
  frames: number,
  frameRate: number,
  beats: number[],
): { data: Float32Array; count: number } {
  const count = Math.max(0, beats.length - 1);
  const data = new Float32Array(count * 12);
  const bucket: number[] = [];
  for (let b = 0; b < count; b++) {
    const f0 = Math.max(0, Math.round(beats[b] * frameRate));
    const f1 = Math.min(frames, Math.max(f0 + 1, Math.round(beats[b + 1] * frameRate)));
    for (let pc = 0; pc < 12; pc++) {
      bucket.length = 0;
      for (let f = f0; f < f1; f++) bucket.push(chroma[f * 12 + pc]);
      bucket.sort((x, y) => x - y);
      const mid = bucket.length >> 1;
      data[b * 12 + pc] = bucket.length === 0 ? 0 : bucket.length % 2 ? bucket[mid] : (bucket[mid - 1] + bucket[mid]) / 2;
    }
    normalize12(data, b * 12);
  }
  return { data, count };
}

export function aggregateEnergyByBeats(
  energy: Float32Array,
  frames: number,
  frameRate: number,
  beats: number[],
): Float32Array {
  const count = Math.max(0, beats.length - 1);
  const out = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const f0 = Math.max(0, Math.round(beats[b] * frameRate));
    const f1 = Math.min(frames, Math.max(f0 + 1, Math.round(beats[b + 1] * frameRate)));
    let sum = 0;
    let n = 0;
    for (let f = f0; f < f1; f++) {
      sum += energy[f];
      n++;
    }
    out[b] = n > 0 ? sum / n : 0;
  }
  return out;
}

function medianChromaRange(data: Float32Array, lo: number, hi: number): Float32Array {
  const out = new Float32Array(12);
  const bucket: number[] = [];
  for (let pc = 0; pc < 12; pc++) {
    bucket.length = 0;
    for (let b = lo; b < hi; b++) bucket.push(data[b * 12 + pc]);
    bucket.sort((x, y) => x - y);
    const mid = bucket.length >> 1;
    out[pc] = bucket.length === 0 ? 0 : bucket.length % 2 ? bucket[mid] : (bucket[mid - 1] + bucket[mid]) / 2;
  }
  normalize12(out, 0);
  return out;
}

export interface RefineOptions {
  /** Score advantage kept by the chord the decoder already chose. */
  incumbentBonus?: number;
  bassWeight?: number;
}

/**
 * Re-decide each segment's chord from its interior beats only.
 *
 * The chroma window is long enough that the last beat of a chord already
 * contains the next one, which is what makes plain triads come back spelled as
 * sevenths. Judging a segment from its middle removes that bleed.
 */
export function refineSegments(
  segments: ChordSegment[],
  treble: Float32Array,
  bass: Float32Array,
  beatCount: number,
  opts: RefineOptions = {},
): void {
  const incumbentBonus = opts.incumbentBonus ?? 0.025;
  for (const seg of segments) {
    const b0 = seg.startBeat ?? 0;
    const b1 = Math.min(beatCount, seg.endBeat ?? b0 + 1);
    const span = b1 - b0;
    if (span < 2) continue;
    let lo = b0;
    let hi = span >= 3 ? b1 - 1 : b1;
    if (span >= 4) lo = b0 + 1;
    if (hi <= lo) {
      lo = b0;
      hi = b1;
    }
    const t = medianChromaRange(treble, lo, hi);
    const b = medianChromaRange(bass, lo, hi);
    const scored = scoreChords(t, b, 1, undefined, { bassWeight: opts.bassWeight ?? 0.3 });
    const incumbent = chordToState(seg.chord);
    let best = incumbent;
    let bestScore = scored.scores[incumbent] + incumbentBonus;
    for (let s = 0; s < CHORD_STATES; s++) {
      if (scored.scores[s] > bestScore) {
        bestScore = scored.scores[s];
        best = s;
      }
    }
    if (best !== incumbent) {
      seg.chord = stateToChord(best);
      seg.confidence = bestScore;
    }
  }
}

/** Merge neighbouring segments that ended up on the same chord after refining. */
export function mergeAdjacent(segments: ChordSegment[]): ChordSegment[] {
  const out: ChordSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.chord.root === seg.chord.root && last.chord.quality === seg.chord.quality) {
      last.end = seg.end;
      last.endBeat = seg.endBeat;
      last.confidence = (last.confidence + seg.confidence) / 2;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}
