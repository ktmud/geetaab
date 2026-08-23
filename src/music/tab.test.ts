import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../core/analyze';
import { DEMO_PROGRESSION, renderProgression } from '../audio/synth';
import { buildTab, findLoop } from './tab';
import { barTab, songTabText, tabSystems } from './tabText';

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

  it('joins bars side by side into aligned printable systems', () => {
    const tab = buildTab(analysis);
    const systems = tabSystems(tab.bars, tab.strum, 2);
    expect(systems).toHaveLength(Math.ceil(tab.bars.length / 2));
    expect(systems[0].label).toBe('Bars 1–2');
    const lines = systems[0].text.split('\n');
    expect(lines).toHaveLength(8);
    // Each string row carries two complete |-…-| boxes, one per bar.
    expect(lines[1].match(/\|/g)).toHaveLength(4);
    // The six string rows all line up, or the columns would zigzag on paper.
    expect(new Set(lines.slice(1, 7).map((line) => line.length)).size).toBe(1);
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

describe('findLoop', () => {
  const bars = (signatures: string[]) =>
    signatures.map((signature, index) => ({
      index,
      startBeat: index * 4,
      beats: 4,
      startTime: index * 2,
      endTime: (index + 1) * 2,
      slots: [],
      signature,
    }));

  it('confirms a four-bar loop from only two bars of repeat', () => {
    // What a short microphone capture leaves you with.
    const loop = findLoop(bars(['Eb', 'Bb', 'Cm', 'Ab', 'Eb', 'Bb']));
    expect(loop?.length).toBe(4);
    expect(loop?.bars).toEqual(['Eb', 'Bb', 'Cm', 'Ab']);
  });

  it('reports nothing when the song never repeats', () => {
    expect(findLoop(bars(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Am']))).toBeNull();
  });

  it('prefers the four-bar loop over the two-bar fragment inside it', () => {
    const loop = findLoop(bars(['G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C']));
    expect(loop?.length).toBe(4);
    expect(loop?.coverage).toBe(1);
  });

  it('ignores a lone repeated pair that is not the progression', () => {
    const loop = findLoop(bars(['C', 'C', 'F', 'G', 'Am', 'Em', 'F', 'G']));
    expect(loop).toBeNull();
  });
});
