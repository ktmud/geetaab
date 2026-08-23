import { useMemo, useState } from 'react';
import type { AnalysisResult } from '../core/analyze';
import { chooseCapo, patternsFor } from '../music/arrange';
import { buildTab, type SongTab } from '../music/tab';
import { barTab, songTabText } from '../music/tabText';
import { ChordCard } from './ChordDiagram';
import { BackIcon, PlayIcon } from './icons';

export interface TabOptions {
  capo?: number;
  simplify: boolean;
  strumId?: string;
}

export interface TabViewProps {
  analysis: AnalysisResult;
  title: string;
  options: TabOptions;
  onTitleChange: (title: string) => void;
  onOptionsChange: (options: TabOptions) => void;
  onPractice: (tab: SongTab) => void;
  onBack: () => void;
  /** Re-run the analysis with a forced tempo; absent when the audio is gone. */
  onRetempo?: (bpm: number) => void;
  busy?: boolean;
}

export function TabView({
  analysis,
  title,
  options,
  onTitleChange,
  onOptionsChange,
  onPractice,
  onBack,
  onRetempo,
  busy,
}: TabViewProps) {
  const [copied, setCopied] = useState(false);

  const tab = useMemo(() => {
    const patterns = patternsFor(analysis.beatsPerBar);
    const strum = options.strumId ? patterns.find((p) => p.id === options.strumId) : undefined;
    return buildTab(analysis, { capo: options.capo, simplify: options.simplify, strum });
  }, [analysis, options]);

  const autoCapo = useMemo(
    () => chooseCapo(analysis.segments, analysis.key, { simplify: options.simplify }).fret,
    [analysis, options.simplify],
  );
  const patterns = patternsFor(tab.beatsPerBar);
  const loopBars = tab.bars.slice(0, Math.min(tab.bars.length, tab.loop?.length ?? 4));
  const hardChords = tab.palette.filter((chord) => chord.shape.difficulty === 3);
  const lowConfidence = tab.confidence < 0.24;

  const copyText = async (): Promise<void> => {
    const text = songTabText(tab, title);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the textarea below is the fallback.
      window.prompt('Copy the tab:', text);
    }
  };

  return (
    <div className="shell">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> Back
        </button>
      </div>

      <div className="tab-header">
        <div style={{ flex: 1, minWidth: 240 }}>
          <input
            className="tab-title-input"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            aria-label="Song title"
            placeholder="Name this song"
          />
          <div className="stat-row" style={{ marginTop: 12 }}>
            <span className="chip chip-accent">{tab.key.name}</span>
            <span className="chip">{Math.round(tab.tempo)} BPM</span>
            <span className="chip">{tab.beatsPerBar}/4</span>
            <span className="chip">
              {tab.capo > 0 ? `Capo ${tab.capo} · play in ${tab.shapeKeyName}` : 'No capo'}
            </span>
            {Math.abs(analysis.tuning) > 0.12 ? (
              <span className="chip" title="Measured tuning of the recording">
                {analysis.tuning > 0 ? '+' : ''}
                {Math.round(analysis.tuning * 100)}¢ off A440
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {lowConfidence ? (
        <div className="notice notice-warn" style={{ marginTop: 16 }}>
          The harmony came through faintly, so these chords are a rough guess. A cleaner recording —
          or an audio file instead of a room recording — will do much better.
        </div>
      ) : null}

      {tab.loop ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="eyebrow">The whole song, mostly</div>
          <div className="loop-summary">
            {tab.loop.bars.map((bar, index) => (
              <span key={index} style={{ display: 'contents' }}>
                {index > 0 ? <span className="loop-arrow">→</span> : null}
                <span className="loop-chord">{bar || 'N.C.'}</span>
              </span>
            ))}
          </div>
          <p className="faint" style={{ marginTop: 10, marginBottom: 0, fontSize: 13 }}>
            This {tab.loop.length}-bar loop covers {Math.round(tab.loop.coverage * 100)}% of what you
            recorded. Learn it once and you have most of the song.
          </p>
        </div>
      ) : null}

      <div className="card">
        <h2>Chords you need</h2>
        <div className="palette">
          {tab.palette.map((chord, index) => (
            <ChordCard
              key={`${chord.shapeChord.root}-${chord.shapeChord.quality}-${index}`}
              shape={chord.shape}
              name={chord.shapeLabel}
              sub={
                chord.substitutedFrom
                  ? `easier stand-in for ${chord.label}`
                  : tab.capo > 0
                    ? `sounds as ${chord.label}`
                    : chord.shape.note
              }
            />
          ))}
        </div>
        {hardChords.length > 0 ? (
          <div className="notice notice-info" style={{ marginTop: 14 }}>
            {hardChords.map((c) => c.shapeLabel).join(', ')}{' '}
            {hardChords.length === 1 ? 'still needs' : 'still need'} a barre. Try another capo
            position below, or play just the top four strings until the shape settles.
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Make it fit your hands</h2>
        <div className="controls-grid">
          <div className="field">
            <label htmlFor="capo">Capo</label>
            <select
              id="capo"
              className="input"
              value={options.capo ?? autoCapo}
              onChange={(event) => onOptionsChange({ ...options, capo: Number(event.target.value) })}
            >
              {Array.from({ length: 8 }, (_, fret) => (
                <option key={fret} value={fret}>
                  {fret === 0 ? 'No capo' : `Fret ${fret}`}
                  {fret === autoCapo ? ' — suggested' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="strum">Strumming</label>
            <select
              id="strum"
              className="input"
              value={tab.strum.id}
              onChange={(event) => onOptionsChange({ ...options, strumId: event.target.value })}
            >
              {patterns.map((pattern) => (
                <option key={pattern.id} value={pattern.id}>
                  {pattern.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="simplify">Chord shapes</label>
            <div className="segmented" id="simplify">
              <button
                aria-pressed={options.simplify}
                onClick={() => onOptionsChange({ ...options, simplify: true })}
              >
                Beginner
              </button>
              <button
                aria-pressed={!options.simplify}
                onClick={() => onOptionsChange({ ...options, simplify: false })}
              >
                Exact
              </button>
            </div>
          </div>

          {onRetempo ? (
            <div className="field">
              <label>Tempo reading</label>
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={busy || analysis.tempo / 2 < 40}
                  onClick={() => onRetempo(analysis.tempo / 2)}
                >
                  Half time
                </button>
                <button
                  className="btn"
                  disabled={busy || analysis.tempo * 2 > 260}
                  onClick={() => onRetempo(analysis.tempo * 2)}
                >
                  Double time
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <p className="faint" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
          {tab.capo > 0
            ? `With the capo on fret ${tab.capo} you finger the shapes of ${tab.shapeKeyName}, and the room hears ${tab.key.name}. ${Math.round(tab.capoOpenRatio * 100)}% of the song lands on open chords.`
            : `Open shapes already cover ${Math.round(tab.capoOpenRatio * 100)}% of this song, so a capo would not buy you much.`}
        </p>
      </div>

      <div className="card">
        <h2>{tab.strum.name}</h2>
        <p style={{ fontSize: 14 }}>{tab.strum.description}</p>
        <StrumRow tab={tab} />
      </div>

      <div className="card">
        <h2>Chord chart</h2>
        <div className="bars">
          {tab.bars.map((bar) => (
            <div
              key={bar.index}
              className={`bar${tab.loop && bar.index % tab.loop.length === 0 ? ' section-start' : ''}`}
            >
              <div className="bar-head">
                <span>{bar.index + 1}</span>
                {bar.beats !== tab.beatsPerBar ? <span>{bar.beats} beats</span> : null}
              </div>
              <div className="bar-slots">
                {bar.slots.map((slot, index) => (
                  <div
                    key={index}
                    className={`bar-slot${slot.event.chord ? '' : ' nc'}`}
                    style={{ flexGrow: Math.max(1, slot.beats) }}
                  >
                    <span className="bar-slot-name">{slot.event.chord?.label ?? 'N.C.'}</span>
                    {slot.event.numeral ? (
                      <span className="bar-slot-numeral">{slot.event.numeral}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {loopBars.length > 0 ? (
        <div className="card">
          <h2>Tablature</h2>
          <div className="tablature">
            <pre className="tab-grid">
              {loopBars
                .map((bar) => {
                  const rendered = barTab(bar, tab.strum);
                  return [rendered.names, ...rendered.rows, rendered.directions].join('\n');
                })
                .join('\n\n')}
            </pre>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={copyText}>
              {copied ? 'Copied' : 'Copy the whole tab as text'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="sticky-cta">
        <button className="btn btn-primary btn-lg" onClick={() => onPractice(tab)}>
          <PlayIcon size={18} /> Practise this
        </button>
      </div>
    </div>
  );
}

function StrumRow({ tab }: { tab: SongTab }) {
  const slots: { label: string; step?: (typeof tab.strum.steps)[number] }[] = [];
  for (let beat = 0; beat < tab.beatsPerBar; beat += 0.5) {
    const step = tab.strum.steps.find((s) => Math.abs(s.beat - beat) < 1e-6);
    slots.push({ label: beat % 1 === 0 ? String(beat + 1) : '&', step });
  }
  return (
    <div className="strum-row">
      {slots.map((slot, index) => (
        <div
          key={index}
          className={`strum-step${slot.step ? (slot.step.accent ? ' accent' : '') : ' gap'}`}
        >
          <span>{slot.step ? (slot.step.direction === 'D' ? '↓' : '↑') : '·'}</span>
          <small>{slot.label}</small>
        </div>
      ))}
    </div>
  );
}
