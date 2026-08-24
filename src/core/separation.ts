import { FFT, hannWindow } from './fft';

/**
 * Pulling a voice out of a band, by what repeats.
 *
 * Popular music's accompaniment is a pattern played over and over; the voice
 * on top of it is not. So fold the spectrogram into that pattern's own length
 * and take the median of each bin across the repeats: the guitar figure that
 * happens every bar survives the median, and the words sung once over it do
 * not. Subtract the model from the mixture and what is left is the part that
 * did not repeat. Rafii and Pardo published this as REPET in 2013.
 *
 * The argument for it here is the same as for everything else in this folder:
 * a few hundred lines of arithmetic rather than eighty megabytes of weights,
 * so it ships with the page and runs in the tab. A converted network would
 * separate better and could replace this without anything above noticing.
 *
 * It has an unusual advantage in this app. REPET normally has to find the
 * repeating period itself, from an autocorrelation that easily locks onto half
 * or twice the truth. Here the period is often already known — the analysis
 * reports a tempo and frequently the loop the song is built on — so the one
 * fragile step can be skipped.
 *
 * What defeats it: a song with no repeating accompaniment, a live take that
 * drifts, a voice mixed like an instrument. It reports how many repetitions it
 * found so a caller can say so rather than present a bad split as a good one.
 *
 * Ported from the Swift in the native app, which was itself written against
 * this codebase's FFT — the two are held to the same numbers by tests on both
 * sides rather than by hope.
 *
 * ## It is deliberately not in the chord pipeline
 *
 * The obvious idea — pull the voice out, then read the chords off what is left
 * — was measured on the corpus and it makes the tab worse. Three arms, same
 * fifteen scored songs:
 *
 *     arm                              vocabulary   order   oprec    oF1
 *     the mixture, as shipped               96.24   82.72   76.92   78.22
 *     REPET over the whole song             98.27   58.55   78.02   61.56
 *     REPET over six-loop windows           96.35   69.98   76.11   70.54
 *
 * Read the first column on its own and separation looks like a clear win. It
 * is the position-blind number, and this is exactly the case it was known to
 * flatter: the chords that survive are more likely to be in the song's
 * vocabulary, because the ones that did not survive were the unusual ones.
 * Every position-aware number falls, by eight points at best and seventeen at
 * worst.
 *
 * The mechanism is not subtle once the other columns are read. Changes per
 * minute collapse — 22.4 to 4.2 on one song — sandwiches go from eighteen to
 * none, and the median detected bar stretches to about twice the printed one.
 * REPET's model is periodic by construction: it is the median across repeats
 * at each phase. A chord that differs between one repeat and the next is not
 * in that median, so it is subtracted out as "voice". The thing being detected
 * — where the harmony changes — is precisely the thing that varies between
 * repeats, so the separator removes the signal along with the singer.
 *
 * Windowing limits the damage, because a model over six loops follows the song
 * rather than averaging the whole of it, but it cannot remove it: inside a
 * window the same argument holds. It also broke two songs outright — a key
 * change went from 100 to 76.5 on vocabulary, and a fingerpicked piece started
 * reading as free time, its pulse flattened along with everything else.
 *
 * So this ships as a tested, working separator with no caller in the chord
 * path. It has a real job on the native side, feeding a voice to on-device
 * speech recognition to line lyrics up with the recording, and there removing
 * the accompaniment is the goal rather than a side effect.
 *
 * Reproduce it: `npx vite-node scripts/regress.mjs --separate` and
 * `--separate-adaptive`, against a corpus.
 */
export interface Separation {
  /** What did not repeat: the voice, mostly. */
  vocals: Float32Array;
  /** What did: the band. */
  accompaniment: Float32Array;
  sampleRate: number;
  /** The period it folded on. If this is wrong the split is, and this says so. */
  periodSeconds: number;
  /** How many times that period fitted. Below three or four the median is weak. */
  repetitions: number;
}

