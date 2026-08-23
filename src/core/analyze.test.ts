import { describe, expect, it } from 'vitest';
import { analyzeAudio, ANALYSIS_VERSION } from './analyze';
import { chordName, isNoChord } from './chordTypes';
import { DEMO_PROGRESSION, renderProgression, renderShapeStrum, type SynthChord } from '../audio/synth';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  it('writes N.C. for broadband noise instead of inventing chords', () => {
    const rand = mulberry32(77);
    const sampleRate = 44100;
    const noise = new Float32Array(10 * sampleRate);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.1 * (rand() * 2 - 1);
    const result = analyzeAudio(noise, sampleRate);
    const chordTime = result.segments
      .filter((s) => !isNoChord(s.chord))
      .reduce((sum, s) => sum + (s.end - s.start), 0);
    expect(chordTime).toBeLessThan(1);
  }, 60000);

  it('keeps a noisy lead-in out of the chords', () => {
    const rand = mulberry32(13);
    const sampleRate = 44100;
    const music = renderProgression(DEMO_PROGRESSION, { sampleRate, bpm: 96, seed: 7 });
    const audio = new Float32Array(5 * sampleRate + music.length);
    // Quiet room rumble, loud enough to clear the silence gate.
    for (let i = 0; i < 5 * sampleRate; i++) audio[i] = 0.03 * (rand() * 2 - 1);
    audio.set(music, 5 * sampleRate);
    const result = analyzeAudio(audio, sampleRate);
    for (const seg of result.segments) {
      if (seg.end <= 4.5) expect(isNoChord(seg.chord)).toBe(true);
    }
    const sequence = uniqueChordSequence(result.segments);
    expect(sequence.slice(0, 4)).toEqual(['G', 'D', 'Am', 'C']);
  }, 60000);

  it('reads free-time playing off the chroma instead of a bogus beat grid', () => {
    // Slow strums with no common pulse, the way an intro is actually noodled.
    const rand = mulberry32(11);
    const sampleRate = 44100;
    const shapes: Record<string, number[]> = {
      C: [-1, 3, 2, 0, 1, 0],
      G: [3, 2, 0, 0, 0, 3],
      Am: [-1, 0, 2, 2, 1, 0],
    };
    const audio = new Float32Array(26 * sampleRate);
    let t = 0.4;
    const played: string[] = [];
    for (let round = 0; round < 2; round++) {
      for (const name of Object.keys(shapes)) {
        played.push(name);
        for (let hit = 0; hit < 3; hit++) {
          const strum = renderShapeStrum(shapes[name], { sampleRate, seed: Math.floor(rand() * 1e6) });
          const at = Math.floor(t * sampleRate);
          for (let i = 0; i < strum.length && at + i < audio.length; i++) audio[at + i] += 0.8 * strum[i];
          t += 0.9 + rand() * 1.4;
        }
      }
    }
    const result = analyzeAudio(audio, sampleRate);
    expect(result.freeTime).toBe(true);
    expect(result.rhythmicity).toBeLessThan(0.08);
    const sequence = uniqueChordSequence(result.segments);
    expect(sequence).toEqual(['C', 'G', 'Am', 'C', 'G', 'Am']);
  }, 60000);

  it('keeps every change of a genuinely fast progression', () => {
    // Two chords a bar, the way 拥抱 or Heart of Gold actually move. The
    // adaptive change cost must leave this at the base cost — a stiffer
    // second pass would erase real changes the sheet prints.
    const cycle: SynthChord[] = [
      { root: 0, quality: 'maj', beats: 2 },
      { root: 5, quality: 'maj', beats: 2 },
      { root: 9, quality: 'min', beats: 2 },
      { root: 7, quality: 'maj', beats: 2 },
    ];
    const audio = renderProgression([...cycle, ...cycle, ...cycle, ...cycle], {
      sampleRate: 44100,
      bpm: 96,
      seed: 7,
    });
    const result = analyzeAudio(audio, 44100);
    const sequence = uniqueChordSequence(result.segments);
    // The opening cycles blur before the texture settles, but once it does,
    // every two-beat change must be present — none smoothed away.
    expect(sequence.length).toBeGreaterThanOrEqual(14);
    expect(sequence.slice(-8)).toEqual(['C', 'F', 'Am', 'G', 'C', 'F', 'Am', 'G']);
  }, 60000);

  it('keeps a chord that shares two notes with the chord beside it', () => {
    // Eb - Bb - Cm - Ab, a bar each. Ab is Ab-C-Eb: two of its three notes are
    // in Cm and two are in Eb, so it is held in place by a thin margin and is
    // the first thing a change cost erases. It is also the chord that decides
    // the key here — lose it and the reading slides from Eb major to C minor.
    const cycle: SynthChord[] = [
      { root: 3, quality: 'maj', beats: 4 },
      { root: 10, quality: 'maj', beats: 4 },
      { root: 0, quality: 'min', beats: 4 },
      { root: 8, quality: 'maj', beats: 4 },
    ];
    const audio = renderProgression([...cycle, ...cycle], { sampleRate: 44100, bpm: 108, seed: 99 });
    const result = analyzeAudio(audio, 44100);
    const sequence = result.segments.filter((s) => !isNoChord(s.chord)).map((s) => chordName(s.chord));
    expect(sequence).toEqual(['D#', 'A#', 'Cm', 'G#', 'D#', 'A#', 'Cm', 'G#']);
    expect(result.key.name).toBe('Eb major');
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

describe('ANALYSIS_VERSION', () => {
  it('is a positive integer, so a stored tab can be told stale from current', () => {
    expect(Number.isInteger(ANALYSIS_VERSION)).toBe(true);
    expect(ANALYSIS_VERSION).toBeGreaterThan(0);
  });
});

describe('telling music from not-music after the fact', () => {
  // The tab screen decides whether to say "no chords came through" from the
  // share of the track that came back N.C., not from confidence: a sustained
  // tone matches a chord template perfectly and scores higher confidence than
  // any real song. These two hold the ends of that gap apart.
  const ncShare = (result: ReturnType<typeof analyzeAudio>): number => {
    let played = 0;
    let quiet = 0;
    for (const seg of result.segments) {
      played += seg.end - seg.start;
      if (isNoChord(seg.chord)) quiet += seg.end - seg.start;
    }
    return played > 0 ? quiet / played : 1;
  };

  it('reads broadband noise as no harmony at all', () => {
    const sampleRate = 22050;
    const noise = new Float32Array(sampleRate * 12);
    let seed = 7;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = (seed / 4294967296 - 0.5) * 0.6;
    }
    expect(ncShare(analyzeAudio(noise, sampleRate))).toBeGreaterThan(0.9);
  });

  it('leaves a real progression well clear of that', () => {
    const sampleRate = 44100;
    const samples = renderProgression(
      [
        { root: 7, quality: 'maj', beats: 4 },
        { root: 2, quality: 'maj', beats: 4 },
        { root: 9, quality: 'min', beats: 4 },
        { root: 0, quality: 'maj', beats: 4 },
      ],
      { sampleRate, bpm: 96, seed: 5 },
    );
    expect(ncShare(analyzeAudio(samples, sampleRate))).toBeLessThan(0.25);
  });
});
