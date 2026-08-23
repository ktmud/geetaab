import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../core/analyze';
import { DEMO_PROGRESSION, renderProgression } from '../audio/synth';
import { buildTab } from './tab';
import { barTab, songTabText } from './tabText';

const audio = renderProgression([...DEMO_PROGRESSION, ...DEMO_PROGRESSION], {
  sampleRate: 44100,
  bpm: 96,
  seed: 20240,
});
const analysis = analyzeAudio(audio, 44100);

describe('buildTab', () => {
  it('reports the four-bar loop rather than the eight-bar repeat of it', () => {
    const tab = buildTab(analysis);
    expect(tab.loop).not.toBeNull();
    expect(tab.loop!.length).toBe(4);
    expect(tab.loop!.bars).toEqual(['G', 'D', 'Am', 'C']);
    expect(tab.loop!.coverage).toBeGreaterThan(0.9);
  });

  it('starts and ends on a chord instead of trailing silence', () => {
    const tab = buildTab(analysis);
    expect(tab.events[0].chord).not.toBeNull();
    expect(tab.events[tab.events.length - 1].chord).not.toBeNull();
    expect(tab.bars[tab.bars.length - 1].signature).not.toBe('N.C.');
  });

  it('lists each distinct shape once, in the order they first appear', () => {
    const tab = buildTab(analysis);
    expect(tab.palette.map((chord) => chord.shapeLabel)).toEqual(['G', 'D', 'Am', 'C']);
  });

  it('needs no capo for a song already built on open chords', () => {
    const tab = buildTab(analysis);
    expect(tab.capo).toBe(0);
    expect(tab.capoOpenRatio).toBe(1);
  });

  it('honours a capo override and renames the shapes for the key being read', () => {
    const tab = buildTab(analysis, { capo: 2 });
    expect(tab.capo).toBe(2);
    // Capo 2 in G means fingering in F, where the flat spelling is correct, and
    // where the F barre gets swapped for the four-string Fmaj7.
    expect(tab.palette.map((chord) => chord.shapeLabel)).toEqual(['Fmaj7', 'C', 'Gm', 'Bb']);
    // The chord in the song is still G however it gets fingered.
    expect(tab.events[0].chord!.label).toBe('G');
    expect(tab.events[0].chord!.substitutedFrom).toEqual({ root: 7, quality: 'maj' });
  });
});

describe('tablature text', () => {
  it('writes the strummed shape with high E on top', () => {
    const tab = buildTab(analysis);
    const rendered = barTab(tab.bars[0], tab.strum);
    expect(rendered.rows).toHaveLength(6);
    expect(rendered.rows[0].startsWith('e|')).toBe(true);
    expect(rendered.rows[5].startsWith('E|')).toBe(true);
    // G is 3-2-0-0-0-3, so the low E row carries a 3 and the D row an open 0.
    expect(rendered.rows[5]).toContain('3');
    expect(rendered.rows[2]).toContain('0');
    expect(rendered.directions).toContain('D');
    expect(rendered.names).toContain('G');
  });

  it('exports a text tab carrying the key, capo and chord shapes', () => {
    const text = songTabText(buildTab(analysis), 'Demo');
    expect(text).toContain('Key: G major');
    expect(text).toContain('Capo: none');
    expect(text).toContain('Chords you need');
    expect(text).toMatch(/G\s+3 2 0 0 0 3/);
    expect(text).toContain('The loop (4 bars');
  });
});
