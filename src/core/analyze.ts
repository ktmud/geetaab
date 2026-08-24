import { CHROMA_HOP_SIZE, CHROMA_SAMPLE_RATE, computeChromagram } from './chroma';
import {
  aggregateByBeats,
  aggregateEnergyByBeats,
  annotateBassNotes,
  bridgeShortGaps,
  consolidateSegments,
  decodeChords,
  mergeAdjacent,
  pathToSegments,
  refineSegments,
  scoreChords,
  stateToChord,
  TOTAL_STATES,
  type ChordSegment,
} from './chords';
import { QUALITY_INTERVALS, isNoChord } from './chordTypes';
import {
  ONSET_SAMPLE_RATE,
  estimateBarPhase,
  estimateBeatsPerBar,
  estimateTempo,
  onsetEnvelope,
  padBeatGrid,
  trackBeats,
  type TempoCandidate,
} from './beats';
import { medianOf, normalizePeak, resample } from './dsp';
import { estimateKey, type KeyEstimate } from './key';

/**
 * The engine's version, and the reason a stored song is ever worked out again.
 *
 * A single counter said only "different", which meant every change that
 * touched this file had to be treated as one that invalidates every tab a
 * player has saved — a renamed local as expensive as a new key estimator. The
 * three parts say what kind of different:
 *
 *   major  the result's shape changed. A stored analysis cannot be read as it
 *          stands, and the Swift port has to move with it or the two builds
 *          are no longer describing the same thing.
 *   minor  the numbers changed — an accuracy fix. A stored analysis still
 *          parses, but it is the old answer, so it is worked out again from
 *          the audio the next time the song is opened. This is the part that
 *          carries a fix to songs a player already has rather than only to new
 *          ones, and the part `golden/golden.json` is regenerated for.
 *   patch  nothing observable changed: a refactor, a comment, a speed-up.
 *          Nothing is recomputed, and no fixture moves.
 *
 * The explainer at /how is part of this contract too: it describes what this
 * file does, so a minor that changes the description is not finished until
 * that page says the new thing.
 *
 * Reset to 1.0.0 for the first release.
 *
 * History:
 *   1.3.0  suspensions are held further from the plain triad, and two pieces
 *          of key evidence were raised to keep the borderline keys steady
 *          under the shorter segment list that follows. On the sheet corpus
 *          the app now writes 7 suspensions the sheet does not print, down
 *          from 19, and still hears 6 of the 7 it used to get right.
 *   1.2.0  the tempo estimate keeps its runners-up, so a recording with more
 *          than one defensible count can offer them instead of the app
 *          guessing. The chosen tempo is unchanged; the result carries a list
 *          beside it.
 *   1.1.0  levelled the signal before the onset envelope, and made the
 *          bar-phase energy tie-break the 0.15 votes it was written to be —
 *          the same recording at a different distance from the speaker could
 *          otherwise come back with a different tempo, and on one GuitarSet
 *          file a different key. The counter it replaces ran 1..6 and
 * is not comparable to it, so every song stored under one of those numbers is
 * treated as stale — which is what it is.
 */
export const ANALYSIS_VERSION = '1.3.0';

/**
 * Whether a stored analysis should be worked out again from its audio.
 *
 * Patch releases are excluded by definition: they produce the same answer, so
 * recomputing would spend a minute of someone's phone to arrive back where it
 * started. Anything this cannot parse — a missing version, or one of the bare
 * integers written before 1.0.0 — is stale, because there is no way to tell
 * that it is not.
 */
export function analysisIsStale(stored: string | number | undefined): boolean {
  if (typeof stored !== 'string') return true;
  const line = (version: string): string => version.split('.').slice(0, 2).join('.');
  return line(stored) !== line(ANALYSIS_VERSION);
}

