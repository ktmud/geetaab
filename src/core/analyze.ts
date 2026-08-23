import { CHROMA_HOP_SIZE, CHROMA_SAMPLE_RATE, computeChromagram } from './chroma';
import {
  aggregateByBeats,
  aggregateEnergyByBeats,
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
} from './beats';
import { medianOf, resample } from './dsp';
import { estimateKey, type KeyEstimate } from './key';

/**
 * Bumped whenever a change to this pipeline would give a stored song a
 * different tab. A song saved under an older number is re-analysed from its
 * audio the next time it is opened, so an accuracy fix reaches songs a player
 * already has rather than only new ones.
 *
 * History:
 *   1  the pipeline as first shipped
 *   2  graded N.C., free-time detection, parabolic tempo, three tab levels
 *   3  consolidateSegments: a song's own vocabulary settles drifting bars
 *   4  a hold pass on the easy level, for songs that change twice a bar
 *   5  tempo prior narrowed (width 0.9 → 0.6), calibrated on GuitarSet
 */
export const ANALYSIS_VERSION = 5;

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
  const mono22 = resample(samples, sampleRate, ONSET_SAMPLE_RATE);
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
  const key = estimateKey(chordToneHistogram(decoded.segments));

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
  };
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
  return {
    segments: bridgeShortGaps(mergeAdjacent(merged)),
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
