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
/** What App.tsx renders the demo with, in beats. */
const LEAD_IN = 1.2;

/** The demo as the app renders it, at a chosen lead-in (in beats). */
function render(leadInBeats: number): Float32Array {
  return renderDemoTrack([...DEMO_PROGRESSION], classic, {
    sampleRate: RATE,
    bpm: BPM,
    seed: 20240,
    leadInBeats,
  });
}

/** When each chord actually starts, in seconds. */
function playedStarts(leadInBeats: number): number[] {
  const starts: number[] = [];
  let t = leadInBeats * beat;
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
  function startErrors(leadInBeats: number): number[] {
    const result = analyzeAudio(render(leadInBeats), RATE);
    const heard = result.segments.filter((s) => !isNoChord(s.chord));
    return playedStarts(leadInBeats).map((played, i) => Math.abs(heard[i].start - played));
  }

  it('puts the chord changes where they were played', () => {
    for (const error of startErrors(LEAD_IN)) {
      // An eighth of a beat: tight enough that a half-beat phase slip, the
      // failure this guards, cannot pass.
      expect(error).toBeLessThan(beat / 8);
    }
  });

  it('holds that phase at every rate a browser might render it at', () => {
    // An AudioContext runs at 44.1 or 48 kHz depending on the device, so the
    // demo is rendered at whichever the browser hands it — and a phase that
    // only survives one of them is not a phase that survives.
    for (const rate of [44100, 48000]) {
      const samples = renderDemoTrack([...DEMO_PROGRESSION], classic, {
        sampleRate: rate,
        bpm: BPM,
        seed: 20240,
        leadInBeats: LEAD_IN,
      });
      const heard = analyzeAudio(samples, rate).segments.filter((s) => !isNoChord(s.chord));
      playedStarts(LEAD_IN).forEach((played, i) => {
        expect(Math.abs(heard[i].start - played)).toBeLessThan(beat / 4);
      });
    }
    // Two full-rate renders and analyses; the default timeout is optimistic.
  }, 30000);
});