export interface AnalysisResult {
  duration: number;
  tempo: number;
  beats: number[];
  beatsPerBar: number;
  /** Index of the first downbeat within `beats`. */
  barPhase: number;
  key: KeyEstimate;
  tuning: number;
  segments: ChordSegment[];
  /** Detected chord for each beat interval, as a lattice state. */
  beatStates: number[];
  confidence: number;
  /** Normalised periodicity of the onsets; low means no steady pulse to find. */
  rhythmicity: number;
  /** True when the piece plays freely and the beat grid is only approximate. */
  freeTime: boolean;
  /**
   * Readings of the tempo worth offering, slowest first, when more than one is
   * defensible. Empty when the answer is not in doubt.
   *
   * `tempo` above is always the reading the analysis actually used, and it is
   * always one of these when the list is non-empty.
   */
  tempoChoices: TempoChoice[];
}

export interface TempoChoice {
  bpm: number;
  /** Score as a fraction of the winner's. Exactly one entry has `picked`. */
  confidence: number;
  picked: boolean;
}

export interface AnalyzeOptions {
  onProgress?: (stage: string, fraction: number) => void;
  /** Override the detected tempo, in BPM. Also disables octave correction. */
  tempoHint?: number;
  beatsPerBar?: number;
}

interface Decoded {
  segments: ChordSegment[];
  path: number[];
  beatCount: number;
  beatEnergy: Float32Array;
  scores: Float32Array;
}

/**
 * Full analysis of a mono recording: tempo and beats, then beat-synchronous
 * chord decoding, then key.
 *
 * Chords are decoded on the beat grid rather than on raw frames so boundaries
 * land where a player would write them, and so the lattice search stays small
 * enough to run on a phone.
 */
export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
  opts: AnalyzeOptions = {},
): AnalysisResult {
  const report = opts.onProgress ?? (() => {});
  const duration = samples.length / sampleRate;

  report('resampling', 0.05);
  // Levelled before anything measures it, because one stage downstream is not
  // scale-free and the rest of the pipeline is. `onsetEnvelope` compresses
  // magnitudes with log1p(40x) before taking the flux, and log1p is not linear:
  // log1p(40 * 0.35m) is not 0.35 * log1p(40m), so the same performance recorded
  // quieter yields a differently *shaped* onset curve, not merely a smaller one.
  // Normalising the envelope afterwards cannot undo a change of shape.
  //
  // That mattered here in a way it would not in a studio tool. The recorder asks
  // for automatic gain control to be switched off, on purpose — so the level is
  // set by how far the phone is from the speaker. Measured on the corpus, the
  // same audio at 0.35x moved the tempo on two of nineteen files; on GuitarSet
  // it moved eight of thirty-six, one of them flipping both the key and the
  // free-time verdict. A tab that depends on how close you stood is a bug.
  const mono22 = normalizePeak(resample(samples, sampleRate, ONSET_SAMPLE_RATE));
  const mono11 = resample(mono22, ONSET_SAMPLE_RATE, CHROMA_SAMPLE_RATE);

  report('finding the beat', 0.25);
  const onset = onsetEnvelope(mono22, ONSET_SAMPLE_RATE);
  const tempoEstimate = estimateTempo(onset);
  let tempo = opts.tempoHint ?? tempoEstimate.bpm;
  let beats = beatGrid(onset, tempo, duration);
  // Autocorrelation strength over variance is scale-free: a strummed song lands
  // well above rubato fingerpicking, whose onsets share no common period.
  const rhythmicity = onsetRhythmicity(onset, tempoEstimate.strength);

  report('listening for chords', 0.5);
  const chroma = computeChromagram(mono11, CHROMA_SAMPLE_RATE);
  const frameRate = CHROMA_SAMPLE_RATE / CHROMA_HOP_SIZE;

  report('working out the changes', 0.75);
  let decoded = decodeOnGrid(chroma, frameRate, beats);
  const freeTime = !opts.tempoHint && rhythmicity < FREE_TIME_RHYTHMICITY;

  if (!freeTime && !opts.tempoHint && shouldHalveTempo(tempo, decoded.segments)) {
    tempo /= 2;
    beats = beatGrid(onset, tempo, duration);
    decoded = decodeOnGrid(chroma, frameRate, beats);
  }

  if (freeTime) {
    // With no pulse to find, the tracked beats carry no information, and
    // snapping chord changes to them puts every boundary wrong by up to a
    // beat. Decode on a fixed half-second grid instead, with a stiffer change
    // cost because free playing holds its harmony for seconds at a time.
    const fineGrid: number[] = [];
    for (let t = 0; t < duration; t += 0.5) fineGrid.push(t);
    const fine = decodeOnGrid(chroma, frameRate, fineGrid, { changePenalty: 3 });
    // The bar model still runs on the beat grid, so segment edges snap to the
    // nearest beat only after the boundaries themselves are settled.
    for (const seg of fine.segments) {
      seg.startBeat = nearestBeatIndex(beats, seg.start);
      seg.endBeat = Math.max(seg.startBeat + 1, nearestBeatIndex(beats, seg.end));
    }
    decoded = { ...decoded, segments: fine.segments };
  }

  // The autocorrelation names a tempo; the tracker then negotiates it against
  // the actual onsets. The grid it settled on is the truer reading, so the
  // reported BPM comes from the beats themselves. A forced tempo is echoed
  // back untouched — overriding an override reads as the app ignoring you.
  if (!opts.tempoHint && !freeTime && beats.length >= 9) {
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
    const median = medianOf(intervals);
    if (median > 1e-3) tempo = 60 / median;
  }

  report('naming the key', 0.9);
  const changeBeats = decoded.segments.map((s) => s.startBeat ?? 0);
  const beatsPerBar = opts.beatsPerBar ?? (freeTime ? 4 : estimateBeatsPerBar(changeBeats));
  const barPhase = freeTime
    ? 0
    : estimateBarPhase(changeBeats, beatsPerBar, decoded.beatCount, decoded.beatEnergy);
  const key = estimateKey(
    chordToneHistogram(decoded.segments),
    decoded.segments
      .filter((s) => !isNoChord(s.chord))
      .map((s) => ({ root: s.chord.root, quality: s.chord.quality, start: s.start, end: s.end })),
  );

  const totalDuration = decoded.segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const confidence =
    totalDuration > 0
      ? decoded.segments.reduce((sum, s) => sum + s.confidence * (s.end - s.start), 0) / totalDuration
      : 0;

  report('done', 1);
  return {
    duration,
    tempo,
    beats,
    beatsPerBar,
    barPhase,
    key,
    tuning: chroma.tuning,
    segments: decoded.segments,
    beatStates: decoded.path,
    confidence,
    rhythmicity,
    freeTime,
    tempoChoices: tempoChoicesFrom(tempoEstimate.candidates, tempo, freeTime),
  };
}

