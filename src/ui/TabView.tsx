import { useMemo, useState } from 'react';
import type { AnalysisResult } from '../core/analyze';
import { chooseCapo, patternsFor } from '../music/arrange';
import { levelsWorthOffering, reduceSegments, type TabLevel } from '../music/levels';
import { buildTab, type SongTab } from '../music/tab';
import { songTabText, tabSystems } from '../music/tabText';
import { shapeNoteText, useT, useLanguage, translateKeyName } from '../i18n';
import { ChordCard } from './ChordDiagram';
import { PrintSheet } from './PrintSheet';
import { BackIcon, CheckIcon, PlayIcon, PrintIcon } from './icons';

export interface TabOptions {
  capo?: number;
  simplify: boolean;
  strumId?: string;
  level?: TabLevel;
}

// Will be created inside the component using the hook

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
  const t = useT();
  const [lang] = useLanguage();
  const [copied, setCopied] = useState(false);
  const [tabScope, setTabScope] = useState<'song' | 'loop'>('song');
  const [editingTitle, setEditingTitle] = useState(false);

  const LEVEL_LABELS: Record<TabLevel, string> = {
    easy: t.easy,
    standard: t.standard,
    faithful: t.faithful,
  };

  const LEVEL_HINTS: Record<TabLevel, string> = {
    easy: t.easyHint,
    standard: t.standardHint,
    faithful: t.faithfulHint,
  };

  const strumName = (id: string): string => t.strumNames[id] ?? id;

  const tabs = useMemo(() => {
    const patterns = patternsFor(analysis.beatsPerBar);
    const strum = options.strumId ? patterns.find((p) => p.id === options.strumId) : undefined;
    const base = { capo: options.capo, strum };
    const standard = buildTab(analysis, { ...base, simplify: true });
    const faithful = buildTab(analysis, { ...base, simplify: false });
    const easy = buildTab(
      { ...analysis, segments: reduceSegments(analysis.segments, analysis.beatsPerBar) },
      { ...base, simplify: true },
    );
    return { easy, standard, faithful } as Record<TabLevel, SongTab>;
  }, [analysis, options.capo, options.strumId]);

  const offeredLevels = useMemo(() => levelsWorthOffering(tabs), [tabs]);
  const wantedLevel: TabLevel = options.level ?? (options.simplify === false ? 'faithful' : 'standard');
  const level: TabLevel = offeredLevels.includes(wantedLevel) ? wantedLevel : 'standard';
  const tab = tabs[level];

  const autoCapo = useMemo(
    () => chooseCapo(analysis.segments, analysis.key, { simplify: level !== 'faithful' }).fret,
    [analysis, level],
  );
  const patterns = patternsFor(tab.beatsPerBar);
  const hardChords = tab.palette.filter((chord) => chord.shape.difficulty === 3);
  const lowConfidence = tab.confidence < 0.24;

  const systems = useMemo(() => {
    const bars =
      tabScope === 'loop' && tab.loop
        ? tab.bars.slice(0, Math.min(tab.bars.length, tab.loop.length))
        : tab.bars;
    return tabSystems(bars, tab.strum, 2);
  }, [tab, tabScope]);

  const copyText = async (): Promise<void> => {
    const text = songTabText(tab, title, { ...t.tabText, strumName: strumName(tab.strum.id) });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the textarea below is the fallback.
      window.prompt(t.copyTabPrompt, text);
    }
  };

  return (
    <div className="shell">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> {t.back}
        </button>
      </div>

      <div className="tab-header">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="title-edit">
            <input
              className="tab-title-input"
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              onFocus={() => setEditingTitle(true)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              aria-label={t.songTitle}
              placeholder={t.nameThisSong}
            />
            {editingTitle ? (
              <button
                className="title-confirm"
                aria-label={t.confirmTitle}
                // Mouse-down, not click: the input's blur would unmount this
                // button before a click could ever land on it.
                onMouseDown={(event) => {
                  event.preventDefault();
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
              >
                <CheckIcon size={17} />
              </button>
            ) : null}
          </div>
          <div className="stat-row" style={{ marginTop: 12 }}>
            <span className="chip chip-accent">{translateKeyName(tab.key.name, lang)}</span>
            <span className="chip">{Math.round(tab.tempo)} BPM</span>
            <span className="chip">{tab.beatsPerBar}/4</span>
            <span className="chip">
              {tab.capo > 0
                ? t.capoPlayIn(tab.capo, translateKeyName(tab.shapeKeyName, lang))
                : t.noCapoText}
            </span>
            {Math.abs(analysis.tuning) > 0.12 ? (
              <span className="chip" title={t.tuningTitle}>
                {t.tuningChip(Math.round(analysis.tuning * 100))}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {lowConfidence ? (
        <div className="notice notice-warn">
          {t.lowConfidence}
        </div>
      ) : null}

      {analysis.freeTime ? (
        <div className="notice notice-info">
          {t.freeTime}
        </div>
      ) : null}

      {tab.loop ? (
        <div className="card">
          <div className="eyebrow">{t.theWholeSong}</div>
          <div className="loop-summary">
            {tab.loop.bars.map((bar, index) => (
              <span key={index} style={{ display: 'contents' }}>
                {index > 0 ? <span className="loop-arrow">→</span> : null}
                <span className="loop-chord">{bar || 'N.C.'}</span>
              </span>
            ))}
          </div>
          <p className="faint" style={{ marginTop: 10, marginBottom: 0, fontSize: 13 }}>
            {t.wholeLoop(tab.loop.length, tab.loop.coverage)}
          </p>
        </div>
      ) : null}

      <div className="card">
        <h2>{t.chordsYouNeed}</h2>
        <div className="palette">
          {tab.palette.map((chord, index) => (
            <ChordCard
              key={`${chord.shapeChord.root}-${chord.shapeChord.quality}-${index}`}
              shape={chord.shape}
              name={chord.shapeLabel}
              sub={
                chord.substitutedFrom
                  ? t.subbedFor(chord.label)
                  : tab.capo > 0
                    ? t.soundsAs(chord.label)
                    : (shapeNoteText(chord.shape.note, t) ?? undefined)
              }
            />
          ))}
        </div>
        {hardChords.length > 0 ? (
          <div className="notice notice-info" style={{ marginTop: 14 }}>
            {t.stillNeeds(hardChords.map((c) => c.shapeLabel).join(', '), hardChords.length)}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>{t.makeItFitHands}</h2>
        <div className="controls-grid">
          <div className="field">
            <label htmlFor="capo">{t.capo}</label>
            <select
              id="capo"
              className="input"
              value={options.capo ?? autoCapo}
              onChange={(event) => onOptionsChange({ ...options, capo: Number(event.target.value) })}
            >
              {Array.from({ length: 8 }, (_, fret) => (
                <option key={fret} value={fret}>
                  {fret === 0 ? t.noCapoText : t.fretNth(fret)}
                  {fret === autoCapo ? t.suggested : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="strum">{t.strumming}</label>
            <select
              id="strum"
              className="input"
              value={tab.strum.id}
              onChange={(event) => onOptionsChange({ ...options, strumId: event.target.value })}
            >
              {patterns.map((pattern) => (
                <option key={pattern.id} value={pattern.id}>
                  {strumName(pattern.id)}
                </option>
              ))}
            </select>
          </div>

          {offeredLevels.length > 1 ? (
            <div className="field">
              <label htmlFor="level">{t.level}</label>
              <div className="segmented" id="level">
                {offeredLevels.map((option) => (
                  <button
                    key={option}
                    aria-pressed={level === option}
                    onClick={() =>
                      onOptionsChange({ ...options, level: option, simplify: option !== 'faithful' })
                    }
                  >
                    {LEVEL_LABELS[option]}
                  </button>
                ))}
              </div>
              <span className="field-hint">{LEVEL_HINTS[level]}</span>
            </div>
          ) : null}

          {onRetempo ? (
            <div className="field">
              <label>{t.tempoReading}</label>
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={busy || analysis.tempo / 2 < 40}
                  onClick={() => onRetempo(analysis.tempo / 2)}
                >
                  {t.halfTime}
                </button>
                <button
                  className="btn"
                  disabled={busy || analysis.tempo * 2 > 260}
                  onClick={() => onRetempo(analysis.tempo * 2)}
                >
                  {t.doubleTime}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <p className="faint" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
          {tab.capo > 0
            ? t.withCapo(
                tab.capo,
                translateKeyName(tab.shapeKeyName, lang),
                translateKeyName(tab.key.name, lang),
                tab.capoOpenRatio,
              )
            : t.openShapes(tab.capoOpenRatio)}
        </p>
      </div>

      <div className="card">
        <h2>{strumName(tab.strum.id)}</h2>
        <p style={{ fontSize: 14 }}>{t.strumDescriptions[tab.strum.id] ?? ''}</p>
        <StrumRow tab={tab} />
      </div>

      <div className="card">
        <h2>{t.chordChart}</h2>
        <div className="bars">
          {tab.bars.map((bar) => (
            <div
              key={bar.index}
              className={`bar${tab.loop && bar.index % tab.loop.length === 0 ? ' section-start' : ''}`}
            >
              <div className="bar-head">
                <span>{bar.index + 1}</span>
                {bar.beats !== tab.beatsPerBar ? <span>{t.barBeats(bar.beats)}</span> : null}
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

      {tab.bars.length > 0 ? (
        <div className="card">
          <div className="tab-card-head">
            <h2>{t.tablature}</h2>
            {tab.loop ? (
              <div className="segmented">
                <button aria-pressed={tabScope === 'song'} onClick={() => setTabScope('song')}>
                  {t.wholeSong}
                </button>
                <button aria-pressed={tabScope === 'loop'} onClick={() => setTabScope('loop')}>
                  {t.justLoop}
                </button>
              </div>
            ) : null}
          </div>
          <div className="tablature">
            {systems.map((system) => (
              <div className="tab-sys" key={system.startBar}>
                <div className="tab-sys-label">
                {system.bars > 1
                  ? t.systemBars(system.startBar + 1, system.startBar + system.bars)
                  : t.systemBar(system.startBar + 1)}
              </div>
                <pre className="tab-grid">{system.text}</pre>
              </div>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => window.print()}>
              <PrintIcon size={16} /> {t.printTab}
            </button>
            <button className="btn" onClick={copyText}>
              {copied ? t.copied : t.copyTab}
            </button>
          </div>
        </div>
      ) : null}

      <PrintSheet tab={tab} title={title} />

      <div className="sticky-cta">
        <button className="btn btn-primary btn-lg" onClick={() => onPractice(tab)}>
          <PlayIcon size={18} /> {t.practiseThis}
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
