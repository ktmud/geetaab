import { bestChordForChroma } from '../core/analyze';
import { averageChroma, computeChromagram, CHROMA_SAMPLE_RATE } from '../core/chroma';
import { resample } from '../core/dsp';
import { MusicGate, musicFeaturesFrom } from '../core/music';
import { audioContextCtor } from './context';
import { RAW_AUDIO_CONSTRAINTS, readProcessing, type ProcessingVerdict } from './processing';
import { SpectrogramBinner } from './spectrogram';
import { TakeTimeline, type TakeGap } from './takeTimeline';

export type { TakeGap } from './takeTimeline';
export type { ProcessingVerdict } from './processing';

export type RecorderStatus = 'waiting' | 'recording' | 'interrupted';

/**
 * Something the player should be told about, rather than left to discover from
 * a bad tab.
 *
 * A browser stops delivering microphone audio for a dozen reasons and says so
 * for about half of them. Everything the recorder can work out — from an event
 * where there is one, and from the take falling behind the clock where there is
 * not — comes out here.
 */
export type RecorderNotice =
  | { kind: 'processing'; verdict: ProcessingVerdict }
  | { kind: 'interrupted'; reason: 'suspended' | 'muted' | 'hidden' }
  | { kind: 'resumed'; gapSeconds: number }
  | { kind: 'gap'; gap: TakeGap }
  | { kind: 'stalled'; seconds: number }
  | { kind: 'deviceLost' };

export interface FinishedTake {
  samples: Float32Array;
  sampleRate: number;
  /** Stretches the recorder never received, so nothing downstream reads the
      two sides of an interruption as adjacent in time. */
  gaps: TakeGap[];
  /** What the browser actually did to the input, whatever it was asked. */
  processing: ProcessingVerdict | null;
}

export interface LiveFrame {
  /** RMS level, 0..1, for the meter. */
  level: number;
  /** Peak level over the window, for clipping warnings. */
  peak: number;
  chroma: number[];
  /** Chord lattice state of the current best guess. */
  chordState: number;
  chordScore: number;
  /** Seconds of the take so far; zero while still waiting for music. */
  seconds: number;
  /** Whether the take has started, or the recorder is still holding for music. */
  status: RecorderStatus;
}

const WORKLET_SOURCE = `
class GeetaabCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(4096);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.chunk[this.offset++] = channel[i];
      if (this.offset === this.chunk.length) {
        this.port.postMessage(this.chunk);
        this.chunk = new Float32Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('geetaab-capture', GeetaabCapture);
`;

export interface RecorderOptions {
  onFrame?: (frame: LiveFrame) => void;
  /** How often to run the live chord readout, in milliseconds. */
  liveIntervalMs?: number;
  /** How much recent audio the live readout looks at, in seconds. */
  liveWindowSeconds?: number;
  maxSeconds?: number;
  onMaxReached?: () => void;
  /**
   * Hold the take until the microphone actually hears music. The audio heard
   * while holding is not kept — apart from the live window, which is flushed
   * into the take when the music starts so the first strum is never clipped.
   */
  waitForMusic?: boolean;
  /** One log-frequency spectrum column per captured chunk of the take. */
  onSpectrum?: (column: Float32Array) => void;
  /** Interruptions, holes, stalls, and what the browser did to the input. */
  onNotice?: (notice: RecorderNotice) => void;
  /** No audio for this long, while recording, counts as a stall. */
  stallSeconds?: number;
}

/**
 * Microphone capture with a live chord readout.
 *
 * Raw PCM is kept rather than an encoded stream because the analysis needs
 * uncompressed samples, and because the same buffer feeds the live readout that
 * tells the user the microphone is actually hearing the song.
 */
