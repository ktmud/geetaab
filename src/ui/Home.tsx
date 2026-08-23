import { useRef } from 'react';
import type { SongSummary } from '../store/library';
import { easiestShape } from '../music/shapes';
import type { ChordQuality } from '../core/chordTypes';
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

function formatWhen(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
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
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="shell home">
      <section className="home-hero">
        <div className="eyebrow">Guitar tabs, by ear</div>
        <h1>
          <span>Play a song near your mic.</span>
          <span>Get a tab you can actually play.</span>
        </h1>
        <div className="hero-split">
          <div className="hero-copy">
            <p className="lede">
              geetaab works out the chords, the key and the tempo, then rewrites the song in shapes
              a beginner already knows — capo included. Then you practise it karaoke-style,
              sideways, at whatever speed you can keep up with.
            </p>

            <div className="hero-actions">
              <button
                className="btn btn-primary btn-hero"
                onClick={onRecord}
                disabled={!micSupported}
              >
                <MicIcon size={19} />
                Listen with the mic
              </button>
              <div className="hero-alt">
                {micSupported ? 'or ' : 'Your browser blocks microphone access — '}
                <button className="link-button" onClick={() => fileInput.current?.click()}>
                  open an audio file
                </button>
                {' · '}
                <button className="link-button" onClick={onDemo}>
                  try the demo
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
        accept="audio/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      {songs.length > 0 ? (
        <section className="home-section">
          <div className="section-head">
            <h2>Your songs</h2>
            <p>Stored on this device only.</p>
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
                      {song.capo > 0 ? `capo ${song.capo}` : 'no capo'} ·{' '}
                      {formatDuration(song.duration)} · {formatWhen(song.createdAt)}
                    </div>
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => onDeleteSong(song.id)}
                    aria-label={`Delete ${song.title}`}
                    title="Delete"
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
          <h2>What comes out</h2>
          <p>Every example below is real output, not a mock-up.</p>
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
              <h3>Shapes you already know</h3>
              <p>
                A song in E♭ has four barre chords in it. geetaab puts a capo on the third fret and
                hands you C, G, Am and an Fmaj7 instead.
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
              <h3>The loop, not the whole song</h3>
              <p>
                Most songs are one progression repeated. geetaab finds it and tells you how much of
                the track it covers, so you learn four bars instead of three minutes.
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
              <h3>Practise sideways</h3>
              <p>
                Turn the phone landscape and the chords scroll past a playhead, with a count-in, a
                click, section looping and slow-down that keeps the pitch.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2>How it works</h2>
          <p>No server, no model download. It all happens in this tab.</p>
        </div>
        <ol className="steps">
          <li>
            <strong>It listens</strong>
            Twelve pitch classes are measured several times a second, with the recording's own
            tuning worked out first — so a song mastered slightly sharp still reads correctly.
          </li>
          <li>
            <strong>It finds the pulse</strong>
            Note onsets give the tempo, and a beat tracker lays a grid over the whole recording so
            chord changes land on beats instead of between them.
          </li>
          <li>
            <strong>It picks the chords</strong>
            Each beat is matched against chord templates that model real overtones, then smoothed
            into the handful of changes a player would write down.
          </li>
          <li>
            <strong>It rewrites for your hands</strong>
            A capo goes wherever it puts the most of the song on open shapes, and what is left gets
            the substitutions a teacher would make.
          </li>
        </ol>
      </section>

      <footer className="home-footer">
        Everything runs in this browser tab: no audio is uploaded, and your songs are stored on this
        device only. The chords are a machine transcription — trust your ears over them.
      </footer>
    </div>
  );
}
