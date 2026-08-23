import { describe, expect, it } from 'vitest';
import { analyzeAudio } from './analyze';
import { chordName, isNoChord } from './chordTypes';
import { DEMO_PROGRESSION, renderProgression, type SynthChord } from '../audio/synth';

function uniqueChordSequence(segments: { chord: { root: number; quality: string } }[]): string[] {
  const out: string[] = [];
  for (const s of segments) {
    if (isNoChord(s.chord as never)) continue;
    const name = chordName(s.chord as never);
    if (out[out.length - 1] !== name) out.push(name);
  }
  return out;
}

describe('analyzeAudio', () => {
  it('recovers a I-V-vi-IV progression in G', () => {
    const bpm = 96;
    const audio = renderProgression(DEMO_PROGRESSION, { sampleRate: 44100, bpm, seed: 7 });
    const result = analyzeAudio(audio, 44100);

    expect(result.tempo).toBeGreaterThan(bpm * 0.94);
    expect(result.tempo).toBeLessThan(bpm * 1.06);

    const sequence = uniqueChordSequence(result.segments);
    expect(sequence.slice(0, 8)).toEqual(['G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C']);

    expect(result.key.tonic).toBe(7);
    expect(result.key.mode).toBe('major');
    expect(result.beatsPerBar).toBe(4);
  }, 60000);

  it('recovers a minor progression and names the key', () => {
    const progression: SynthChord[] = [
      { root: 9, quality: 'min', beats: 4 },
      { root: 5, quality: 'maj', beats: 4 },
      { root: 0, quality: 'maj', beats: 4 },
      { root: 7, quality: 'maj', beats: 4 },
      { root: 9, quality: 'min', beats: 4 },
      { root: 5, quality: 'maj', beats: 4 },
      { root: 0, quality: 'maj', beats: 4 },
      { root: 7, quality: 'maj', beats: 4 },
    ];
    const audio = renderProgression(progression, { sampleRate: 44100, bpm: 120, seed: 11 });
    const result = analyzeAudio(audio, 44100);
    const sequence = uniqueChordSequence(result.segments);
    expect(sequence.slice(0, 4)).toEqual(['Am', 'F', 'C', 'G']);
    expect([9, 0]).toContain(result.key.tonic);
  }, 60000);

  it('tolerates a detuned, noisy recording', () => {
    const audio = renderProgression(DEMO_PROGRESSION.slice(0, 4), {
      sampleRate: 44100,
      bpm: 88,
      noise: 0.03,
      seed: 21,
    });
    // Simulate a source mastered ~35 cents sharp by reading the buffer faster.
    const rate = Math.pow(2, 0.35 / 12);
    const shifted = new Float32Array(Math.floor(audio.length / rate));
    for (let i = 0; i < shifted.length; i++) {
      const src = i * rate;
      const i0 = Math.floor(src);
      const frac = src - i0;
      shifted[i] = (audio[i0] ?? 0) * (1 - frac) + (audio[i0 + 1] ?? 0) * frac;
    }
    const result = analyzeAudio(shifted, 44100);
    expect(result.tuning).toBeGreaterThan(0.15);
    const sequence = uniqueChordSequence(result.segments);
    expect(sequence.slice(0, 4)).toEqual(['G', 'D', 'Am', 'C']);
  }, 60000);

  it('still hears a genuine dominant seventh', () => {
    const progression: SynthChord[] = [
      { root: 0, quality: 'maj', beats: 4 },
      { root: 5, quality: 'maj', beats: 4 },
      { root: 7, quality: 'dom7', beats: 8 },
      { root: 0, quality: 'maj', beats: 4 },
      { root: 5, quality: 'maj', beats: 4 },
      { root: 7, quality: 'dom7', beats: 8 },
    ];
    const audio = renderProgression(progression, { sampleRate: 44100, bpm: 104, seed: 5 });
    const sequence = uniqueChordSequence(analyzeAudio(audio, 44100).segments);
    expect(sequence.slice(0, 3)).toEqual(['C', 'F', 'G7']);
  }, 60000);

  it('tracks tempo across the range a beginner plays in', () => {
    for (const bpm of [72, 96, 132]) {
      const audio = renderProgression(DEMO_PROGRESSION.slice(0, 4), { sampleRate: 44100, bpm, seed: 3 });
      const result = analyzeAudio(audio, 44100);
      expect(Math.abs(result.tempo - bpm) / bpm).toBeLessThan(0.06);
      // The grid must be even, or the karaoke lane would drift out of sync.
      const period = 60 / result.tempo;
      for (let i = 1; i < result.beats.length; i++) {
        expect(result.beats[i] - result.beats[i - 1]).toBeCloseTo(period, 1);
      }
    }
  }, 60000);
});
