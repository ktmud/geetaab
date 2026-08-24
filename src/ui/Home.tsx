import { useEffect, useRef, useState } from 'react';
import type { SongSummary } from '../store/library';
import { easiestShape } from '../music/shapes';
import type { ChordQuality } from '../core/chordTypes';
import { useLanguage, useT } from '../i18n';
import { ChordDiagram } from './ChordDiagram';
import { HeroVisual } from './HeroVisual';
import { FileIcon, MicIcon, SparkIcon, TrashIcon } from './icons';

export interface HomeProps {
  songs: SongSummary[];
  onRecord: () => void;
  onFile: (file: File) => void;
  onDemo: () => void;
  onOpenSong: (id: string) => void;
  onDeleteSong: (id: string) => void;
  micSupported: boolean;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "today", "3 days ago", and a plain date once that stops being useful. */
function formatWhen(timestamp: number, t: ReturnType<typeof useT>, lang: string): string {
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  return (
    t.daysAgo(days) || new Date(timestamp).toLocaleDateString(lang === 'zh' ? 'zh-CN' : undefined)
  );
}

/** The shapes a song in Eb turns into once the capo goes on. */
const SHOWCASE: { name: string; root: number; quality: ChordQuality }[] = [
  { name: 'C', root: 0, quality: 'maj' },
  { name: 'G', root: 7, quality: 'maj' },
  { name: 'Am', root: 9, quality: 'min' },
  { name: 'Fmaj7', root: 5, quality: 'maj7' },
];

const SOURCE_ICON = {
  microphone: MicIcon,
  file: FileIcon,
  demo: SparkIcon,
} as const;

export function Home({
  songs,
  onRecord,
  onFile,
  onDemo,
  onOpenSong,
  onDeleteSong,
  micSupported,
}: HomeProps) {
  const t = useT();
  const [lang] = useLanguage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossed; a depth counter is the
  // reliable way to know when the pointer has actually left the window.
  const dragDepth = useRef(0);

  useEffect(() => {
    const hasFile = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFile(event)) return;
      // Without this the browser navigates away to the dropped file.
      event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!hasFile(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) onFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onFile]);

  return (
    <div className="shell home">
      <section className="home-hero">
        <div className="eyebrow">{t.eyebrowGuitarTabs}</div>
        <h1>
          <span>{t.h1PlayNearMic}</span>
          <span>{t.h1GetTab}</span>
        </h1>
        <div className="hero-split">
          <div className="hero-copy">
            <p className="lede">
              {t.ledeParagraph}
            </p>

            <div className="hero-actions">
              <button
                className="btn btn-primary btn-hero"
                onClick={onRecord}
                disabled={!micSupported}
              >
                <MicIcon size={19} />
                {t.listenWithMic}
              </button>
              <div className="hero-alt">
                {micSupported ? t.orText : t.blocksMicrophone}
                <button className="link-button" onClick={() => fileInput.current?.click()}>
                  {t.openAudioFile}
                </button>
                {' · '}
                <button className="link-button" onClick={onDemo}>
                  {t.tryDemo}
                </button>
              </div>
            </div>
          </div>

          <HeroVisual />
        </div>
      </section>

      <input
        ref={fileInput}
        type="file"
        // iOS matches this against a file's declared type, and audio that
        // arrives through iCloud Drive often carries none — so audio/* alone
        // greys out the very m4a the user came to open. The extensions give
        // the picker something to match when the type is missing.
        accept="audio/*,.m4a,.mp3,.wav,.ogg,.oga,.aac,.flac,.aif,.aiff,.caf,.mp4,.opus"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      {dragging ? (
        <div className="drop-veil" aria-hidden="true">
          <div className="drop-veil-card">
            <FileIcon size={28} />
            <span>{t.dropToOpen}</span>
          </div>
        </div>
      ) : null}

      {songs.length > 0 ? (
        <section className="home-section">
          <div className="section-head">
            <h2>{t.yourSongs}</h2>
            <p>{t.storedOnDevice}</p>
          </div>
          <div className="song-list">
            {songs.map((song) => {
              const Icon = SOURCE_ICON[song.source];
              return (
                <div key={song.id} className="song-row">
                  <span className="song-source">
                    <Icon size={17} />
                  </span>
                  <button
                    className="song-row-main"
                    onClick={() => onOpenSong(song.id)}
                    style={{ background: 'none', border: 'none', padding: 0 }}
                  >
                    <div className="song-row-title">{song.title}</div>
                    <div className="song-row-meta">
                      {song.keyName} · {Math.round(song.tempo)} BPM ·{' '}
                      {song.capo > 0 ? t.capoText(song.capo) : t.noCapo} ·{' '}
                      {formatDuration(song.duration)} · {formatWhen(song.createdAt, t, lang)}
                    </div>
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => onDeleteSong(song.id)}
                    aria-label={t.deleteLabel(song.title)}
                    title={t.deleteTitle}
                  >
                    <TrashIcon size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="home-section">
        <div className="section-head">
          <h2>{t.whatComesOut}</h2>
          <p>{t.everyExampleReal}</p>
        </div>
        <div className="feature-grid">
          <article className="feature">
            <div className="feature-stage">
              <div className="feature-shapes">
                {SHOWCASE.map((chord) => {
                  const shape = easiestShape({ root: chord.root, quality: chord.quality });
                  return shape ? (
                    <div className="feature-shape" key={chord.name}>
                      <ChordDiagram shape={shape} width={62} showFingers={false} />
                      <span>{chord.name}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
            <div>
              <h3>{t.shapesYouKnow}</h3>
              <p>
                {t.shapesDescription}
              </p>
            </div>
          </article>

          <article className="feature">
            <div className="feature-stage">
              <div className="feature-loop">
                <b>G</b>
                <i>→</i>
                <b>D</b>
                <i>→</i>
                <b>Am</b>
                <i>→</i>
                <b>C</b>
              </div>
            </div>
            <div>
              <h3>{t.loopNotWhole}</h3>
              <p>
                {t.loopDescription}
              </p>
            </div>
          </article>

          <article className="feature">
            <div className="feature-stage">
              <div className="mini-lane">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <span key={i} className="mini-lane-beat" style={{ left: `${6 + i * 12}%` }} />
                ))}
                <div className="mini-lane-block on" style={{ left: '4%', width: '38%' }}>
                  Am
                </div>
                <div className="mini-lane-block" style={{ left: '45%', width: '38%' }}>
                  F
                </div>
                <div className="mini-lane-block" style={{ left: '86%', width: '38%' }}>
                  C
                </div>
                <span className="mini-lane-head" />
              </div>
            </div>
            <div>
              <h3>{t.practiceAlong}</h3>
              <p>
                {t.practiceAlongDescription}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2>{t.howItWorks}</h2>
          <p>{t.noServerDownload}</p>
        </div>
        <ol className="steps">
          <li>
            <strong>{t.listens}</strong>
            {t.listensDescription}
          </li>
          <li>
            <strong>{t.findsThePulse}</strong>
            {t.findsDescription}
          </li>
          <li>
            <strong>{t.picksChords}</strong>
            {t.picksDescription}
          </li>
          <li>
            <strong>{t.rewritesHands}</strong>
            {t.rewritesDescription}
          </li>
        </ol>
      </section>

      <footer className="home-footer">
        {t.everythingRunsBrowser}
      </footer>
    </div>
  );
}