/**
 * How close a rival's raw score must be to the best to count as a rival on the
 * evidence alone.
 */
const TEMPO_RIVAL = 0.82;

/**
 * And how much support a *metrical* relative needs — half time, double time, or
 * the two-against-three readings a swung or compound feel produces.
 *
 * Lower on purpose, because these do not need to win an argument to be worth
 * offering. A peak at exactly half the chosen tempo puts every chord in the
 * same place; it is the same music counted differently, and which counting is
 * right is a question about the player rather than about the recording. The
 * prior settles it by assuming pop tempi, and the prior is exactly what a
 * reader looking at this list is entitled to overrule.
 */
const TEMPO_RELATIVE_SUPPORT = 0.45;

/**
 * Half or double, within a hair — and deliberately not the two-against-three
 * readings.
 *
 * Halving or doubling recounts the same music: every chord stays where it was,
 * and only the number of beats you count over it changes. Two-against-three
 * re-bars it, which is a different claim about the piece and needs to win the
 * argument on the evidence rather than be offered for free. Measured, admitting
 * them added a third option to eight songs at scores of 0.49 to 0.68 — noise
 * in the list, none of it ever the right answer.
 */
function isMetricalRelative(bpm: number, of: number): boolean {
  const ratio = bpm / of;
  return [0.5, 2].some((r) => Math.abs(Math.log2(ratio / r)) < 0.06);
}

