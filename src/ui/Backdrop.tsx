const SIDES = 12;

/** Vertices of a regular polygon on a 100×100 canvas. */
function polygonPoints(radius: number, rotateDegrees = 0): string {
  return Array.from({ length: SIDES }, (_, i) => {
    const angle = (i / SIDES) * Math.PI * 2 + (rotateDegrees * Math.PI) / 180 - Math.PI / 2;
    return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

function spokes(inner: number, outer: number, rotateDegrees = 0) {
  return Array.from({ length: SIDES }, (_, i) => {
    const angle = (i / SIDES) * Math.PI * 2 + (rotateDegrees * Math.PI) / 180 - Math.PI / 2;
    return (
      <line
        key={i}
        x1={(50 + inner * Math.cos(angle)).toFixed(2)}
        y1={(50 + inner * Math.sin(angle)).toFixed(2)}
        x2={(50 + outer * Math.cos(angle)).toFixed(2)}
        y2={(50 + outer * Math.sin(angle)).toFixed(2)}
      />
    );
  });
}

function Rosette() {
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor">
      {/* Arcs, not edges. These shapes sit mostly outside the viewport, and a
          cropped circle still reads as a circle while a cropped polygon reads
          as a few unrelated diagonals. */}
      <circle cx="50" cy="50" r="48" strokeWidth="0.22" />
      <circle cx="50" cy="50" r="36" strokeWidth="0.3" />
      <circle cx="50" cy="50" r="21" strokeWidth="0.18" />
      <polygon points={polygonPoints(36)} strokeWidth="0.16" />
      <g strokeWidth="0.26">{spokes(36, 48)}</g>
      <g strokeWidth="0.14">{spokes(21, 30, 15)}</g>
    </svg>
  );
}

/**
 * Ambient geometry behind the whole app.
 *
 * Twelve sides, because twelve is the number this app is built on — the pitch
 * classes, and the circle of fifths the chord decoder reasons over. The two
 * rosettes counter-rotate over several minutes, which is slow enough that
 * nothing moves while you are reading a chord chart, but keeps a very dark page
 * from reading as a flat void.
 */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="backdrop-shape backdrop-a">
        <Rosette />
      </span>
      <span className="backdrop-shape backdrop-b">
        <Rosette />
      </span>
    </div>
  );
}
