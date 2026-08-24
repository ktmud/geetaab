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
  /**
   * Emission for "no chord" on frames that are audible but prove nothing: a
   * chord has to beat this to be written down. Without it, fade-ins, orchestral
   * textures and lone melody notes all get billed as whichever template edges
   * above zero. Scaled down on recordings whose genuine chords score low
   * across the board, so a muddy capture is not blanked into silence.
   */
  ncFloor?: number;
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

  const ncFloor = opts.ncFloor ?? 0;
  if (ncFloor > 0 && frames > 0) {
    const bestPerFrame = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let best = 0;
      const base = f * TOTAL_STATES;
      for (let s = 0; s < CHORD_STATES; s++) if (scores[base + s] > best) best = scores[base + s];
      bestPerFrame[f] = best;
    }
    const sorted = Array.from(bestPerFrame).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    // Scaled down for recordings whose real chords score low across the board,
    // but never below what broadband noise reaches — a recording that is ALL
    // noise must not lower the bar until its own noise clears it.
    const floor = Math.min(ncFloor, Math.max(0.075, 0.6 * median));
    for (let f = 0; f < frames; f++) {
      const idx = f * TOTAL_STATES + NC_STATE;
      if (scores[idx] < 1) scores[idx] = floor;
    }
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
  /**
   * Sounding bass note when it is a chord tone other than the root (a slash
   * chord: G/B carries 11 here). Undefined for root position. Written by
   * annotateBassNotes after the decode; never consulted by the decode itself.
   */
  bass?: number;
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
    // A no-chord verdict came from the energy and evidence gates, which this
    // re-check knows nothing about; re-labelling silence would undo them.
    if (seg.chord.root < 0) continue;
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

/** Chord qualities that read as one working family when consolidating. */
const QUALITY_POOL: Record<ChordQuality, 'maj' | 'min' | 'sus'> = {
  maj: 'maj',
  dom7: 'maj',
  maj7: 'maj',
  min: 'min',
  min7: 'min',
  sus4: 'sus',
  sus2: 'sus',
};

/** Qualities a doubtful segment may be folded into: the simple, common ones. */
const CONSOLIDATE_TARGETS: ChordQuality[] = ['maj', 'min', 'min7'];

export interface ConsolidateOptions {
  /** Deficit a same-family (colour-only) relabel may overcome. */
  marginSame?: number;
  /** Deficit a cross-family relabel may overcome. */
  marginCross?: number;
  /** How much more established the target must be than the incumbent. */
  supportRatio?: number;
  bassWeight?: number;
}

/**
 * Fold rarely-seen qualities into the chord the song has already established
 * at the same root.
 *
 * A published tab writes the functional chord; the recording underneath it
 * drifts. In a fingerpicked verse the accompanist plays root and fifth while
 * the melody supplies a ninth or a fourth, and the honest local reading of
 * that bar is Esus2 or C#7 even though every other verse names it Em or C#m7.
 * A human transcriber resolves this with the song's own vocabulary — "that
 * bar is the same Em as always" — which is exactly the evidence used here:
 * the same root elsewhere in the song, carrying several times the duration,
 * and a template score within a small margin on this segment's interior.
 *
 * Two deliberate asymmetries keep this from doing harm. Only simple qualities
 * (maj, min, min7) can be targets, so a systematic misreading can never pile
 * onto a decorated colour; and a plain maj/min/min7 segment never flips across
 * the major/minor line, because a key-change chorus makes locally-right chords
 * globally rare — the one situation where song-level statistics lie.
 */
export function consolidateSegments(
  segments: ChordSegment[],
  treble: Float32Array,
  bass: Float32Array,
  beatCount: number,
  opts: ConsolidateOptions = {},
): void {
  const marginSame = opts.marginSame ?? 0.05;
  const marginCross = opts.marginCross ?? 0.075;
  const supportRatio = opts.supportRatio ?? 2;

  // Durations are frozen at their pre-consolidation values: each decision is
  // made against what the first pass heard, not against earlier relabels.
  const stateDur = new Float32Array(CHORD_STATES);
  const poolDur = new Map<string, number>();
  for (const seg of segments) {
    if (seg.chord.root < 0) continue;
    const dur = seg.end - seg.start;
    stateDur[chordToState(seg.chord)] += dur;
    const key = `${seg.chord.root}:${QUALITY_POOL[seg.chord.quality]}`;
    poolDur.set(key, (poolDur.get(key) ?? 0) + dur);
  }

  for (const seg of segments) {
    if (seg.chord.root < 0) continue;
    const b0 = seg.startBeat ?? 0;
    const b1 = Math.min(beatCount, seg.endBeat ?? b0 + 1);
    const span = b1 - b0;
    if (span < 1) continue;
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

    const root = seg.chord.root;
    const quality = seg.chord.quality;
    const incState = chordToState(seg.chord);
    const incScore = scored.scores[incState];
    const ownPool = QUALITY_POOL[quality];
    const ownPoolDur = poolDur.get(`${root}:${ownPool}`) ?? 0;
    const plain = quality === 'maj' || quality === 'min' || quality === 'min7';
    const incFamily = quality === 'min' || quality === 'min7' ? 'min' : 'maj';

    let best: { state: number; score: number } | null = null;
    for (const target of CONSOLIDATE_TARGETS) {
      if (target === quality) continue;
      const targetFamily = target === 'maj' ? 'maj' : 'min';
      if (plain && targetFamily !== incFamily) continue;
      const state = root * QUALITIES.length + QUALITIES.indexOf(target);
      const targetDur = stateDur[state];
      if (targetDur <= 0) continue;
      const targetPool = QUALITY_POOL[target];
      if (targetPool === ownPool) {
        if (targetDur < supportRatio * stateDur[incState]) continue;
      } else {
        const targetPoolDur = poolDur.get(`${root}:${targetPool}`) ?? 0;
        if (targetPoolDur < supportRatio * ownPoolDur) continue;
      }
      const margin = targetFamily === incFamily ? marginSame : marginCross;
      if (incScore - scored.scores[state] > margin) continue;
      if (!best || scored.scores[state] > best.score) best = { state, score: scored.scores[state] };
    }
    if (best) {
      seg.chord = stateToChord(best.state);
      seg.confidence = best.score;
    }
  }
}

