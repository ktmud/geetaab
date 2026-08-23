import { useMemo, useRef, useState } from 'react';
import { QUALITIES, SHARP_NAMES, chordName, type ChordQuality, type ChordSymbol } from '../core/chordTypes';
import { shapesFor, type ChordShape } from '../music/shapes';
import { renderShapeStrum } from '../audio/synth';
import { resumeAudio, sharedAudioContext } from '../audio/context';
import { BackIcon, VolumeIcon } from './icons';
import { ChordDiagram } from './ChordDiagram';

export interface ChordLibraryProps {
  onBack: () => void;
}

/** The order teachers actually introduce chords, each with the reason it works. */
const STARTERS: { chord: ChordSymbol; tip: string }[] = [
  { chord: { root: 4, quality: 'min' }, tip: 'Two fingers, every string rings. The first chord.' },
  { chord: { root: 9, quality: 'min' }, tip: 'The Em fingers, moved over one string.' },
  { chord: { root: 2, quality: 'maj' }, tip: 'A little triangle. Strum the top four strings only.' },
  { chord: { root: 7, quality: 'maj' }, tip: 'A stretch at first — let the wrist come forward.' },
  { chord: { root: 0, quality: 'maj' }, tip: 'Skip the low E, and arch fingers so strings ring.' },
  { chord: { root: 4, quality: 'maj' }, tip: 'Em plus one finger. Bright and full.' },
  { chord: { root: 9, quality: 'maj' }, tip: 'Three fingers squeezed into one fret line.' },
  { chord: { root: 2, quality: 'min' }, tip: 'The moody one. Top four strings again.' },
];

const QUALITY_LABELS: Record<ChordQuality, string> = {
  maj: 'Major',
  min: 'Minor',
  dom7: '7',
  min7: 'm7',
  maj7: 'maj7',
  sus4: 'sus4',
  sus2: 'sus2',
};

const QUALITY_BLURBS: Record<ChordQuality, string> = {
  maj: 'Bright and settled — the home base most songs return to.',
  min: 'The third drops a fret and the mood drops with it.',
  dom7: 'A major chord plus a flat seventh: bluesy tension that wants to resolve home.',
  min7: 'A minor chord with the edges sanded off — softer than plain minor.',
  maj7: 'Dreamy and unhurried; the bossa nova and bedroom-pop chord.',
  sus4: 'The third is swapped for the note above it, and the ear waits for it to land.',
  sus2: 'Open and airy — neither major nor minor until you decide.',
};

type LevelFilter = 'all' | 'open' | 'barre';

interface Entry {
  chord: ChordSymbol;
  shape: ChordShape;
  alternates: number;
}

function levelText(shape: ChordShape): string {
  if (shape.note) return shape.note;
  if (shape.difficulty === 1) return 'open · first-week friendly';
  if (shape.difficulty === 2) return 'open · takes some practice';
  return 'full barre';
}