function tempoChoicesFrom(
  candidates: TempoCandidate[],
  used: number,
  freeTime: boolean,
): TempoChoice[] {
  if (freeTime || candidates.length === 0) return [];
  const near = (a: number, b: number): boolean => Math.abs(Math.log2(a / b)) < 0.07;

  const kept = candidates.filter(
    (c) =>
      near(c.bpm, used) ||
      c.confidence >= TEMPO_RIVAL ||
      (isMetricalRelative(c.bpm, used) && c.confidence >= TEMPO_RELATIVE_SUPPORT),
  );
  // Only the chosen reading survived: the tempo is not in doubt, and offering a
  // list of one would invent a decision rather than report one.
  if (kept.length < 2) return [];

  const out: TempoChoice[] = kept
    .slice(0, 3)
    .map((c) => ({
      bpm: Math.round(c.bpm * 10) / 10,
      confidence: c.confidence,
      picked: near(c.bpm, used),
    }));
  // The tempo actually used can be moved after the estimate — by the halving
  // rule, or by the tracker's own median — so if it drifted clear of every
  // candidate it is added rather than lost.
  if (!out.some((c) => c.picked)) {
    out.push({ bpm: Math.round(used * 10) / 10, confidence: 1, picked: true });
  }
  out.sort((a, b) => a.bpm - b.bpm);
  return out;
}

/** Below this the onsets share no common period worth calling a tempo. */
const FREE_TIME_RHYTHMICITY = 0.08;

function nearestBeatIndex(beats: number[], time: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < beats.length; i++) {
    const d = Math.abs(beats[i] - time);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function onsetRhythmicity(onset: ReturnType<typeof onsetEnvelope>, strength: number): number {
  const { values } = onset;
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i];
  mean /= values.length || 1;
  let variance = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    variance += d * d;
  }
  variance /= values.length || 1;
  return variance > 1e-12 ? Math.max(0, strength) / variance : 0;
}

function beatGrid(
  onset: ReturnType<typeof onsetEnvelope>,
  tempo: number,
  duration: number,
): number[] {
  let beats = trackBeats(onset, tempo);
  if (beats.length < 2) {
    const period = 60 / tempo;
    beats = [];
    for (let t = 0; t < duration; t += period) beats.push(t);
  }
  return padBeatGrid(beats, duration);
}

/**
 * Change cost of the decode: one beat is the shortest chord worth writing
 * down, so this is far lower than a frame-level decode would use.
 *
 * The value is 2.2 because that is where both position-aware measures peak.
 * Swept across the sheet corpus and GuitarSet:
 *
 *   cost   vocabulary   order F1   GuitarSet recall   sandwiches
 *   1.2         95.03      75.36              60.89           70
 *   1.6         95.57      77.88              60.91           44
 *   1.9         96.15      78.78              61.60           26
 *   2.2         96.24      79.12              61.66           18
 *   2.6         96.81      78.43              61.51           11
 *   3.0         97.05      78.79              61.18            7
 *
 * Read the vocabulary column and the answer is 3.0 or higher — it rises all
 * the way, because it only asks whether a segment names a chord the song uses
 * somewhere, and merging a chord into its neighbour never breaks that. Read
 * either column that knows where a chord sits and the answer is 2.2.
 *
 * A second decode at a stiffer cost, fitted to the song's own median chord
 * length, was tried on the strength of the vocabulary column and removed on
 * the strength of the other two. Anything that makes the chart quieter has to
 * be judged against those, not this one — and order recall alone is not one of
 * them either, since emitting more changes covers more of the sheet by luck;
 * that is why the table above reads the F1 of order recall and precision.
 */
const CHANGE_PENALTY = 2.2;