export interface BassNoteOptions {
  /** How much louder than the root the alternative must ring in the bass. */
  ratio?: number;
  /** Shortest segment (in beats) worth a bass verdict; shorter ones are noisy. */
  minBeats?: number;
}

/**
 * Decide, per decoded segment, whether the sounding bass is the root or
 * another chord tone — the slash-chord pass (G with B in the bass is G/B).
 *
 * This is deliberately NOT part of the Viterbi lattice: 12 x N inversion
 * states would multiply the state space and blur the templates that already
 * work. Run after the decode, it can only add an annotation; it never touches
 * chord, timing or confidence, so the chord track is identical whether or not
 * this pass runs (asserted by a unit test, and verified against a captured
 * corpus decode).
 *
 * Only a chord's THIRD or SEVENTH qualifies as the bass. A bass outside the
 * chord is far more often a passing note or bleed than a real inversion, and
 * the fifth is unjudgeable from this evidence: fingerstyle alternates
 * root-fifth in the bass as a matter of technique, and the root's third
 * harmonic lands on the fifth too. Measured on the sheet corpus (67 printed
 * slash events across 6 sheets, swept offline over the captured bass chroma):
 * with the fifth as a candidate, false annotations are dominated by it at
 * every threshold (29 of 38 at ratio 1.2, 16 of 23 at 1.35) while the
 * fifth-bass chords actually printed (three D/A bars) are never recovered —
 * so second-inversion chords are declared out of reach rather than guessed.
 */
export function annotateBassNotes(
  segments: ChordSegment[],
  bass: Float32Array,
  beatCount: number,
  opts: BassNoteOptions = {},
): void {
  // Calibrated on the same sweep: at ratio 1.5 (fifth excluded) the corpus
  // reads 13 of 53 aligned printed slashes with only 4 disagreements, and
  // all 4 are plausible unprinted first inversions (C/E, Em/G, Bm/D) — one
  // edition of the same recording prints exactly such basses. 1.2 and 1.35
  // hear no additional printed slash (13 both) and disagree 12 and 8 times;
  // 1.7 drops real ones (11/53). minBeats 2: a 1-beat median is one sample.
  const ratio = opts.ratio ?? 1.5;
  const minBeats = opts.minBeats ?? 2;
  for (const seg of segments) {
    if (seg.chord.root < 0) continue;
    const b0 = seg.startBeat ?? 0;
    const b1 = Math.min(beatCount, seg.endBeat ?? b0 + 1);
    const span = b1 - b0;
    if (span < minBeats) continue;
    // Same interior trim as refineSegments: the last beat of a segment
    // already contains the next chord's bass.
    let lo = b0;
    let hi = span >= 3 ? b1 - 1 : b1;
    if (span >= 4) lo = b0 + 1;
    if (hi <= lo) {
      lo = b0;
      hi = b1;
    }
    const med = medianChromaRange(bass, lo, hi);
    const rootLevel = Math.max(1e-6, med[seg.chord.root]);
    let best = -1;
    let bestLevel = 0;
    for (const iv of QUALITY_INTERVALS[seg.chord.quality]) {
      if (iv === 0 || iv === 7) continue; // root position; fifth: see above
      const pc = (seg.chord.root + iv) % 12;
      if (med[pc] > bestLevel) {
        bestLevel = med[pc];
        best = pc;
      }
    }
    if (best >= 0 && bestLevel > ratio * rootLevel) seg.bass = best;
  }
}

/**
 * Absorb sub-second no-chord gaps whose neighbours agree on the chord.
 *
 * A slow strum decays to the energy floor before the next one lands, so an
 * honest frame-level decode writes C, silence, C. The player never stopped
 * playing C, and the tab should not say they did.
 */
export function bridgeShortGaps(segments: ChordSegment[], maxSeconds = 1): ChordSegment[] {
  const out: ChordSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const previous = out[out.length - 1];
    const next = segments[i + 1];
    if (
      previous &&
      next &&
      seg.chord.root < 0 &&
      seg.end - seg.start <= maxSeconds &&
      previous.chord.root === next.chord.root &&
      previous.chord.quality === next.chord.quality
    ) {
      previous.end = next.end;
      previous.endIndex = next.endIndex;
      if (next.endBeat !== undefined) previous.endBeat = next.endBeat;
      i++; // the neighbour is folded in along with the gap
      continue;
    }
    out.push(seg);
  }
  return out;
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
