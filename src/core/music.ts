import type { Chromagram } from './chroma';

/**
 * Deciding whether the microphone is hearing music at all.
 *
 * The obvious tool — an off-the-shelf voice-activity model — is the wrong one:
 * VADs are trained to find speech and to *reject* music, the exact opposite of
 * what "wait for the song to start" needs, and shipping model weights would
 * break this app's promise that nothing but the page ever downloads. What
 * separates a song from a quiet room, a conversation, or a fan is already
 * measured by the chroma analysis the live chord readout runs four times a
 * second, so the detector reads its answer from there instead:
 *
 * - a song is *loud enough* to register at all,
 * - its energy *concentrates* on a few pitch classes instead of smearing
 *   across all twelve the way broadband noise does,
 * - the harmony *holds still* for beats at a time, where speech glides to a
 *   new pitch every syllable,
 * - its loudness *breathes* — strums, plucks and drums put a pulse on the
 *   energy envelope that mains hum and appliance drone entirely lack, and
 * - the pitch classes that are lit *look like a chord* to the same
 *   zero-centred templates the transcription uses, which a slamming door or a
 *   vacuum cleaner never will.
 *
 * No single feature survives every impostor — steady noise is as "steady" as
 * any chord, and a mains hum is literally a perfect fifth — but each impostor
 * fails at least one, so the verdict is the conjunction.
 */
export interface MusicFeatures {
  /** RMS level of the analysis window, 0..1. */
  level: number;
  /** Share of pitch-class energy held by the top three classes, 0..1. */
  tonality: number;
  /** Similarity of chroma frames a quarter-second apart, 0..1. */
  steadiness: number;
  /** Variation of the energy envelope across the window, 0..~1. */
  activity: number;
  /** Best match against the zero-centred chord templates. */
  chordScore: number;
}

/** Below this RMS the room is silent for practical purposes. */
export const MUSIC_LEVEL_FLOOR = 0.0035;
/** Flat noise spreads 12 ways and lands near 0.28; played chords sit above 0.32. */
export const MUSIC_TONALITY_FLOOR = 0.3;
/** Held harmony stays above 0.9; gliding speech falls under 0.81. */
export const MUSIC_STEADINESS_FLOOR = 0.85;
/** Hum and stationary noise barely move; strummed music swings far above. */
export const MUSIC_ACTIVITY_FLOOR = 0.1;
/** The centred templates score the noise floor near zero, so little is plenty. */
export const MUSIC_CHORD_FLOOR = 0.08;

export function isMusical(f: MusicFeatures): boolean {
  return (
    f.level >= MUSIC_LEVEL_FLOOR &&
    f.tonality >= MUSIC_TONALITY_FLOOR &&
    f.steadiness >= MUSIC_STEADINESS_FLOOR &&
    f.activity >= MUSIC_ACTIVITY_FLOOR &&
    f.chordScore >= MUSIC_CHORD_FLOOR
  );
}

/** Assemble the verdict's inputs from work the live readout has already done. */
export function musicFeaturesFrom(chroma: Chromagram, level: number, chordScore: number): MusicFeatures {
  return {
    level,
    tonality: chromaTonality(chroma),
    steadiness: chromaSteadiness(chroma),
    activity: chromaActivity(chroma),
    chordScore,
  };
}

/** Share of the energy-weighted mean chroma held by its three largest bins. */
export function chromaTonality(chroma: Chromagram): number {
  const { treble, frames, energy } = chroma;
  const mean = new Float64Array(12);
  let wsum = 0;
  for (let f = 0; f < frames; f++) {
    const w = energy[f];
    if (w <= 0) continue;
    for (let i = 0; i < 12; i++) mean[i] += treble[f * 12 + i] * w;
    wsum += w;
  }
  if (wsum <= 0) return 0;
  let total = 0;
  for (let i = 0; i < 12; i++) total += mean[i];
  if (total <= 0) return 0;
  const sorted = Array.from(mean).sort((a, b) => b - a);
  return (sorted[0] + sorted[1] + sorted[2]) / total;
}

/**
 * Mean cosine similarity between chroma frames roughly a quarter-second apart.
 *
 * The lag matters: neighbouring STFT frames share most of their samples, so
 * even noise looks steady one hop away. A quarter second is past the window
 * overlap but still shorter than a beat, which is the timescale on which
 * played harmony actually holds still.
 */
export function chromaSteadiness(chroma: Chromagram): number {
  const { treble, frames, energy, frameRate } = chroma;
  const lag = Math.max(1, Math.round(0.25 * frameRate));
  if (frames <= lag) return 0;
  let acc = 0;
  let wsum = 0;
  for (let f = 0; f + lag < frames; f++) {
    const w = Math.sqrt(energy[f] * energy[f + lag]);
    if (w <= 0) continue;
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += treble[f * 12 + i] * treble[(f + lag) * 12 + i];
    acc += dot * w;
    wsum += w;
  }
  return wsum > 0 ? acc / wsum : 0;
}

/**
 * Coefficient of variation of the per-frame energy envelope.
 *
 * Playing puts attacks and decays on the envelope; hum, drone and stationary
 * noise hold it flat. This is what keeps a loud refrigerator — tonal, steady,
 * and shaped like a bare fifth — from passing for a song.
 */
export function chromaActivity(chroma: Chromagram): number {
  const { frames, energy, fftSize, hopSize } = chroma;
  // The STFT zero-pads both ends, so the outermost frames fade in and out no
  // matter what the signal does; measured across them even a dead-steady hum
  // shows a pulse. Only the fully-covered interior frames can testify.
  const margin = Math.ceil(fftSize / 2 / hopSize);
  let lo = margin;
  let hi = frames - margin;
  if (hi - lo < 4) {
    lo = 0;
    hi = frames;
  }
  if (hi - lo < 2) return 0;
  let mean = 0;
  for (let f = lo; f < hi; f++) mean += energy[f];
  mean /= hi - lo;
  if (mean <= 0) return 0;
  let varSum = 0;
  for (let f = lo; f < hi; f++) {
    const d = energy[f] - mean;
    varSum += d * d;
  }
  return Math.sqrt(varSum / (hi - lo)) / mean;
}

export interface MusicGateOptions {
  /** Consecutive musical readings before the gate opens. */
  onCount?: number;
}

/**
 * Hysteresis over per-window verdicts.
 *
 * One window can pass on a cough or a doorbell; requiring several in a row
 * costs under a second of latency and stops the recorder springing on every
 * transient. Once open the gate stays open — a song's quiet bar is not the
 * song ending, and stopping is the player's call anyway.
 */
export class MusicGate {
  private streak = 0;
  private isOpen = false;
  private readonly onCount: number;

  constructor(opts: MusicGateOptions = {}) {
    this.onCount = opts.onCount ?? 3;
  }

  get open(): boolean {
    return this.isOpen;
  }

  push(features: MusicFeatures): boolean {
    if (!this.isOpen) {
      this.streak = isMusical(features) ? this.streak + 1 : 0;
      if (this.streak >= this.onCount) this.isOpen = true;
    }
    return this.isOpen;
  }
}
