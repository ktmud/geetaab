import { describe, expect, it } from 'vitest';
import { DEMO_PROGRESSION, renderDemoTrack } from './synth';
import { STRUM_PATTERNS } from '../music/arrange';
import { analyzeAudio } from '../core/analyze';
import { chordName, isNoChord } from '../core/chordTypes';

/**
 * The demo track is the one render the analyzer has to get right: the app
 * transcribes the audio it just played, and a listener comparing the tab to
 * what they heard is comparing the pipeline to itself.
 */
const BPM = 96;
const RATE = 22050; // The rate the analysis works in; keeps the test quick.
const beat = 60 / BPM;
const classic = STRUM_PATTERNS.find((p) => p.id === 'classic')!;

function render(countInBars: number): Float32Array {
  return renderDemoTrack([...DEMO_PROGRESSION], classic, {
    sampleRate: RATE,
    bpm: BPM,
    seed: 20240,
    countInBars,
  });
}

/** When each chord actually starts, in seconds. */
function playedStarts(countInBars: number): number[] {
  const starts: number[] = [];
  let t = countInBars * classic.beatsPerBar * beat;
  for (const chord of DEMO_PROGRESSION) {
    starts.push(t);
    t += chord.beats * beat;
  }
  return starts;
}

describe('renderDemoTrack', () => {
  it('transcribes back to the chords it played, in order', () => {
    const result = analyzeAudio(render(1), RATE);
    const heard = result.segments.filter((s) => !isNoChord(s.chord)).map((s) => chordName(s.chord));
    expect(heard).toEqual(['G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C']);
    expect(result.key.name).toBe('G major');
    expect(result.tempo).toBeGreaterThan(BPM - 4);
    expect(result.tempo).toBeLessThan(BPM + 4);
  });

  /** How far each chord change landed from where it was played, in seconds.
      The first entry is skipped: the count-in is strummed on the first
      chord's own shape, so the opening G legitimately starts at 0. */
  function changeErrors(countInBars: number): number[] {
    const result = analyzeAudio(render(countInBars), RATE);
    const heard = result.segments.filter((s) => !isNoChord(s.chord));
    return playedStarts(countInBars)
      .slice(1)
      .map((played, i) => Math.abs(heard[i + 1].start - played));
  }

  it('puts the chord changes where they were played', () => {
    for (const error of changeErrors(1)) {
      // An eighth of a beat: tight enough that a half-beat phase slip, the
      // failure this guards, cannot pass.
      expect(error).toBeLessThan(beat / 8);
    }
  });

  it('needs the count-in to hold that phase', () => {
    // Not a preference: the classic pattern skips beat three and leans on the
    // off-beat eighths, so with no percussion and no count-in a beat tracker
    // has no reason to prefer the beat over the off-beat, and picks wrong.
    expect(Math.max(...changeErrors(0))).toBeGreaterThan(beat / 4);
  });
});
