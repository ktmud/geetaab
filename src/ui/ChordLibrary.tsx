import { useEffect, useMemo, useRef, useState } from 'react';
import { QUALITIES, SHARP_NAMES, chordName, type ChordQuality, type ChordSymbol } from '../core/chordTypes';
import { shapesFor, type ChordShape } from '../music/shapes';
import { patternsFor, type StrumPattern } from '../music/arrange';
import { renderShapePattern, renderShapeStrum } from '../audio/synth';
import { resumeAudio, sharedAudioContext } from '../audio/context';
import { shapeNoteText, useT } from '../i18n';
import { BackIcon, VolumeIcon } from './icons';
import { ChordDiagram } from './ChordDiagram';

export interface ChordLibraryProps {
  onBack: () => void;
}

// These are created inside the function using the i18n hook

type LevelFilter = 'all' | 'open' | 'barre';

interface Entry {
  chord: ChordSymbol;
  shape: ChordShape;
  alternates: number;
}

// Moved into the component so it can use i18n

export function ChordLibrary({ onBack }: ChordLibraryProps) {
  const t = useT();
  const [quality, setQuality] = useState<ChordQuality | 'all'>('all');
  const [root, setRoot] = useState<number | 'all'>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const bufferCache = useRef(new Map<string, AudioBuffer>());

  /**
   * The bench: a capo, a right-hand pattern and a tempo, and every chord box
   * on the page plays through them.
   *
   * A chord box on its own answers "where do the fingers go". These three
   * answer the question after it — what does it sound like in a song — and
   * they were only reachable by recording one and going to the practice
   * screen. Off by default, because someone here to look up a shape should get
   * the shape, and a single strum is the honest sound of a chord box.
   */
  const [benchOn, setBenchOn] = useState(false);
  const [capo, setCapo] = useState(0);
  const [bpm, setBpm] = useState(84);
  const patterns = useMemo(() => patternsFor(4), []);
  const [strumId, setStrumId] = useState(patterns[0]?.id ?? 'held');
  const strum: StrumPattern | undefined = patterns.find((p) => p.id === strumId) ?? patterns[0];
  // One sound at a time: tapping a second chord while the first is still
  // ringing should sound like changing chord, not like two guitars.
  const playing = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => () => playing.current?.stop(), []);

  const STARTERS: { chord: ChordSymbol; tip: string }[] = [
    { chord: { root: 4, quality: 'min' }, tip: t.starterTips[0] },
    { chord: { root: 9, quality: 'min' }, tip: t.starterTips[1] },
    { chord: { root: 2, quality: 'maj' }, tip: t.starterTips[2] },
    { chord: { root: 7, quality: 'maj' }, tip: t.starterTips[3] },
    { chord: { root: 0, quality: 'maj' }, tip: t.starterTips[4] },
    { chord: { root: 4, quality: 'maj' }, tip: t.starterTips[5] },
    { chord: { root: 9, quality: 'maj' }, tip: t.starterTips[6] },
    { chord: { root: 2, quality: 'min' }, tip: t.starterTips[7] },
  ];

  const QUALITY_LABELS: Record<ChordQuality, string> = {
    maj: t.majorQuality,
    min: t.minorQuality,
    dom7: t.dom7Quality,
    min7: t.min7Quality,
    maj7: t.maj7Quality,
    sus4: t.sus4Quality,
    sus2: t.sus2Quality,
  };

  const levelText = (shape: ChordShape): string =>
    t.levelText(shapeNoteText(shape.note, t), shape.difficulty);

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
    // Keyed on everything that changes the sound, so moving the capo does not
    // replay the cached open version.
    const key = benchOn
      ? `${shape.frets.join(',')}|${strum?.id}|${bpm}|${capo}`
      : shape.frets.join(',');
    let buffer = bufferCache.current.get(key);
    if (!buffer) {
      const samples =
        benchOn && strum
          ? renderShapePattern(shape.frets, strum, { sampleRate: ctx.sampleRate, bpm, capo, bars: 2 })
          : renderShapeStrum(shape.frets, { sampleRate: ctx.sampleRate });
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      bufferCache.current.set(key, buffer);
    }
    playing.current?.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    playing.current = source;
  };

  /** What a shape behind a capo actually sounds. */
  const soundingName = (chord: ChordSymbol): string =>
    chordName({ root: (chord.root + capo) % 12, quality: chord.quality });

  const legend = shapesFor({ root: 0, quality: 'maj' })[0];

  return (
    <div className="shell library">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> {t.back}
        </button>
      </div>

      <div className="eyebrow">{t.chordLibrary}</div>
      <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)' }}>{t.everyChordStart}</h1>
      <p className="lede" style={{ marginBottom: 20 }}>
        {t.tapChordHear}
      </p>

      <div className="card">
        <h2>{t.howToReadBox}</h2>
        <div className="legend-grid">
          <ChordDiagram shape={legend} width={130} title={t.cMajorExample} />
          <ul className="legend-list">
            {t.legendDescriptions.map((desc, i) => (
              <li key={i}>{desc}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Between the how-to-read box and the shapes, because it changes what
          every shape below it sounds like. */}
      <div className="card bench">
        <div className="bench-head">
          <div>
            <h2>{t.playItLikeASong}</h2>
            <p className="faint bench-blurb">{t.benchBlurb}</p>
          </div>
          <label className="bench-switch">
            <input
              type="checkbox"
              checked={benchOn}
              onChange={(event) => setBenchOn(event.target.checked)}
            />
            <span>{benchOn ? t.benchOn : t.benchOff}</span>
          </label>
        </div>

        {benchOn ? (
          <>
            <div className="controls-grid">
              <div className="field">
                <label htmlFor="bench-capo">{t.capo}</label>
                <select
                  id="bench-capo"
                  className="input"
                  value={capo}
                  onChange={(event) => setCapo(Number(event.target.value))}
                >
                  {Array.from({ length: 8 }, (_, fret) => (
                    <option key={fret} value={fret}>
                      {fret === 0 ? t.noCapoText : t.fretNth(fret)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="bench-strum">{t.strumming}</label>
                <select
                  id="bench-strum"
                  className="input"
                  value={strumId}
                  onChange={(event) => setStrumId(event.target.value)}
                >
                  {patterns.map((pattern) => (
                    <option key={pattern.id} value={pattern.id}>
                      {t.strumNames[pattern.id] ?? pattern.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="bench-bpm">{t.tempoLabel}</label>
                <div className="bench-tempo">
                  <input
                    id="bench-bpm"
                    type="range"
                    min={40}
                    max={160}
                    step={2}
                    value={bpm}
                    onChange={(event) => setBpm(Number(event.target.value))}
                    aria-valuetext={t.bpmValue(bpm)}
                  />
                  <span className="mono bench-bpm">{t.bpmValue(bpm)}</span>
                </div>
              </div>
            </div>
            <p className="faint settings-note">
              {t.strumDescriptions[strumId] ?? ''}{' '}
              {capo > 0 ? t.capoSoundsUp(capo, soundingName({ root: 0, quality: 'maj' })) : ''}
            </p>
          </>
        ) : null}
      </div>

      <div className="card">
        <h2>{t.startWithEight}</h2>
        <p style={{ fontSize: 13.5 }}>
          {t.learnThemOrder}
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
                aria-label={t.playChord(chordName(chord))}
              >
                <span className="tile-order">{index + 1}</span>
                <span className="tile-audio" aria-hidden="true">
                  <VolumeIcon size={13} />
                </span>
                <div className="diagram-name">{chordName(chord)}</div>
                <ChordDiagram shape={shape} width={92} title={t.chordDiagramTitle(chordName(chord))} />
                <div className="diagram-sub">
                  {benchOn && capo > 0 ? t.soundsAs(soundingName(chord)) : tip}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>{t.everyChordBook}</h2>

        <div className="filter-rows">
          <div className="filter-row" role="group" aria-label={t.allChordQualities}>
            <button className="filter-chip" aria-pressed={quality === 'all'} onClick={() => setQuality('all')}>
              {t.allChordQualities}
            </button>
            {QUALITIES.map((q) => (
              <button key={q} className="filter-chip" aria-pressed={quality === q} onClick={() => setQuality(q)}>
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label={t.anyRoot}>
            <button className="filter-chip" aria-pressed={root === 'all'} onClick={() => setRoot('all')}>
              {t.anyRoot}
            </button>
            {SHARP_NAMES.map((name, pc) => (
              <button key={name} className="filter-chip" aria-pressed={root === pc} onClick={() => setRoot(pc)}>
                {name}
              </button>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label={t.anyHands}>
            <button className="filter-chip" aria-pressed={level === 'all'} onClick={() => setLevel('all')}>
              {t.anyHands}
            </button>
            <button className="filter-chip" aria-pressed={level === 'open'} onClick={() => setLevel('open')}>
              {t.noBarre}
            </button>
            <button className="filter-chip" aria-pressed={level === 'barre'} onClick={() => setLevel('barre')}>
              {t.barreOnly}
            </button>
          </div>
        </div>

        <p className="faint filter-blurb">
          {quality !== 'all'
            ? t.qualityBlurbs[quality]
            : t.wholeVocabulary}{' '}
          <span className="mono">{t.shownCount(filtered.length)}</span>
        </p>

        <div className="library-grid">
          {filtered.map((entry) => (
            <button
              key={chordName(entry.chord)}
              className="diagram-card chord-tile"
              onClick={() => void play(entry.shape)}
              aria-label={t.playChord(chordName(entry.chord))}
            >
              <span className="tile-audio" aria-hidden="true">
                <VolumeIcon size={13} />
              </span>
              <div className="diagram-name">{chordName(entry.chord)}</div>
              <ChordDiagram
                shape={entry.shape}
                width={88}
                title={t.chordDiagramTitle(chordName(entry.chord))}
              />
              <div className="diagram-sub">
                {benchOn && capo > 0 ? t.soundsAs(soundingName(entry.chord)) : levelText(entry.shape)}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t.whenShapeFights}</h2>
        <ul className="tip-list">
          {t.shapeTips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
