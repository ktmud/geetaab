import { SPECTRO_BINS, SPECTRO_MIN_MIDI } from '../audio/spectrogram';
import { pitchClassHue } from '../music/pitchColor';

/** About thirty seconds of columns at the capture rate. */
const MIN_SPAN_COLUMNS = 350;

/**
 * Paints the take's spectrogram behind the recording screen.
 *
 * Columns land once in an offscreen buffer at one pixel per chunk, and every
 * repaint stretches the buffer across the viewport — so the backdrop always
 * shows the whole take, growing rightward for the first half minute and then
 * compressing as the song gets longer. Each semitone row takes the same
 * circle-of-fifths hue as the chroma meter above it, which keeps the backdrop
 * and the meter reading as one instrument.
 */
export class SpectroPainter {
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D | null;
  private readonly hues: number[];
  private count = 0;
  private target: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private raf = 0;

  constructor(capacity = 2400) {
    this.off = document.createElement('canvas');
    this.off.width = capacity;
    this.off.height = SPECTRO_BINS;
    this.octx = this.off.getContext('2d');
    this.hues = Array.from({ length: SPECTRO_BINS }, (_, b) => pitchClassHue(SPECTRO_MIN_MIDI + b));
  }

  attach(canvas: HTMLCanvasElement): void {
    this.target = canvas;
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(canvas);
    this.schedule();
  }

  push(column: Float32Array): void {
    const ctx = this.octx;
    if (!ctx || this.count >= this.off.width) return;
    const x = this.count++;
    for (let b = 0; b < SPECTRO_BINS; b++) {
      const value = column[b];
      if (value < 0.04) continue;
      ctx.fillStyle = `hsl(${this.hues[b]} 72% 58% / ${Math.min(1, Math.pow(value, 1.6) * 1.25)})`;
      ctx.fillRect(x, SPECTRO_BINS - 1 - b, 1, 1);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const canvas = this.target;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (this.count === 0) return;
    // Reading past `count` up to the minimum span hits only blank buffer, which
    // is what leaves the right-hand side empty while the take is young.
    const span = Math.max(this.count, MIN_SPAN_COLUMNS);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, 0, span, SPECTRO_BINS, 0, 0, width, height);
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.target = null;
  }
}
