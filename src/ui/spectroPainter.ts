import { SPECTRO_BINS, SPECTRO_MIN_MIDI } from '../audio/spectrogram';
import { pitchClassHue } from '../music/pitchColor';

/** About thirty seconds of columns at the capture rate. */
const MIN_SPAN_COLUMNS = 350;

/** How the current theme wants a column drawn. */
interface Ink {
  saturation: string;
  lightness: string;
  gain: number;
  gamma: number;
  floor: number;
}

const FALLBACK: Ink = { saturation: '72%', lightness: '58%', gain: 1.25, gamma: 1.6, floor: 0.04 };

function readNumber(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Paints the take's spectrogram behind the recording screen.
 *
 * Columns land once in an offscreen buffer at one pixel per chunk, and every
 * repaint stretches the buffer across the viewport — so the backdrop always
 * shows the whole take, growing rightward for the first half minute and then
 * compressing as the song gets longer. Each semitone row takes the same
 * circle-of-fifths hue as the chroma meter above it, which keeps the backdrop
 * and the meter reading as one instrument.
 *
 * How loud a bin has to be before it makes a mark, and how dark that mark is,
 * are read from the stylesheet rather than fixed here: light ink on paper is a
 * far stronger mark than light on black at the same alpha, so the two themes
 * need different curves to say the same thing. The raw magnitudes are kept
 * alongside the buffer so a theme change can repaint the whole take from
 * scratch — a canvas painted under the old palette must not linger.
 */
export class SpectroPainter {
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D | null;
  private readonly hues: number[];
  /** Every column's magnitudes, quantised to a byte, kept for repainting. */
  private readonly magnitudes: Uint8Array;
  private ink: Ink = FALLBACK;
  private count = 0;
  private target: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private themeWatcher: MutationObserver | null = null;
  private raf = 0;

  constructor(capacity = 2400) {
    this.off = document.createElement('canvas');
    this.off.width = capacity;
    this.off.height = SPECTRO_BINS;
    this.octx = this.off.getContext('2d');
    this.hues = Array.from({ length: SPECTRO_BINS }, (_, b) => pitchClassHue(SPECTRO_MIN_MIDI + b));
    this.magnitudes = new Uint8Array(capacity * SPECTRO_BINS);
    this.ink = this.readInk();
  }

  attach(canvas: HTMLCanvasElement): void {
    this.target = canvas;
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(canvas);
    this.watchTheme();
    this.schedule();
  }

  push(column: Float32Array): void {
    const ctx = this.octx;
    if (!ctx || this.count >= this.off.width) return;
    const x = this.count++;
    const base = x * SPECTRO_BINS;
    for (let b = 0; b < SPECTRO_BINS; b++) {
      this.magnitudes[base + b] = Math.round(Math.min(1, Math.max(0, column[b])) * 255);
    }
    this.paintColumn(ctx, x);
    this.schedule();
  }

  private readInk(): Ink {
    if (typeof getComputedStyle !== 'function') return FALLBACK;
    const style = getComputedStyle(document.documentElement);
    return {
      saturation: style.getPropertyValue('--spectro-s').trim() || FALLBACK.saturation,
      lightness: style.getPropertyValue('--spectro-l').trim() || FALLBACK.lightness,
      gain: readNumber(style, '--spectro-gain', FALLBACK.gain),
      gamma: readNumber(style, '--spectro-gamma', FALLBACK.gamma),
      floor: readNumber(style, '--spectro-floor', FALLBACK.floor),
    };
  }

  /** Repaints every column already captured, in the theme now in force. */
  private watchTheme(): void {
    if (this.themeWatcher || typeof MutationObserver !== 'function') return;
    this.themeWatcher = new MutationObserver(() => {
      const next = this.readInk();
      const same =
        next.saturation === this.ink.saturation &&
        next.lightness === this.ink.lightness &&
        next.gain === this.ink.gain &&
        next.gamma === this.ink.gamma &&
        next.floor === this.ink.floor;
      if (same) return;
      this.ink = next;
      this.repaintBuffer();
      this.schedule();
    });
    this.themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  private paintColumn(ctx: CanvasRenderingContext2D, x: number): void {
    const { saturation, lightness, gain, gamma, floor } = this.ink;
    const base = x * SPECTRO_BINS;
    for (let b = 0; b < SPECTRO_BINS; b++) {
      const value = this.magnitudes[base + b] / 255;
      if (value < floor) continue;
      const alpha = Math.min(1, Math.pow(value, gamma) * gain);
      ctx.fillStyle = `hsl(${this.hues[b]} ${saturation} ${lightness} / ${alpha})`;
      ctx.fillRect(x, SPECTRO_BINS - 1 - b, 1, 1);
    }
  }

  private repaintBuffer(): void {
    const ctx = this.octx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.off.width, this.off.height);
    for (let x = 0; x < this.count; x++) this.paintColumn(ctx, x);
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
    this.themeWatcher?.disconnect();
    this.themeWatcher = null;
    this.target = null;
  }
}