export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** The take. Empty until recording begins. */
  private chunks: Float32Array[] = [];
  private total = 0;
  /** The most recent audio, kept regardless of phase for the live readout. */
  private ring: Float32Array[] = [];
  private ringTotal = 0;
  private timer: number | null = null;
  private opts: RecorderOptions;
  private stopped = true;
  private recording = false;
  private gate: MusicGate | null = null;
  private binner: SpectrogramBinner | null = null;
  private timeline: TakeTimeline | null = null;
  private processing: ProcessingVerdict | null = null;
  private interrupted = false;
  private interruptedAt = 0;
  private stallReported = false;
  /** Listeners to unhook on teardown, so a torn-down recorder is really gone. */
  private cleanups: (() => void)[] = [];

  constructor(opts: RecorderOptions = {}) {
    this.opts = opts;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get seconds(): number {
    return this.total / this.sampleRate;
  }

  get isRecording(): boolean {
    return !this.stopped && this.recording;
  }

  get status(): RecorderStatus {
    if (this.interrupted) return 'interrupted';
    return this.recording ? 'recording' : 'waiting';
  }

  /** What the browser did to the input, once it has said. */
  get processingVerdict(): ProcessingVerdict | null {
    return this.processing;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser will not give a web page microphone access.');
    }
    // Processing meant for speech would fight the analysis: gain riding smears
    // dynamics and noise suppression carves holes in sustained chords.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO_CONSTRAINTS });

    try {
      await this.setUp();
    } catch (error) {
      // Whatever failed, the microphone is not staying on because of it. The
      // caller sees the error; the device light does not stay lit.
      this.teardown();
      await this.ctx?.close().catch(() => undefined);
      this.ctx = null;
      throw error;
    }
  }

  private async setUp(): Promise<void> {
    const track = this.stream?.getAudioTracks()[0];
    if (track) await this.verifyProcessing(track);

    const ctx = new (audioContextCtor())();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.source = ctx.createMediaStreamSource(this.stream!);
    this.chunks = [];
    this.total = 0;
    this.ring = [];
    this.ringTotal = 0;
    this.stopped = false;
    this.interrupted = false;
    this.stallReported = false;
    this.recording = !this.opts.waitForMusic;
    this.gate = this.opts.waitForMusic ? new MusicGate() : null;
    this.binner = this.opts.onSpectrum ? new SpectrogramBinner(ctx.sampleRate) : null;
    this.timeline = new TakeTimeline(ctx.sampleRate);
    if (this.recording) this.timeline.begin(now(), 0);

    this.node = await this.createCaptureNode(ctx);
    this.source.connect(this.node);
    // Keep the graph pulling without making the microphone audible.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(ctx.destination);

    this.watchForInterruptions(ctx);

    const interval = this.opts.liveIntervalMs ?? 250;
    this.timer = window.setInterval(() => this.emitLiveFrame(), interval);
  }

  /**
   * Find out whether the browser honoured the constraints, and say so.
   *
   * Asking is all a page can do, and Safari on iOS in particular accepts these
   * and ignores them. One re-application is worth trying — some browsers apply
   * constraints only after the track is live — but if the speech chain is still
   * on after that, the honest move is to tell the player rather than to hand
   * back a take that quietly had the music filtered out of it.
   */
  private async verifyProcessing(track: MediaStreamTrack): Promise<void> {
    const read = (): ProcessingVerdict =>
      readProcessing(track.getSettings?.() as Record<string, boolean | undefined> | undefined);
    let verdict = read();
    if (verdict.processed && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints(RAW_AUDIO_CONSTRAINTS);
        verdict = read();
      } catch {
        // A browser that refuses the constraint has already told us its answer.
      }
    }
    this.processing = verdict;
    if (verdict.processed) this.notify({ kind: 'processing', verdict });
  }

  /** Start the take by hand, without waiting for the gate to hear music. */
  startNow(): void {
    this.beginRecording();
  }

  private notify(notice: RecorderNotice): void {
    this.opts.onNotice?.(notice);
  }

  private beginRecording(): void {
    if (this.recording || this.stopped) return;
    this.recording = true;
    // The live window becomes the head of the take: the gate needs most of a
    // second to be sure, and that second contains the song's first strum.
    this.chunks = [...this.ring];
    this.total = this.ringTotal;
    this.timeline?.begin(now(), this.total);
    if (this.binner && this.opts.onSpectrum) {
      for (const chunk of this.chunks) this.opts.onSpectrum(this.binner.column(chunk));
    }
  }

  /**
   * Notice when the browser stops delivering audio.
   *
   * Each of these fires in some browsers and not others, which is why none of
   * them is load-bearing on its own: the take's own drift against the clock is
   * what actually detects a hole. These exist so the interface can say what
   * happened while it is happening, rather than only afterwards.
   */
  private watchForInterruptions(ctx: AudioContext): void {
    const onStateChange = (): void => {
      if (this.stopped) return;
      // Safari adds an 'interrupted' state that is not in the standard union.
      const state = ctx.state as AudioContextState | 'interrupted';
      if (state === 'running') {
        this.markResumed();
      } else if (state === 'suspended' || state === 'interrupted') {
        this.markInterrupted('suspended');
      }
    };
    ctx.addEventListener('statechange', onStateChange);
    this.cleanups.push(() => ctx.removeEventListener('statechange', onStateChange));

    const track = this.stream?.getAudioTracks()[0];
    if (track) {
      const onMute = (): void => this.markInterrupted('muted');
      const onUnmute = (): void => this.markResumed();
      const onEnded = (): void => {
        this.markInterrupted('muted');
        this.notify({ kind: 'deviceLost' });
      };
      track.addEventListener('mute', onMute);
      track.addEventListener('unmute', onUnmute);
      track.addEventListener('ended', onEnded);
      this.cleanups.push(() => {
        track.removeEventListener('mute', onMute);
        track.removeEventListener('unmute', onUnmute);
        track.removeEventListener('ended', onEnded);
      });
    }

    if (typeof document !== 'undefined') {
      const onVisibility = (): void => {
        if (this.stopped) return;
        if (document.hidden) {
          // Hiding does not always suspend the context, so this is a hint
          // rather than a verdict; the statechange handler confirms it.
          if ((ctx.state as string) !== 'running') this.markInterrupted('hidden');
        } else {
          void ctx.resume().then(() => this.markResumed()).catch(() => undefined);
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }
  }

  private markInterrupted(reason: 'suspended' | 'muted' | 'hidden'): void {
    if (this.interrupted || this.stopped) return;
    this.interrupted = true;
    this.interruptedAt = now();
    this.notify({ kind: 'interrupted', reason });
  }

  private markResumed(): void {
    if (!this.interrupted || this.stopped) return;
    this.interrupted = false;
    this.stallReported = false;
    const gapSeconds = this.interruptedAt ? (now() - this.interruptedAt) / 1000 : 0;
    this.interruptedAt = 0;
    this.notify({ kind: 'resumed', gapSeconds });
  }

  private async createCaptureNode(ctx: AudioContext): Promise<AudioNode> {
    const accept = (data: Float32Array): void => {
      if (this.stopped) return;
      // Audio arriving is proof the interruption is over, whatever the events
      // did or did not say.
      if (this.interrupted) this.markResumed();
      this.ring.push(data);
      this.ringTotal += data.length;
      const keep = (this.opts.liveWindowSeconds ?? 1.5) * ctx.sampleRate;
      while (this.ring.length > 1 && this.ringTotal - this.ring[0].length >= keep) {
        this.ringTotal -= this.ring[0].length;
        this.ring.shift();
      }
      if (!this.recording) return;
      this.chunks.push(data);
      this.total += data.length;
      const gap = this.timeline?.push(now(), data.length);
      if (gap) this.notify({ kind: 'gap', gap });
      if (this.binner && this.opts.onSpectrum) this.opts.onSpectrum(this.binner.column(data));
      const max = this.opts.maxSeconds;
      if (max && this.total / ctx.sampleRate >= max) {
        this.opts.onMaxReached?.();
      }
    };

    if (ctx.audioWorklet) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(ctx, 'geetaab-capture', { numberOfOutputs: 1 });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => accept(event.data);
        return node;
      } catch {
        // Fall through to the deprecated node below.
      }
    }

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => accept(new Float32Array(event.inputBuffer.getChannelData(0)));
    return processor;
  }

  private recentSamples(seconds: number): Float32Array {
    const want = Math.floor(seconds * this.sampleRate);
    const out = new Float32Array(Math.min(want, this.ringTotal));
    let filled = out.length;
    for (let i = this.ring.length - 1; i >= 0 && filled > 0; i--) {
      const chunk = this.ring[i];
      const take = Math.min(filled, chunk.length);
      out.set(chunk.subarray(chunk.length - take), filled - take);
      filled -= take;
    }
    return out;
  }

  private emitLiveFrame(): void {
    const onFrame = this.opts.onFrame;
    if (this.stopped) return;

    // A take that has stopped growing while nothing said why. The drift
    // detector will write the hole down; this is so the screen does not sit
    // there looking like it is still working.
    if (this.recording && this.timeline) {
      const silence = this.timeline.silenceFor(now());
      const limit = this.opts.stallSeconds ?? 1;
      if (silence > limit && !this.stallReported) {
        this.stallReported = true;
        this.notify({ kind: 'stalled', seconds: silence });
      }
    }

    const window = this.opts.liveWindowSeconds ?? 1.5;
    const recent = this.recentSamples(window);
    if (recent.length < this.sampleRate * 0.3) return;

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < recent.length; i++) {
      sum += recent[i] * recent[i];
      const a = Math.abs(recent[i]);
      if (a > peak) peak = a;
    }
    const level = Math.sqrt(sum / recent.length);

    const mono = resample(recent, this.sampleRate, CHROMA_SAMPLE_RATE);
    // A shorter window than the full analysis uses: responsiveness matters more
    // than frequency resolution when the readout is only reassurance.
    const chroma = computeChromagram(mono, CHROMA_SAMPLE_RATE, { fftSize: 4096, hopSize: 1024 });
    const treble = Float32Array.from(averageChroma(chroma.treble, chroma.frames, chroma.energy));
    const bass = Float32Array.from(averageChroma(chroma.bass, chroma.frames, chroma.energy));
    normalize(treble);
    normalize(bass);
    const best = bestChordForChroma(treble, bass);

    if (this.gate && !this.recording && !this.interrupted) {
      // The gate reads the same analysis the readout just ran; hearing music
      // for a few windows in a row is what starts the take.
      if (this.gate.push(musicFeaturesFrom(chroma, level, best.score))) {
        this.beginRecording();
      }
    }

    onFrame?.({
      level,
      peak,
      chroma: Array.from(treble),
      chordState: best.state,
      chordScore: best.score,
      seconds: this.seconds,
      status: this.status,
    });
  }

  /** Stop capture and hand back everything recorded. */
  async stop(): Promise<FinishedTake> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const sampleRate = this.sampleRate;
    const samples = new Float32Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const gaps = this.timeline?.gaps ?? [];
    const processing = this.processing;
    this.teardown();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    return { samples, sampleRate, gaps, processing };
  }

  /** Abandon the recording without returning it. */
  async cancel(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.chunks = [];
    this.total = 0;
    this.ring = [];
    this.ringTotal = 0;
    this.timeline?.reset();
    this.teardown();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private teardown(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      // Disconnecting a node that never connected is not an error worth raising.
    }
    if (this.node && 'port' in this.node) {
      (this.node as AudioWorkletNode).port.onmessage = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source = null;
    this.node = null;
  }
}

/** A clock that cannot be moved by the user or by a daylight-saving change. */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function normalize(vec: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const n = Math.sqrt(sum);
  if (n > 1e-9) for (let i = 0; i < vec.length; i++) vec[i] /= n;
}
