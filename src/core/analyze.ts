import { CHROMA_HOP_SIZE, CHROMA_SAMPLE_RATE, computeChromagram } from './chroma';
import {
  aggregateByBeats,
  aggregateEnergyByBeats,
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
import { resample } from './dsp';
import { estimateKey, type KeyEstimate } from './key';

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
  let tempo = opts.tempoHint ?? estimateTempo(onset).bpm;
  let beats = beatGrid(onset, tempo, duration);

  report('listening for chords', 0.5);
  const chroma = computeChromagram(mono11, CHROMA_SAMPLE_RATE);
  const frameRate = CHROMA_SAMPLE_RATE / CHROMA_HOP_SIZE;

  report('working out the changes', 0.75);
  let decoded = decodeOnGrid(chroma, frameRate, beats);

  if (!opts.tempoHint && shouldHalveTempo(tempo, decoded.segments)) {
    tempo /= 2;
    beats = beatGrid(onset, tempo, duration);
    decoded = decodeOnGrid(chroma, frameRate, beats);
  }

  report('naming the key', 0.9);
  const changeBeats = decoded.segments.map((s) => s.startBeat ?? 0);
  const beatsPerBar = opts.beatsPerBar ?? estimateBeatsPerBar(changeBeats);
  const barPhase = estimateBarPhase(changeBeats, beatsPerBar, decoded.beatCount, decoded.beatEnergy);
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
  };
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

function decodeOnGrid(
  chroma: ReturnType<typeof computeChromagram>,
  frameRate: number,
  beats: number[],
): Decoded {
  const treble = aggregateByBeats(chroma.treble, chroma.frames, frameRate, beats);
  const bass = aggregateByBeats(chroma.bass, chroma.frames, frameRate, beats);
  const beatEnergy = aggregateEnergyByBeats(chroma.energy, chroma.frames, frameRate, beats);

  const scored = scoreChords(treble.data, bass.data, treble.count, beatEnergy, { bassWeight: 0.3 });
  // One beat is the shortest chord worth writing down, so the change cost here
  // is far lower than a frame-level decode would use.
  const path = decodeChords(scored, { beta: 22, changePenalty: 2.2, relatedBonus: 0.4 });
  const beatTimes = beats.slice(0, treble.count);
  const raw = pathToSegments(path, beatTimes, beats[beats.length - 1] ?? 0, scored.scores);
  // The decode ran on the beat grid, so segment indices are already beat
  // numbers; deriving them from timestamps would accumulate rounding drift.
  for (const seg of raw) {
    seg.startBeat = seg.startIndex;
    seg.endBeat = seg.endIndex;
  }
  refineSegments(raw, treble.data, bass.data, treble.count);
  return {
    segments: mergeAdjacent(raw),
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
