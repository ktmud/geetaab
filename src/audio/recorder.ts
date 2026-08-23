import { bestChordForChroma } from '../core/analyze';
import { averageChroma, computeChromagram, CHROMA_SAMPLE_RATE } from '../core/chroma';
import { resample } from '../core/dsp';
import { MusicGate, musicFeaturesFrom } from '../core/music';
import { audioContextCtor } from './context';
import { SpectrogramBinner } from './spectrogram';

export type RecorderStatus = 'waiting' | 'recording';

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
    return this.recording ? 'recording' : 'waiting';
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser will not give a web page microphone access.');
    }
    // Processing meant for speech would fight the analysis: gain riding smears
    // dynamics and noise suppression carves holes in sustained chords.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const ctx = new (audioContextCtor())();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.source = ctx.createMediaStreamSource(this.stream);
    this.chunks = [];
    this.total = 0;
    this.ring = [];
    this.ringTotal = 0;
    this.stopped = false;
    this.recording = !this.opts.waitForMusic;
    this.gate = this.opts.waitForMusic ? new MusicGate() : null;
    this.binner = this.opts.onSpectrum ? new SpectrogramBinner(ctx.sampleRate) : null;

    this.node = await this.createCaptureNode(ctx);
    this.source.connect(this.node);
    // Keep the graph pulling without making the microphone audible.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(ctx.destination);

    const interval = this.opts.liveIntervalMs ?? 250;
    this.timer = window.setInterval(() => this.emitLiveFrame(), interval);
  }

  /** Start the take by hand, without waiting for the gate to hear music. */
  startNow(): void {
    this.beginRecording();
  }

  private beginRecording(): void {
    if (this.recording || this.stopped) return;
    this.recording = true;
    // The live window becomes the head of the take: the gate needs most of a
    // second to be sure, and that second contains the song's first strum.
    this.chunks = [...this.ring];
    this.total = this.ringTotal;
    if (this.binner && this.opts.onSpectrum) {
      for (const chunk of this.chunks) this.opts.onSpectrum(this.binner.column(chunk));
    }
  }

  private async createCaptureNode(ctx: AudioContext): Promise<AudioNode> {
    const accept = (data: Float32Array): void => {
      if (this.stopped) return;
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

    if (this.gate && !this.recording) {
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
  async stop(): Promise<{ samples: Float32Array; sampleRate: number }> {
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
    this.teardown();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    return { samples, sampleRate };
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
    this.teardown();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private teardown(): void {
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

function normalize(vec: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const n = Math.sqrt(sum);
  if (n > 1e-9) for (let i = 0; i < vec.length; i++) vec[i] /= n;
}