export type SeparationRefusalKind = 'tooShort' | 'notEnoughRepetitions' | 'noRepetitionFound';

/**
 * Why a separation could not be attempted.
 *
 * Thrown rather than swallowed, because each of these has something useful to
 * say: "record a little more of it" is advice, and a silently worse tab is not.
 */
export class SeparationRefusal extends Error {
  readonly kind: SeparationRefusalKind;
  readonly found?: number;
  readonly needed?: number;
  readonly secondsWanted?: number;

  constructor(kind: SeparationRefusalKind, detail?: { found?: number; needed?: number; secondsWanted?: number }) {
    super(kind);
    this.name = 'SeparationRefusal';
    this.kind = kind;
    this.found = detail?.found;
    this.needed = detail?.needed;
    this.secondsWanted = detail?.secondsWanted;
  }
}

export interface SeparationOptions {
  fftSize?: number;
  hopSize?: number;
  /** Below this many repeats the median has too little to average over. */
  minimumRepetitions?: number;
  /**
   * Bins under this go to the accompaniment whatever the model says. A voice
   * has almost nothing below it and a bass guitar has almost nothing above, so
   * the one place the split is reliably wrong is worth forcing.
   */
  vocalFloorHz?: number;
  /** The repeating period in seconds, when the caller already knows it. */
  periodHint?: number;
}

/** Complex forward transform of one real frame, into `re`/`im` of length size. */
function forward(fft: FFT, frame: Float64Array, re: Float64Array, im: Float64Array): void {
  re.set(frame);
  im.fill(0);
  fft.transform(re, im);
}

/**
 * Inverse transform, real part only.
 *
 * There is no inverse on the FFT class, and it does not need one: conjugate,
 * transform, conjugate, divide by N is the inverse, and the arithmetic is the
 * same either way round.
 */
function inverse(fft: FFT, re: Float64Array, im: Float64Array, out: Float64Array): void {
  const n = fft.size;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft.transform(re, im);
  for (let i = 0; i < n; i++) out[i] = re[i] / n;
}