export function ChordLibrary({ onBack }: ChordLibraryProps) {
  const [quality, setQuality] = useState<ChordQuality | 'all'>('all');
  const [root, setRoot] = useState<number | 'all'>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const bufferCache = useRef(new Map<string, AudioBuffer>());

  const everyChord = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (let pc = 0; pc < 12; pc++) {
      for (const q of QUALITIES) {
        const shapes = shapesFor({ root: pc, quality: q });
        if (shapes.length) out.push({ chord: { root: pc, quality: q }, shape: shapes[0], alternates: shapes.length - 1 });
      }
    }
    return out;
  }, []);

  const filtered = everyChord.filter((entry) => {
    if (quality !== 'all' && entry.chord.quality !== quality) return false;
    if (root !== 'all' && entry.chord.root !== root) return false;
    if (level === 'open' && entry.shape.difficulty === 3) return false;
    if (level === 'barre' && entry.shape.difficulty !== 3) return false;
    return true;
  });

  const play = async (shape: ChordShape): Promise<void> => {
    await resumeAudio();
    const ctx = sharedAudioContext();
    const key = shape.frets.join(',');
    let buffer = bufferCache.current.get(key);
    if (!buffer) {
      const samples = renderShapeStrum(shape.frets, { sampleRate: ctx.sampleRate });
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      bufferCache.current.set(key, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  };

  const legend = shapesFor({ root: 0, quality: 'maj' })[0];

  return (
    <div className="shell library">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> Back
        </button>
      </div>

      <div className="eyebrow">Chord library</div>
      <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)' }}>Every chord, and where to start</h1>
      <p className="lede" style={{ marginBottom: 20 }}>
        Tap any chord to hear exactly the notes its diagram shows. Dots are fingers, numbers say
        which one.
      </p>

      <div className="card">
        <h2>How to read a chord box</h2>
        <div className="legend-grid">
          <ChordDiagram shape={legend} width={130} title="C major, as an example" />
          <ul className="legend-list">
            <li>Six vertical lines are the strings — low E on the left, like looking at your own guitar stood upright.</li>
            <li>Horizontal lines are frets; the thick top line is the nut. A number beside the box means the diagram starts at that fret.</li>
            <li>Dots are fingertips, numbered index 1 to pinky 4. A long bar is one finger laid flat across the strings — a barre.</li>
            <li>Above the box, ○ means let that string ring open, ✕ means don't play it.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Start with these eight</h2>
        <p style={{ fontSize: 13.5 }}>
          Learn them in this order, two at a time — and practise the <em>switch</em>, not the shape:
          four slow beats on one chord, four on the next, around and around. Every open-position
          song is some subset of these.
        </p>
        <div className="palette">
          {STARTERS.map(({ chord, tip }, index) => {
            const shape = shapesFor(chord)[0];
            if (!shape) return null;
            return (
              <button
                key={index}
                className="diagram-card chord-tile"
                onClick={() => void play(shape)}
                aria-label={`Play ${chordName(chord)}`}
              >
                <span className="tile-order">{index + 1}</span>
                <span className="tile-audio" aria-hidden="true">
                  <VolumeIcon size={13} />
                </span>
                <div className="diagram-name">{chordName(chord)}</div>
                <ChordDiagram shape={shape} width={92} title={`${chordName(chord)} chord diagram`} />
                <div className="diagram-sub">{tip}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Every chord in the book</h2>

        <div className="filter-rows">
          <div className="filter-row" role="group" aria-label="Chord quality">
            <button className="filter-chip" aria-pressed={quality === 'all'} onClick={() => setQuality('all')}>
              All
            </button>
            {QUALITIES.map((q) => (
              <button key={q} className="filter-chip" aria-pressed={quality === q} onClick={() => setQuality(q)}>
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label="Root note">
            <button className="filter-chip" aria-pressed={root === 'all'} onClick={() => setRoot('all')}>
              Any root
            </button>
            {SHARP_NAMES.map((name, pc) => (
              <button key={name} className="filter-chip" aria-pressed={root === pc} onClick={() => setRoot(pc)}>
                {name}
              </button>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label="Difficulty">
            <button className="filter-chip" aria-pressed={level === 'all'} onClick={() => setLevel('all')}>
              Any hands
            </button>
            <button className="filter-chip" aria-pressed={level === 'open'} onClick={() => setLevel('open')}>
              No barre
            </button>
            <button className="filter-chip" aria-pressed={level === 'barre'} onClick={() => setLevel('barre')}>
              Barre only
            </button>
          </div>
        </div>

        <p className="faint filter-blurb">
          {quality !== 'all'
            ? QUALITY_BLURBS[quality]
            : 'Seven qualities on twelve roots — the whole vocabulary the transcriber can hear.'}{' '}
          <span className="mono">{filtered.length} shown</span>
        </p>

        <div className="library-grid">
          {filtered.map((entry) => (
            <button
              key={chordName(entry.chord)}
              className="diagram-card chord-tile"
              onClick={() => void play(entry.shape)}
              aria-label={`Play ${chordName(entry.chord)}`}
            >
              <span className="tile-audio" aria-hidden="true">
                <VolumeIcon size={13} />
              </span>
              <div className="diagram-name">{chordName(entry.chord)}</div>
              <ChordDiagram
                shape={entry.shape}
                width={88}
                title={`${chordName(entry.chord)} chord diagram`}
              />
              <div className="diagram-sub">{levelText(entry.shape)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>When a shape still fights you</h2>
        <ul className="tip-list">
          <li>Press just behind the fret wire, not on top of it — half the pressure, twice the ring.</li>
          <li>Arch the fingers and land on the very tips, so they stop touching the strings below.</li>
          <li>A dead note is information: pluck the strings one at a time and fix the one that buzzes.</li>
          <li>Barres come months in, not days. Until then the capo and the easier stand-ins on the tab screen exist exactly for this.</li>
        </ul>
      </div>
    </div>
  );
}
