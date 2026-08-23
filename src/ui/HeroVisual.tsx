import { useMemo } from 'react';
import { useT } from '../i18n';

const BAR_COUNT = 56;
const CHORDS = ['G', 'D', 'Am', 'C'];

/**
 * A waveform shaped like something actually strummed: a sharp attack on each
 * beat decaying into the next, under a slow swell across the phrase.
 */
function barHeights(count: number): number[] {
  const bars: number[] = [];
  const barsPerBeat = count / 16;
  for (let i = 0; i < count; i++) {
    const sinceBeat = (i % barsPerBeat) / barsPerBeat;
    const pluck = Math.exp(-sinceBeat * 3.1);
    const swell = 0.6 + 0.4 * Math.sin((i / count) * Math.PI * 2.2 + 0.7);
    const grain = 0.84 + 0.16 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    bars.push(Math.max(0.16, Math.min(1, pluck * swell * grain * 0.92 + 0.14)));
  }
  return bars;
}

function Layer({ heights, tone }: { heights: number[]; tone: 'dim' | 'lit' }) {
  const t = useT();
  return (
    <div className={`hv-body hv-${tone}`}>
      <div className="hv-row">
        <span className="hv-tag">{t.heroHears}</span>
        <div className="hv-wave">
          {heights.map((height, index) => (
            <i key={index} style={{ height: `${height * 100}%` }} />
          ))}
        </div>
      </div>
      <div className="hv-row">
        <span className="hv-tag">{t.heroWrites}</span>
        <div className="hv-chords">
          {CHORDS.map((chord) => (
            <div key={chord} className="hv-chord">
              {chord}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The pitch, as a picture: a playhead sweeps a waveform and leaves chords
 * behind it.
 *
 * Two identical layers sit on top of each other, and only the clip on the lit
 * one is animated. That keeps a hundred-odd elements to a single animated
 * property, and it guarantees the chords light up exactly as the sweep reaches
 * them rather than drifting out of step on their own timers.
 */
export function HeroVisual() {
  const heights = useMemo(() => barHeights(BAR_COUNT), []);
  return (
    <div className="hv" aria-hidden="true">
      <Layer heights={heights} tone="dim" />
      <Layer heights={heights} tone="lit" />
      <span className="hv-scan" />
    </div>
  );
}
