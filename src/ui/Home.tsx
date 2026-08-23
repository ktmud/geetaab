import { useRef } from 'react';
import type { SongSummary } from '../store/library';
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
    <div className="shell">
      <section className="hero">
        <div className="eyebrow">Guitar tabs, by ear</div>
        <h1>
          <span>Play a song near your mic.</span>
          <span>Get a tab you can actually play.</span>
        </h1>
        <p className="lede">
          geetab listens to the harmony, works out the chords, the key and the tempo, then rewrites
          the song in shapes a beginner already knows — capo included. Then you practise it
          karaoke-style, sideways, at whatever speed you can keep up with.
        </p>

        <div className="action-grid">
          <button
            className="action-card action-primary"
            onClick={onRecord}
            disabled={!micSupported}
          >
            <MicIcon size={30} className="action-icon" />
            <strong>Listen with the mic</strong>
            <span>
              {micSupported
                ? 'Hold your phone near a speaker and play 30 seconds of the song.'
                : 'Your browser will not give this page microphone access.'}
            </span>
          </button>

          <button className="action-card" onClick={() => fileInput.current?.click()}>
            <FileIcon size={30} className="action-icon" />
            <strong>Open an audio file</strong>
            <span>A clean file beats a room recording. MP3, M4A, WAV, anything the browser reads.</span>
          </button>

          <button className="action-card" onClick={onDemo}>
            <SparkIcon size={30} className="action-icon" />
            <strong>Try the demo track</strong>
            <span>A synthesized four-chord loop, so you can see the whole thing work right now.</span>
          </button>
        </div>

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
      </section>

      {songs.length > 0 ? (
        <section style={{ marginTop: 34 }}>
          <h2>Your songs</h2>
          <div className="song-list">
            {songs.map((song) => (
              <div key={song.id} className="song-row">
                <button
                  className="song-row-main"
                  onClick={() => onOpenSong(song.id)}
                  style={{ background: 'none', border: 'none', padding: 0 }}
                >
                  <div className="song-row-title">{song.title}</div>
                  <div className="song-row-meta">
                    {song.keyName} · {Math.round(song.tempo)} BPM ·{' '}
                    {song.capo > 0 ? `capo ${song.capo}` : 'no capo'} · {formatDuration(song.duration)} ·{' '}
                    {formatWhen(song.createdAt)}
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
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ marginTop: 34 }}>
        <h2>How it works</h2>
        <div className="card">
          <ol className="tip-list" style={{ paddingLeft: 0, margin: 0 }}>
            <li>
              <strong>It listens.</strong> A chromagram measures how much of each of the twelve pitch
              classes is sounding, several times a second, with the recording's own tuning measured
              first so a song mastered slightly sharp still reads correctly.
            </li>
            <li>
              <strong>It finds the pulse.</strong> Onsets give the tempo, and a beat tracker lays a
              grid over the whole recording so chord changes land on beats instead of between them.
            </li>
            <li>
              <strong>It picks the chords.</strong> Every beat is matched against chord templates
              that model real overtones, then smoothed so the result is the handful of changes a
              player would write down rather than a flicker of near-misses.
            </li>
            <li>
              <strong>It rewrites for your hands.</strong> A capo is chosen to put as much of the
              song as possible on open shapes, and the leftovers get the substitutions a teacher
              would make.
            </li>
          </ol>
          <hr className="divider" />
          <p className="faint" style={{ marginBottom: 0, fontSize: 13 }}>
            Everything runs in this browser tab. No audio is uploaded, and your songs are stored on
            this device only.
          </p>
        </div>
      </section>
    </div>
  );
}
