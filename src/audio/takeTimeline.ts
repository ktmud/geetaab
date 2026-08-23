/** A stretch of the song the recorder never received. */
export interface TakeGap {
  /** Where the hole sits in the take, in seconds of captured audio. */
  at: number;
  seconds: number;
}

export interface TakeTimelineOptions {
  /**
   * How far the take may fall behind the clock before it counts as a hole.
   *
   * Audio arrives in chunks and every graph has some latency, so the take is
   * always a little behind; the baseline below absorbs that. This is the extra
   * on top, and it is set well past chunk jitter so ordinary scheduling never
   * reads as lost audio.
   */
  gapThreshold?: number;
}

/**
 * Watches for audio the recorder was supposed to receive and did not.
 *
 * A browser has many ways to stop delivering microphone audio and almost no
 * way of saying so: on iOS the context is suspended when the tab is hidden, a
 * call or Siri takes the input away, plugging in headphones re-routes the
 * device mid-take, and another tab can claim the microphone outright. Some of
 * those fire an event. Not all of them do, and none of them do consistently
 * across browsers.
 *
 * So rather than enumerate the causes, this measures the effect. The take
 * should grow one second per second; whenever it does not, whatever the
 * reason, the missing stretch is written down as a hole. The analysis is then
 * told that the two sides were not adjacent in time, instead of putting a
 * chord change where a phone call was.
 */
export class TakeTimeline {
  private readonly sampleRate: number;
  private readonly gapThreshold: number;
  private samples = 0;
  private startedAt = 0;
  private preRollSeconds = 0;
  private accounted = 0;
  /** The take's steady-state lag: chunk size plus graph latency. */
  private baseline = Number.POSITIVE_INFINITY;
  private lastPushAt = 0;
  private running = false;
  private readonly holes: TakeGap[] = [];

  constructor(sampleRate: number, opts: TakeTimelineOptions = {}) {
    this.sampleRate = sampleRate;
    this.gapThreshold = opts.gapThreshold ?? 0.35;
  }

  /**
   * Begin the take.
   *
   * `preRollSamples` is the live window flushed in from the ring buffer, which
   * is audio from *before* this moment — so it counts toward the take's length
   * without counting toward the time the take has been running.
   */
  begin(now: number, preRollSamples: number): void {
    this.running = true;
    this.startedAt = now;
    this.lastPushAt = now;
    this.samples = preRollSamples;
    this.preRollSeconds = preRollSamples / this.sampleRate;
    this.accounted = 0;
    this.baseline = Number.POSITIVE_INFINITY;
    this.holes.length = 0;
  }

  /** Record a captured chunk. Returns a hole if one just became visible. */
  push(now: number, sampleCount: number): TakeGap | null {
    this.lastPushAt = now;
    if (!this.running) return null;
    this.samples += sampleCount;

    const expected = this.preRollSeconds + (now - this.startedAt) / 1000;
    const drift = expected - this.samples / this.sampleRate - this.accounted;
    if (drift < this.baseline) this.baseline = drift;
    const missing = drift - this.baseline;
    if (missing <= this.gapThreshold) return null;

    const hole: TakeGap = { at: this.samples / this.sampleRate, seconds: missing };
    this.accounted += missing;
    this.holes.push(hole);
    return hole;
  }

  /** Seconds since audio last arrived, for a stall watchdog. */
  silenceFor(now: number): number {
    return this.running ? (now - this.lastPushAt) / 1000 : 0;
  }

  get seconds(): number {
    return this.samples / this.sampleRate;
  }

  get gaps(): TakeGap[] {
    return this.holes.map((hole) => ({ ...hole }));
  }

  /** Total audio the recorder believes it never got. */
  get missingSeconds(): number {
    return this.accounted;
  }

  reset(): void {
    this.running = false;
    this.samples = 0;
    this.accounted = 0;
    this.holes.length = 0;
    this.baseline = Number.POSITIVE_INFINITY;
  }
}
