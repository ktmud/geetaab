import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from './core/analyze';
import { decodeAudioFile } from './audio/decode';
import { DEMO_PROGRESSION, renderProgression } from './audio/synth';
import { encodeWav } from './audio/wav';
import { analyzeInWorker } from './worker/analyzeClient';
import {
  deleteSong,
  listSongs,
  loadSong,
  newSongId,
  saveSong,
  type SongSummary,
  type StoredSong,
} from './store/library';
import type { SongTab } from './music/tab';
import { Home } from './ui/Home';
import { Listening } from './ui/Listening';
import { Practice } from './ui/Practice';
import { TabView, type TabOptions } from './ui/TabView';
import { Backdrop } from './ui/Backdrop';
import { GuitarMark } from './ui/icons';

type Screen =
  | { name: 'home' }
  | { name: 'listening' }
  | { name: 'analyzing'; stage: string; fraction: number }
  | { name: 'tab' }
  | { name: 'practice'; tab: SongTab }
  | { name: 'error'; message: string };

interface Session {
  id: string;
  title: string;
  createdAt: number;
  analysis: AnalysisResult;
  audio?: Blob;
  source: StoredSong['source'];
  /** Kept only for the current session, so the tempo can be re-read. */
  samples?: Float32Array;
  sampleRate?: number;
}

