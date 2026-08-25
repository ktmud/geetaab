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
/** What App.tsx renders the demo with. */
const LEAD_IN = 0.2;

/** The demo as the app renders it, at a chosen lead-in. */
function render(leadIn: number): Float32Array {
  return renderDemoTrack([...DEMO_PROGRESSION], classic, {
    sampleRate: RATE,
    bpm: BPM,
    seed: 20240,
    leadIn,
  });
}

/** When each chord actually starts, in seconds. */
function playedStarts(leadIn: number): number[] {
  const starts: number[] = [];
  let t = leadIn;
  for (const chord of DEMO_PROGRESSION) {
    starts.push(t);
    t += chord.beats * beat;
  }
  return starts;
}

describe('renderDemoTrack', () => {
  it('transcribes back to the chords it played, in order', () => {
    const result = analyzeAudio(render(LEAD_IN), RATE);
    const heard = result.segments.filter((s) => !isNoChord(s.chord)).map((s) => chordName(s.chord));
    expect(heard).toEqual(['G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C']);
    expect(result.key.name).toBe('G major');
    expect(result.tempo).toBeGreaterThan(BPM - 4);
    expect(result.tempo).toBeLessThan(BPM + 4);
  });

  /** How far each chord landed from where it was played, in seconds. */
  function startErrors(leadIn: number): number[] {
    const result = analyzeAudio(render(leadIn), RATE);
    const heard = result.segments.filter((s) => !isNoChord(s.chord));
    return playedStarts(leadIn).map((played, i) => Math.abs(heard[i].start - played));
  }

  it('puts the chord changes where they were played', () => {
    for (const error of startErrors(LEAD_IN)) {
      // An eighth of a beat: tight enough that a half-beat phase slip, the
      // failure this guards, cannot pass.
      expect(error).toBeLessThan(beat / 8);
    }
  });

  it('needs the lead-in to hold that phase', () => {
    // Not decoration: the classic pattern skips beat three and leans on the
    // off-beat eighths, so with no percussion a beat tracker has no reason to
    // prefer the beat over the off-beat — and a file that opens mid-strum
    // hands it a first attack the analysis window has already cut in half.
    // If a better beat tracker ever makes this pass, the lead-in is free to
    // become a matter of taste again.
    expect(Math.max(...startErrors(0))).toBeGreaterThan(beat / 4);
  });
});