export function separateRepet(
  samples: Float32Array,
  sampleRate: number,
  options: SeparationOptions = {},
): Separation {
  const fftSize = options.fftSize ?? 4096;
  const hopSize = options.hopSize ?? 1024;
  const minimumRepetitions = options.minimumRepetitions ?? 3;
  const vocalFloorHz = options.vocalFloorHz ?? 100;

  const bins = fftSize / 2 + 1;
  const frames = Math.max(1, Math.floor(samples.length / hopSize) + 1);
  if (samples.length <= fftSize || frames <= 8) throw new SeparationRefusal('tooShort');

  const fft = new FFT(fftSize);
  const window = hannWindow(fftSize);
  const half = fftSize >> 1;

  // --- Pass one: the magnitude spectrogram, and the model built from it.
  const magnitude = new Float32Array(frames * bins);
  const frame = new Float64Array(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let f = 0; f < frames; f++) {
    const start = f * hopSize - half;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      frame[i] = idx >= 0 && idx < samples.length ? samples[idx] * window[i] : 0;
    }
    forward(fft, frame, re, im);
    const base = f * bins;
    for (let k = 0; k < bins; k++) magnitude[base + k] = Math.hypot(re[k], im[k]);
  }

  const framesPerSecond = sampleRate / hopSize;
  const period = choosePeriod(magnitude, frames, bins, framesPerSecond, minimumRepetitions, options.periodHint);
  const repetitions = Math.floor(frames / period);
  if (repetitions < minimumRepetitions) {
    throw new SeparationRefusal('notEnoughRepetitions', {
      found: repetitions,
      needed: minimumRepetitions,
      secondsWanted: (minimumRepetitions * period) / framesPerSecond,
    });
  }

  // The repeating model: for each position in the period and each bin, the
  // median across every repeat. A median rather than a mean, because one loud
  // sung note should not drag the model up towards itself.
  const model = new Float32Array(period * bins);
  const bucket = new Float64Array(repetitions);
  for (let phase = 0; phase < period; phase++) {
    for (let k = 0; k < bins; k++) {
      let count = 0;
      for (let r = 0; r < repetitions; r++) {
        const f = r * period + phase;
        if (f >= frames) break;
        bucket[count++] = magnitude[f * bins + k];
      }
      if (count === 0) continue;
      const slice = Array.prototype.slice.call(bucket, 0, count).sort((a: number, b: number) => a - b);
      model[phase * bins + k] =
        count % 2 === 1 ? slice[(count - 1) / 2] : (slice[count / 2 - 1] + slice[count / 2]) / 2;
    }
  }

  // --- Pass two: mask each frame and put the signal back together.
  const floorBin = Math.min(bins - 1, Math.round((vocalFloorHz / sampleRate) * fftSize));
  const vocals = new Float64Array(samples.length);
  const band = new Float64Array(samples.length);
  const norm = new Float64Array(samples.length);
  const vocalRe = new Float64Array(fftSize);
  const vocalIm = new Float64Array(fftSize);
  const bandRe = new Float64Array(fftSize);
  const bandIm = new Float64Array(fftSize);
  const rebuilt = new Float64Array(fftSize);

  for (let f = 0; f < frames; f++) {
    const start = f * hopSize - half;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      frame[i] = idx >= 0 && idx < samples.length ? samples[idx] * window[i] : 0;
    }
    forward(fft, frame, re, im);

    const phase = (f % period) * bins;
    for (let k = 0; k < bins; k++) {
      const value = Math.hypot(re[k], im[k]);
      // The repeating part cannot be louder than the mixture it is part of.
      const repeating = Math.min(model[phase + k], value);
      let share = value > 1e-9 ? repeating / value : 1;
      if (k <= floorBin) share = 1;
      bandRe[k] = re[k] * share;
      bandIm[k] = im[k] * share;
      vocalRe[k] = re[k] * (1 - share);
      vocalIm[k] = im[k] * (1 - share);
      // The upper half is the conjugate mirror, so the inverse comes back real.
      if (k > 0 && k < bins - 1) {
        const mirror = fftSize - k;
        bandRe[mirror] = bandRe[k];
        bandIm[mirror] = -bandIm[k];
        vocalRe[mirror] = vocalRe[k];
        vocalIm[mirror] = -vocalIm[k];
      }
    }

    overlapAdd(fft, vocalRe, vocalIm, window, rebuilt, start, vocals, null);
    overlapAdd(fft, bandRe, bandIm, window, rebuilt, start, band, norm);
  }

  // One normalisation for both, from the window overlap, which also cleans up
  // the ends where fewer frames overlap.
  const outVocals = new Float32Array(samples.length);
  const outBand = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const n = Math.max(norm[i], 1e-6);
    outVocals[i] = vocals[i] / n;
    outBand[i] = band[i] / n;
  }

  return {
    vocals: outVocals,
    accompaniment: outBand,
    sampleRate,
    periodSeconds: period / framesPerSecond,
    repetitions,
  };
}

function overlapAdd(
  fft: FFT,
  re: Float64Array,
  im: Float64Array,
  window: Float64Array,
  rebuilt: Float64Array,
  start: number,
  out: Float64Array,
  norm: Float64Array | null,
): void {
  inverse(fft, re, im, rebuilt);
  for (let i = 0; i < fft.size; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= out.length) continue;
    // Windowed on the way in and on the way out, which is what makes the
    // overlap sum flat rather than rippling at the hop rate.
    out[idx] += rebuilt[i] * window[i];
    if (norm) norm[idx] += window[i] * window[i];
  }
}

/**
 * The period to fold on, in frames.
 *
 * A caller that already knows it says so. Otherwise it comes from the beat
 * spectrum — how much the recording resembles itself a given distance back —
 * which is the fragile step this app usually gets to skip.
 */
