import { useEffect, useMemo, useState } from 'react';
import type { AnalysisResult } from '../core/analyze';
import { isNoChord } from '../core/chordTypes';
import type { SongTab } from '../music/tab';
import { TabSettings } from './TabSettings';
import type { ArrangedSong, TabOptions } from './tabOptions';
import { songTabText } from '../music/tabText';
import { engraveSystems } from '../music/tabEngrave';
import { enterImmersive } from './immersive';
import { LazyTabStaff } from './TabStaff';
import { shapeNoteText, useT, useLanguage, translateKeyName } from '../i18n';
import { ChordCard } from './ChordDiagram';
import { PrintSheet } from './PrintSheet';
import { usePrintMount } from './printing';
import { useScrollAnchor } from './scrollAnchor';
import { BackIcon, CheckIcon, PlayIcon, PrintIcon } from './icons';

export interface TabViewProps {
  analysis: AnalysisResult;
  /** The arrangement, derived once above so practice shows the same one. */
  song: ArrangedSong;
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
  song,
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
  const { printing, print } = usePrintMount();
  // The chord boxes are above these controls and the level switch changes how
  // many there are, so the control has to be pinned while that happens.
  const settingsAnchor = useScrollAnchor<HTMLDivElement>();
  const [tabScope, setTabScope] = useState<'song' | 'loop'>('song');
  const [editingTitle, setEditingTitle] = useState(false);

  const strumName = (id: string): string => t.strumNames[id] ?? id;

  const { tab } = song;
  const hardChords = tab.palette.filter((chord) => chord.shape.difficulty === 3);
  const lowConfidence = tab.confidence < 0.24;
  /**
   * Whether the analysis found any harmony at all.
   *
   * Confidence alone cannot answer this: measured through this pipeline, a
   * mains hum scores 0.588 — higher than every real song in the corpus —
   * because one sustained tone matches a chord template perfectly. What
   * separates music from not-music is how much of the track came back as
   * "no chord": broadband noise and speech land at 100%, while the most
   * sparse real piece in the corpus (a fingerpicked film cue with long
   * silences) reaches 18%. Confidence is kept as a second gate for the
   * opposite failure — audible harmony too smeared to name — where real
   * songs bottom out at 0.220 and noise sits at 0.075.
   */
  const heardNothing = useMemo(() => {
    let played = 0;
    let quiet = 0;
    for (const seg of analysis.segments) {
      const seconds = seg.end - seg.start;
      played += seconds;
      if (isNoChord(seg.chord)) quiet += seconds;
    }
    if (played <= 0) return true;
    return quiet / played >= 0.5 || tab.confidence < 0.15;
  }, [analysis.segments, tab.confidence]);

  const systems = useMemo(() => {
    const bars =
      tabScope === 'loop' && tab.loop
        ? tab.bars.slice(0, Math.min(tab.bars.length, tab.loop.length))
        : tab.bars;
    // No fixed bars-per-line: how many fit is a property of how busy this
    // song's bars are, and the layout works it out.
    return engraveSystems(bars, tab.strum);
  }, [tab, tabScope]);

  /**
   * Whether the docked Practise button has got out of the way.
   *
   * It is fixed over the bottom of the page so it is reachable from anywhere in
   * a long tab, but at the end of the page there is nothing left to reach past
   * — it just sits on the last system and the footer. Near the bottom it slides
   * down and hands the space back.
   */
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const onScroll = (): void => {
      const doc = document.documentElement;
      const fromBottom = doc.scrollHeight - (window.scrollY + window.innerHeight);
      setTucked(fromBottom < 90);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const copyText = async (): Promise<void> => {
    const text = songTabText(tab, title, {
      ...t.tabText,
      strumName: strumName(tab.strum.id),
      translateKey: (name) => translateKeyName(name, lang),
    });
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
    // has-dock: this screen keeps a Practise button over the bottom of the page.
    <div className="shell has-dock">
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

      {heardNothing ? (
        <div className="notice notice-bad">{t.heardNoChords}</div>
      ) : lowConfidence ? (
        <div className="notice notice-warn">{t.lowConfidence}</div>
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

      <div className="card" ref={settingsAnchor.ref}>
        <h2>{t.makeItFitHands}</h2>
        <TabSettings
          analysis={analysis}
          song={song}
          options={options}
          onOptionsChange={(next) => {
            settingsAnchor.hold();
            onOptionsChange(next);
          }}
          onRetempo={onRetempo}
          busy={busy}
        />
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
            {systems.map((system) => {
              const label =
                system.bars.length > 1
                  ? t.systemBars(system.startBar + 1, system.startBar + system.bars.length)
                  : t.systemBar(system.startBar + 1);
              return (
                <div className="tab-sys" key={system.startBar}>
                  <LazyTabStaff system={system} label={label} />
                </div>
              );
            })}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn tab-actions-print" onClick={print}>
              <PrintIcon size={16} /> {t.printTab}
            </button>
            <button className="btn" onClick={copyText}>
              {copied ? t.copied : t.copyTab}
            </button>
          </div>
        </div>
      ) : null}

      {/* Built only when something is about to print it; see printing.ts. */}
      {printing ? <PrintSheet tab={tab} title={title} /> : null}

      <div className={`sticky-cta${tucked ? ' tucked' : ''}`}>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            // Synchronously, before the screen swaps: full screen is only
            // granted while this gesture is still being handled.
            void enterImmersive();
            onPractice(tab);
          }}
        >
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
