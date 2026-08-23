import { useEffect, useRef } from 'react';

const STRING_COUNT = 18;
/** One repeat of six, running from the low E to the high E. */
const GAUGES = [1.75, 1.5, 1.25, 1.05, 0.85, 0.7];
const OPACITIES = [0.1, 0.088, 0.076, 0.07, 0.058, 0.046];
const SEGMENTS = 28;

interface Pluck {
  index: number;
  start: number;
  amplitude: number;
  /** Visible oscillation rate, far below a real string's pitch. */
  frequency: number;
  decay: number;
}

/**
 * Displaced shape of a string at one instant.
 *
 * The fundamental alone reads as a rope swinging; adding a little of the second
 * mode, running at twice the rate, gives the shimmer a plucked string actually
 * has. Both are drawn in the 0-100 space, so a wider viewport bows a wider
 * string, which is what a longer string would do.
 */
function stringPath(y: number, amplitude: number, phase: number): string {
  if (amplitude === 0) return `M0,${y}H100`;
  let d = '';
  for (let i = 0; i <= SEGMENTS; i++) {
    const x = (i / SEGMENTS) * 100;
    const u = x / 100;
    const dy =
      amplitude *
      (Math.sin(Math.PI * u) * Math.cos(phase) +
        0.22 * Math.sin(2 * Math.PI * u) * Math.cos(2 * phase + 0.7));
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${(y + dy).toFixed(3)}`;
  }
  return d;
}

/**
 * Ambient geometry behind the whole app: a field of strings that gets plucked.
 *
 * Nothing moves until a string is struck, and only the struck string is
 * touched, so an idle page does no per-frame work at all. Plucks are rare and
 * brief on purpose — motion that means something ("a string just rang") reads
 * as alive, where a permanent drift only reads as restless.
 */
export function Backdrop() {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const geometry = useRef(
    Array.from({ length: STRING_COUNT }, (_, i) => ({
      y: ((i + 0.5) / STRING_COUNT) * 100,
      gauge: GAUGES[i % GAUGES.length],
      opacity: OPACITIES[i % OPACITIES.length],
      cool: i % GAUGES.length >= 3,
    })),
  );

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const active: Pluck[] = [];
    let raf = 0;
    let timer = 0;

    const draw = (index: number, amplitude: number, phase: number, glow: number): void => {
      const path = paths.current[index];
      if (!path) return;
      const string = geometry.current[index];
      path.setAttribute('d', stringPath(string.y, amplitude, phase));
      path.style.opacity = String(string.opacity * (1 + glow * 5));
    };

    const frame = (now: number): void => {
      for (let i = active.length - 1; i >= 0; i--) {
        const pluck = active[i];
        const t = (now - pluck.start) / 1000;
        const envelope = Math.exp(-t / pluck.decay);
        if (envelope < 0.03) {
          draw(pluck.index, 0, 0, 0);
          active.splice(i, 1);
          continue;
        }
        draw(
          pluck.index,
          pluck.amplitude * envelope,
          2 * Math.PI * pluck.frequency * t,
          envelope,
        );
      }
      raf = active.length > 0 ? requestAnimationFrame(frame) : 0;
    };

    const pluck = (): void => {
      const index = Math.floor(Math.random() * STRING_COUNT);
      // Never restart a string that is still ringing; it looks like a glitch.
      if (!active.some((p) => p.index === index)) {
        active.push({
          index,
          start: performance.now(),
          amplitude: 0.75 + Math.random() * 0.7,
          frequency: 3.4 + Math.random() * 2.4,
          decay: 0.5 + Math.random() * 0.35,
        });
        if (raf === 0) raf = requestAnimationFrame(frame);
      }
      timer = window.setTimeout(pluck, 2400 + Math.random() * 4200);
    };

    timer = window.setTimeout(pluck, 1400);
    return () => {
      window.clearTimeout(timer);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-field">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {geometry.current.map((string, i) => (
            <path
              key={i}
              ref={(el) => {
                paths.current[i] = el;
              }}
              d={`M0,${string.y}H100`}
              stroke={string.cool ? 'rgb(var(--cool-rgb))' : 'rgb(var(--accent-rgb))'}
              strokeWidth={string.gauge}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ opacity: string.opacity }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
