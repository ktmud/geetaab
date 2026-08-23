import { resumeAudio, sharedAudioContext } from './context';

export interface Transport {
  readonly currentTime: number;
  readonly playing: boolean;
  readonly duration: number;
  rate: number;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  dispose(): void;
}

/**
 * Transport backed by an <audio> element.
 *
 * `preservesPitch` is why: the browser time-stretches natively, so practising
 * at 70% speed keeps the song in the key the tab was written in. Doing this
 * with an AudioBufferSourceNode would drop the pitch by five semitones.
 */
export class MediaTransport implements Transport {
  private el: HTMLAudioElement;
  private objectUrl: string | null = null;

  constructor(source: Blob | string) {
    this.el = new Audio();
    this.el.preload = 'auto';
    if (typeof source === 'string') {
      this.el.src = source;
    } else {
      this.objectUrl = URL.createObjectURL(source);
      this.el.src = this.objectUrl;
    }
    setPreservesPitch(this.el, true);
  }

  get element(): HTMLAudioElement {
    return this.el;
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  get playing(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  get duration(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  get rate(): number {
    return this.el.playbackRate;
  }

  set rate(value: number) {
    this.el.playbackRate = value;
    setPreservesPitch(this.el, true);
  }

  async play(): Promise<void> {
    await this.el.play();
  }

  pause(): void {
    this.el.pause();
  }

  seek(seconds: number): void {
    this.el.currentTime = Math.max(0, seconds);
  }

  whenReady(): Promise<void> {
    if (this.el.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) => {
      this.el.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  dispose(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

interface PitchPreserving {
  preservesPitch?: boolean;
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
}

function setPreservesPitch(el: HTMLAudioElement, value: boolean): void {
  const target = el as HTMLAudioElement & PitchPreserving;
  if ('preservesPitch' in target) target.preservesPitch = value;
  if ('mozPreservesPitch' in target) target.mozPreservesPitch = value;
  if ('webkitPreservesPitch' in target) target.webkitPreservesPitch = value;
}

/**
 * Transport with no audio at all, driven by the AudioContext clock.
 *
 * Practising against the click alone is the point once the changes are learned,
 * and it is the only option when the recording is too rough to play back.
 */
export class ClockTransport implements Transport {
  private base = 0;
  private startedAt = 0;
  private running = false;
  private _rate = 1;
  readonly duration: number;

  constructor(duration: number) {
    this.duration = duration;
  }

  get currentTime(): number {
    if (!this.running) return this.base;
    const ctx = sharedAudioContext();
    return this.base + (ctx.currentTime - this.startedAt) * this._rate;
  }

  get playing(): boolean {
    return this.running;
  }

  get rate(): number {
    return this._rate;
  }

  set rate(value: number) {
    const now = this.currentTime;
    this._rate = value;
    this.base = now;
    this.startedAt = sharedAudioContext().currentTime;
  }

  async play(): Promise<void> {
    await resumeAudio();
    this.base = this.currentTime;
    this.startedAt = sharedAudioContext().currentTime;
    this.running = true;
  }

  pause(): void {
    this.base = this.currentTime;
    this.running = false;
  }

  seek(seconds: number): void {
    this.base = Math.max(0, seconds);
    this.startedAt = sharedAudioContext().currentTime;
  }

  dispose(): void {
    this.running = false;
  }
}

export interface MetronomeOptions {
  beats: number[];
  beatsPerBar: number;
  barPhase: number;
  volume?: number;
}

/**
 * Click scheduler with lookahead.
 *
 * Firing clicks from animation frames would put up to a frame of jitter on
 * every beat, which is audible. Instead each frame schedules the clicks due in
 * the next fraction of a second onto the audio clock, where they land exactly.
 */
export class Metronome {
  private nextIndex = 0;
  private scheduledUntil = -1;
  enabled = false;
  volume: number;
  private opts: MetronomeOptions;

  constructor(opts: MetronomeOptions) {
    this.opts = opts;
    this.volume = opts.volume ?? 0.35;
  }

  setBeats(opts: MetronomeOptions): void {
    this.opts = opts;
    this.reset(0);
  }

  reset(songTime: number): void {
    const { beats } = this.opts;
    let i = 0;
    while (i < beats.length && beats[i] < songTime) i++;
    this.nextIndex = i;
    this.scheduledUntil = -1;
  }

  /** Call once per animation frame with the transport's current position. */
  schedule(songTime: number, rate: number, lookaheadSeconds = 0.15): void {
    if (!this.enabled) {
      this.reset(songTime);
      return;
    }
    const ctx = sharedAudioContext();
    const { beats, beatsPerBar, barPhase } = this.opts;
    if (songTime < this.scheduledUntil - 0.5 || songTime > this.scheduledUntil + 1.5) {
      this.reset(songTime);
    }
    const horizon = songTime + lookaheadSeconds * rate;
    while (this.nextIndex < beats.length && beats[this.nextIndex] <= horizon) {
      const beatTime = beats[this.nextIndex];
      if (beatTime >= songTime - 0.05) {
        const when = ctx.currentTime + Math.max(0, (beatTime - songTime) / rate);
        const isDownbeat = ((this.nextIndex - barPhase) % beatsPerBar + beatsPerBar) % beatsPerBar === 0;
        this.click(ctx, when, isDownbeat);
      }
      this.nextIndex++;
    }
    this.scheduledUntil = horizon;
  }

  private click(ctx: AudioContext, when: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1000;
    const peak = this.volume * (accent ? 1 : 0.6);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
  }
}