function decodeOnGrid(
  chroma: ReturnType<typeof computeChromagram>,
  frameRate: number,
  beats: number[],
  gridOpts: { changePenalty?: number } = {},
): Decoded {
  const treble = aggregateByBeats(chroma.treble, chroma.frames, frameRate, beats);
  const bass = aggregateByBeats(chroma.bass, chroma.frames, frameRate, beats);
  const beatEnergy = aggregateEnergyByBeats(chroma.energy, chroma.frames, frameRate, beats);

  const scored = scoreChords(treble.data, bass.data, treble.count, beatEnergy, {
    bassWeight: 0.3,
    ncFloor: 0.12,
  });
  const path = decodeChords(scored, {
    beta: 22,
    changePenalty: gridOpts.changePenalty ?? CHANGE_PENALTY,
    relatedBonus: 0.4,
  });
  const beatTimes = beats.slice(0, treble.count);
  const raw = pathToSegments(path, beatTimes, beats[beats.length - 1] ?? 0, scored.scores);
  // The decode ran on the beat grid, so segment indices are already beat
  // numbers; deriving them from timestamps would accumulate rounding drift.
  for (const seg of raw) {
    seg.startBeat = seg.startIndex;
    seg.endBeat = seg.endIndex;
  }
  refineSegments(raw, treble.data, bass.data, treble.count);
  const merged = mergeAdjacent(raw);
  consolidateSegments(merged, treble.data, bass.data, treble.count);
  const segments = bridgeShortGaps(mergeAdjacent(merged));
  // Slash chords: a pure annotation on the settled segments. The chord track
  // is byte-identical with this line removed.
  annotateBassNotes(segments, bass.data, treble.count);
  return {
    segments,
    path,
    beatCount: treble.count,
    beatEnergy,
    scores: scored.scores,
  };
}

/**
 * Decide whether the tempo came back at double time.
 *
 * Autocorrelation cannot separate a beat from half a beat: the same strumming
 * pattern at 72 BPM and at 144 BPM produces an identical onset envelope. The
 * tie-break has to come from the harmony, where chords that never change faster
 * than every eighth bar mean the grid is counting twice as fast as the player.
 * The guards keep genuinely fast songs with slow harmony from being halved.
 *
 * Measured on GuitarSet (360 annotated tempi) this rule is deliberately almost
 * inert: it fires on 2 files, fixing one genuine double and wrongly halving
 * one fast solo — net zero — and it never fires on the real-song corpus,
 * whose doubled ballads change chords every half-bar. Every relaxation and
 * replacement tested made things worse: lowering the 8-beat threshold to 6
 * nets -1 (1 fixed, 2 broken) and to 4 nets -22; deciding from beat-salience
 * alternation fails because upstrokes carry as much spectral flux as beats
 * (doubled files show no strong/weak pattern, full-band or bass-band); and an
 * empty-midpoint test halves quarter-note swing comping wholesale (fixes
 * 15-20, breaks 19-32). A doubled grid over fast harmony is simply not
 * decidable from this evidence, so the rule stays at its conservative
 * setting rather than pretending otherwise.
 */
function shouldHalveTempo(tempo: number, segments: ChordSegment[]): boolean {
  if (tempo < 125 || tempo / 2 < 55) return false;
  const durations = segments
    .filter((s) => !isNoChord(s.chord))
    .map((s) => (s.endBeat ?? 0) - (s.startBeat ?? 0))
    .sort((a, b) => a - b);
  if (durations.length < 4) return false;
  const low = durations[Math.floor(durations.length * 0.2)];
  return low >= 8;
}

/** Duration-weighted histogram of the pitch classes the detected chords sound. */
export function chordToneHistogram(segments: ChordSegment[]): number[] {
  const hist = new Array(12).fill(0);
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const dur = Math.max(0, seg.end - seg.start);
    const intervals = QUALITY_INTERVALS[seg.chord.quality];
    intervals.forEach((iv, idx) => {
      // The root carries the most weight for key-finding; colour tones the least.
      const w = idx === 0 ? 1 : idx === 1 ? 0.7 : 0.55;
      hist[(seg.chord.root + iv) % 12] += dur * w;
    });
  }
  const total = hist.reduce((a, b) => a + b, 0);
  if (total > 0) for (let i = 0; i < 12; i++) hist[i] /= total;
  return hist;
}

/**
 * Best chord for a short chroma window, for the live readout while recording.
 *
 * No temporal smoothing here by design: the caller wants immediate feedback
 * that the microphone is hearing something musical.
 */
export function bestChordForChroma(treble: Float32Array, bass: Float32Array): { state: number; score: number } {
  const scored = scoreChords(treble, bass, 1);
  let best = 0;
  for (let s = 1; s < TOTAL_STATES; s++) {
    if (scored.scores[s] > scored.scores[best]) best = s;
  }
  return { state: best, score: scored.scores[best] };
}

export { stateToChord };
