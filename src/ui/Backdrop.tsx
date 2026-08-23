/**
 * Ambient geometry behind the whole app.
 *
 * A field of strings: six lines per repeat, tapering in weight and brightness
 * the way real gauges run from the low E to the high E, drifting sideways over
 * four minutes.
 *
 * The version this replaced stacked concentric rings under radial spokes, which
 * is the literal construction of a spider web. Parallel lines cannot fall into
 * that shape, and they are the most on-brand geometry this app could use.
 */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="backdrop-strings">
        <i />
      </span>
    </div>
  );
}