const MAX_STORED_AUDIO_BYTES = 48 * 1024 * 1024;

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [session, setSession] = useState<Session | null>(null);
  const [options, setOptions] = useState<TabOptions>({ simplify: true });
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const refreshLibrary = useCallback(() => {
    listSongs()
      .then(setSongs)
      .catch(() => setSongs([]));
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  const persist = useCallback(
    (next: Session, nextOptions: TabOptions) => {
      const record: StoredSong = {
        id: next.id,
        title: next.title,
        // Editing a title must not reorder the library or rewrite its history.
        createdAt: next.createdAt,
        analysis: next.analysis,
        capo: nextOptions.capo,
        strumId: nextOptions.strumId,
        simplify: nextOptions.simplify,
        audio: next.audio,
        source: next.source,
      };
      saveSong(record).then(refreshLibrary).catch(() => undefined);
    },
    [refreshLibrary],
  );

  const runAnalysis = useCallback(
    async (
      samples: Float32Array,
      sampleRate: number,
      meta: {
        title: string;
        source: StoredSong['source'];
        audio?: Blob;
        id?: string;
        createdAt?: number;
      },
      tempoHint?: number,
    ) => {
      setBusy(true);
      setScreen({ name: 'analyzing', stage: 'getting started', fraction: 0.02 });
      try {
        const analysis = await analyzeInWorker(samples, sampleRate, {
          tempoHint,
          onProgress: (stage, fraction) => setScreen({ name: 'analyzing', stage, fraction }),
        });
        const next: Session = {
          id: meta.id ?? newSongId(),
          title: meta.title,
          createdAt: meta.createdAt ?? Date.now(),
          analysis,
          audio: meta.audio,
          source: meta.source,
          samples,
          sampleRate,
        };
        const nextOptions: TabOptions = { simplify: true };
        setSession(next);
        setOptions(nextOptions);
        persist(next, nextOptions);
        setScreen({ name: 'tab' });
      } catch (error) {
        setScreen({
          name: 'error',
          message: error instanceof Error ? error.message : 'The analysis failed.',
        });
      } finally {
        setBusy(false);
      }
    },
    [persist],
  );

  const handleRecording = useCallback(
    (samples: Float32Array, sampleRate: number) => {
      if (samples.length < sampleRate * 3) {
        setScreen({ name: 'error', message: 'That recording was too short to work with.' });
        return;
      }
      const wav = encodeWav(samples, sampleRate);
      void runAnalysis(samples, sampleRate, {
        title: `Recording ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        source: 'microphone',
        audio: wav.size <= MAX_STORED_AUDIO_BYTES ? wav : undefined,
      });
    },
    [runAnalysis],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setScreen({ name: 'analyzing', stage: 'reading the file', fraction: 0.01 });
      try {
        const decoded = await decodeAudioFile(file);
        // Keep the original file rather than the decoded samples: it is already
        // compressed, and the practice player can play it directly.
        await runAnalysis(decoded.samples, decoded.sampleRate, {
          title: file.name.replace(/\.[^.]+$/, ''),
          source: 'file',
          audio: file.size <= MAX_STORED_AUDIO_BYTES ? file : undefined,
        });
      } catch {
        setScreen({
          name: 'error',
          message: 'That file could not be decoded. Try an MP3, M4A, WAV or OGG.',
        });
        setBusy(false);
      }
    },
    [runAnalysis],
  );

  const handleDemo = useCallback(() => {
    const sampleRate = 44100;
    const samples = renderProgression([...DEMO_PROGRESSION, ...DEMO_PROGRESSION], {
      sampleRate,
      bpm: 96,
      seed: 20240,
    });
    void runAnalysis(samples, sampleRate, {
      title: 'Demo — four chords',
      source: 'demo',
      audio: encodeWav(samples, sampleRate),
    });
  }, [runAnalysis]);

  const handleOpenSong = useCallback((id: string) => {
    void loadSong(id).then((song) => {
      if (!song) return;
      setSession({
        id: song.id,
        title: song.title,
        createdAt: song.createdAt,
        analysis: song.analysis,
        audio: song.audio,
        source: song.source,
      });
      setOptions({
        capo: song.capo,
        strumId: song.strumId,
        simplify: song.simplify ?? true,
      });
      setScreen({ name: 'tab' });
    });
  }, []);

  const handleDeleteSong = useCallback(
    (id: string) => {
      void deleteSong(id).then(refreshLibrary);
    },
    [refreshLibrary],
  );

  const updateOptions = useCallback(
    (next: TabOptions) => {
      setOptions(next);
      const current = sessionRef.current;
      if (current) persist(current, next);
    },
    [persist],
  );

  const updateTitle = useCallback(
    (title: string) => {
      setSession((current) => {
        if (!current) return current;
        const next = { ...current, title };
        persist(next, options);
        return next;
      });
    },
    [options, persist],
  );

  const handleRetempo = useCallback(
    (bpm: number) => {
      const current = sessionRef.current;
      if (!current?.samples || !current.sampleRate) return;
      void runAnalysis(
        current.samples,
        current.sampleRate,
        {
          title: current.title,
          source: current.source,
          audio: current.audio,
          id: current.id,
          createdAt: current.createdAt,
        },
        bpm,
      );
    },
    [runAnalysis],
  );

  const micSupported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  if (screen.name === 'practice' && session) {
    return (
      <Practice
        tab={screen.tab}
        title={session.title}
        beats={session.analysis.beats}
        barPhase={session.analysis.barPhase}
        audio={session.audio}
        onExit={() => setScreen({ name: 'tab' })}
      />
    );
  }

  return (
    <>
      {/* Outside .app on purpose. As a child it painted over every unpositioned
          element: a fixed element with a z-index paints after in-flow block
          backgrounds, so the string field landed on top of the feature cards
          while the positioned ones nearby stayed clear. */}
      <Backdrop />
      <div className="app">
        <header className={`topbar${screen.name === 'home' ? ' topbar-home' : ''}`}>
          <button
            className={`brand${screen.name === 'home' ? ' brand-lg' : ''}`}
            onClick={() => setScreen({ name: 'home' })}
            style={{ background: 'none', border: 'none', padding: 0 }}
          >
            <GuitarMark size={screen.name === 'home' ? 46 : 30} className="brand-mark" />
            geetaab
          </button>
          <span className="spacer" />
          {screen.name !== 'home' ? (
            <button className="btn btn-ghost" onClick={() => setScreen({ name: 'home' })}>
              Home
            </button>
          ) : null}
        </header>

        {screen.name === 'home' ? (
          <Home
            songs={songs}
            micSupported={micSupported}
            onRecord={() => setScreen({ name: 'listening' })}
            onFile={(file) => void handleFile(file)}
            onDemo={handleDemo}
            onOpenSong={handleOpenSong}
            onDeleteSong={handleDeleteSong}
          />
        ) : null}

        {screen.name === 'listening' ? (
          <Listening onDone={handleRecording} onCancel={() => setScreen({ name: 'home' })} />
        ) : null}

        {screen.name === 'analyzing' ? (
          <div className="shell">
            <div className="card" style={{ marginTop: 40 }}>
              <div className="eyebrow">Working it out</div>
              <h2 style={{ textTransform: 'capitalize' }}>{screen.stage}…</h2>
              <div className="progress-track" style={{ marginTop: 14 }}>
                <div className="progress-fill" style={{ width: `${Math.round(screen.fraction * 100)}%` }} />
              </div>
              <p className="faint" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
                All of this runs on your device. Nothing is uploaded.
              </p>
            </div>
          </div>
        ) : null}

        {screen.name === 'tab' && session ? (
          <TabView
            analysis={session.analysis}
            title={session.title}
            options={options}
            busy={busy}
            onTitleChange={updateTitle}
            onOptionsChange={updateOptions}
            onPractice={(tab) => setScreen({ name: 'practice', tab })}
            onBack={() => setScreen({ name: 'home' })}
            onRetempo={session.samples ? handleRetempo : undefined}
          />
        ) : null}

        {screen.name === 'error' ? (
          <div className="shell">
            <div className="card" style={{ marginTop: 40 }}>
              <h2>That did not work</h2>
              <p>{screen.message}</p>
              <button className="btn btn-primary" onClick={() => setScreen({ name: 'home' })}>
                Start over
              </button>
            </div>
          </div>
    ) : null}
      </div>
    </>
  );
}