function choosePeriod(
  magnitude: Float32Array,
  frames: number,
  bins: number,
  framesPerSecond: number,
  minimumRepetitions: number,
  hint?: number,
): number {
  const longestUsable = Math.floor(frames / Math.max(1, minimumRepetitions));
  if (hint && hint > 0) {
    const period = Math.round(hint * framesPerSecond);
    if (period < 4) throw new SeparationRefusal('noRepetitionFound');
    // Deliberately not halved to make it fit. A four-second loop of G then C is
    // not two two-second loops: folding at half its length puts the two chords
    // into the same median and models neither. When the caller knows the period
    // and the take is too short to hold it several times over, the honest
    // answer is that the take is too short.
    if (period > longestUsable) {
      throw new SeparationRefusal('notEnoughRepetitions', {
        found: Math.floor(frames / period),
        needed: minimumRepetitions,
        secondsWanted: (minimumRepetitions * period) / framesPerSecond,
      });
    }
    return period;
  }

  // Measured band by band and then averaged, not on total loudness: a drum kit
  // makes the loudness repeat every beat whatever the harmony does, and folding
  // on a beat would model nothing. What repeats usefully here is the spectrum,
  // which is to say the chords.
  const bandCount = 64;
  const bands = new Float64Array(frames * bandCount);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    for (let b = 0; b < bandCount; b++) {
      // Log-spaced, so the bass gets as many bands as the top octave and a
      // chord change moves as much of the picture as a cymbal does.
      const lo = Math.floor(Math.pow(bins - 1, b / bandCount));
      const hi = Math.min(bins, Math.max(lo + 1, Math.floor(Math.pow(bins - 1, (b + 1) / bandCount))));
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += magnitude[base + k];
      bands[f * bandCount + b] = sum / Math.max(1, hi - lo);
    }
  }
  // Each band to zero mean and unit variance, so a loud band cannot decide the
  // answer for the quiet ones.
  for (let b = 0; b < bandCount; b++) {
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += bands[f * bandCount + b];
    mean /= frames;
    let variance = 0;
    for (let f = 0; f < frames; f++) {
      const d = bands[f * bandCount + b] - mean;
      bands[f * bandCount + b] = d;
      variance += d * d;
    }
    const deviation = Math.sqrt(variance / frames);
    if (deviation > 1e-9) {
      for (let f = 0; f < frames; f++) bands[f * bandCount + b] /= deviation;
    }
  }

  const minLag = Math.max(4, Math.floor(0.5 * framesPerSecond));
  const maxLag = Math.min(longestUsable, Math.floor(12 * framesPerSecond));
  if (maxLag <= minLag) throw new SeparationRefusal('noRepetitionFound');

  const spectrum = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let f = lag; f < frames; f++) {
      const a = f * bandCount;
      const c = (f - lag) * bandCount;
      for (let b = 0; b < bandCount; b++) sum += bands[a + b] * bands[c + b];
    }
    spectrum[lag] = sum / ((frames - lag) * bandCount);
  }

  let peak = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (spectrum[lag] > spectrum[peak]) peak = lag;
  if (!(spectrum[peak] > 0)) throw new SeparationRefusal('noRepetitionFound');

  // Among the lags that repeat about as well as the best one, take the longest.
  //
  // The asymmetry is real and runs the way that is easy to get backwards. A
  // multiple of the true period is always safe: fold at twice the loop and
  // identical content still lines up, at the cost of half as many repeats to
  // take a median over. A submultiple is only safe if the music really repeats
  // that fast, and it usually does not — drums and a strummed rhythm repeat
  // every bar while the harmony repeats every four, so the shortest strong lag
  // is typically one bar, and folding there puts a G and a C into the same
  // median and models neither.
  let best = peak;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (spectrum[lag] >= spectrum[peak] * 0.9 && lag > best) best = lag;
  }
  return best;
}
