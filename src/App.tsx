import { useCallback, useEffect, useRef, useState } from 'react';
import { ANALYSIS_VERSION, type AnalysisResult } from './core/analyze';
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
import { useT, useLanguage } from './i18n';
import { useTheme } from './theme';
import { ChordLibrary } from './ui/ChordLibrary';
import { Home } from './ui/Home';
import { HowItWorks } from './ui/HowItWorks';
import { Listening } from './ui/Listening';
import { Practice } from './ui/Practice';
import { TabView, type TabOptions } from './ui/TabView';
import { Backdrop } from './ui/Backdrop';
import { GitHubIcon, GuitarMark, MoonIcon, SunIcon } from './ui/icons';

type Screen =
  | { name: 'home' }
  | { name: 'listening' }
  | { name: 'analyzing'; stage: string; fraction: number }
  | { name: 'tab' }
  | { name: 'practice'; tab: SongTab }
  | { name: 'chords' }
  | { name: 'how' }
  | { name: 'error'; error: 'recordingTooShort' | 'couldNotDecode' | 'analysisFailed'; detail?: string };

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
  const t = useT();
  const [lang, setLang] = useLanguage();
  const { theme, setTheme } = useTheme();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [session, setSession] = useState<Session | null>(null);
  const [options, setOptions] = useState<TabOptions>({ simplify: true });
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  // Anything that sticks below the topbar needs its real height, which changes
  // with the screen (the home wordmark is larger), the language and the loaded
  // font. Measuring beats arithmetic that goes stale.
  const topbarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = topbarRef.current;
    if (!bar) return;
    const publish = (): void => {
      document.documentElement.style.setProperty('--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

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
        analysisVersion: ANALYSIS_VERSION,
        capo: nextOptions.capo,
        strumId: nextOptions.strumId,
        simplify: nextOptions.simplify,
        level: nextOptions.level,
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
          error: 'analysisFailed',
          detail: error instanceof Error ? error.message : undefined,
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
        setScreen({ name: 'error', error: 'recordingTooShort' });
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
          error: 'couldNotDecode',
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
    void loadSong(id).then(async (song) => {
      if (!song) return;
      // An accuracy fix should reach songs a player already has. When the
      // stored tab predates the current pipeline and the audio was kept, work
      // it out again; without the audio the old tab is all there is.
      if (song.analysisVersion !== ANALYSIS_VERSION && song.audio) {
        try {
          const decoded = await decodeAudioFile(
            new File([song.audio], `${song.title}`, { type: song.audio.type || 'audio/wav' }),
          );
          await runAnalysis(decoded.samples, decoded.sampleRate, {
            title: song.title,
            source: song.source,
            audio: song.audio,
            id: song.id,
            createdAt: song.createdAt,
          });
          return;
        } catch {
          // Undecodable now: fall through and show what was stored.
        }
      }
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
        level: song.level,
      });
      setScreen({ name: 'tab' });
    });
  }, [runAnalysis]);

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
          while the positioned ones nearby stayed clear.

          Not mounted while recording: that screen has its own background — the
          take's spectrogram — and two ambient layers fight each other. It also
          keeps the pluck timers quiet while the live analysis needs the CPU.
          The practice screen already drops it the same way. */}
      {screen.name !== 'listening' ? <Backdrop /> : null}
      <div className="app">
        <header ref={topbarRef} className={`topbar${screen.name === 'home' ? ' topbar-home' : ''}`}>
          <button
            className={`brand${screen.name === 'home' ? ' brand-lg' : ''}`}
            onClick={() => setScreen({ name: 'home' })}
            style={{ background: 'none', border: 'none', padding: 0 }}
          >
            <GuitarMark size={screen.name === 'home' ? 46 : 30} className="brand-mark" />
            <span className="brand-text">geetaab</span>
          </button>
          <span className="spacer" />
          {screen.name !== 'practice' && screen.name !== 'chords' ? (
            <button className="btn btn-ghost" onClick={() => setScreen({ name: 'chords' })}>
              {t.chords}
            </button>
          ) : null}
          {screen.name !== 'practice' && screen.name !== 'home' ? (
            <button className="btn btn-ghost" onClick={() => setScreen({ name: 'home' })}>
              {t.home}
            </button>
          ) : null}
          {screen.name !== 'practice' ? (
            <div className="lang-switch" role="group" aria-label={t.language}>
              <button
                type="button"
                className={lang === 'en' ? 'on' : ''}
                aria-pressed={lang === 'en'}
                onClick={() => setLang('en')}
              >
                EN
              </button>
              <button
                type="button"
                className={lang === 'zh' ? 'on' : ''}
                aria-pressed={lang === 'zh'}
                onClick={() => setLang('zh')}
              >
                CN
              </button>
            </div>
          ) : null}
          {screen.name !== 'practice' ? (
            <button
              className="btn btn-ghost btn-theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? t.switchToLight : t.switchToDark}
              title={theme === 'dark' ? t.switchToLight : t.switchToDark}
            >
              {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              <span className="btn-theme-label">{theme === 'dark' ? t.lightTheme : t.darkTheme}</span>
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

        {screen.name === 'chords' ? (
          <ChordLibrary onBack={() => setScreen({ name: 'home' })} />
        ) : null}

        {screen.name === 'how' ? (
          <HowItWorks onBack={() => setScreen({ name: 'home' })} />
        ) : null}

        {screen.name === 'analyzing' ? (
          <div className="shell">
            <div className="card" style={{ marginTop: 40 }}>
              <div className="eyebrow">{t.workingItOut}</div>
              <h2 style={{ textTransform: 'capitalize' }}>
                {t.stages[screen.stage] ?? screen.stage}…
              </h2>
              <div className="progress-track" style={{ marginTop: 14 }}>
                <div className="progress-fill" style={{ width: `${Math.round(screen.fraction * 100)}%` }} />
              </div>
              <p className="faint" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
                {t.allRunsDevice}
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
              <h2>{t.thatDidNotWork}</h2>
              <p>{screen.detail ?? t[screen.error]}</p>
              <button className="btn btn-primary" onClick={() => setScreen({ name: 'home' })}>
                {t.startOver}
              </button>
            </div>
          </div>
    ) : null}

        <footer className="app-footer">
          <span>{t.geetaabOpenSource}</span>
          <a href="https://github.com/ktmud/geetaab" target="_blank" rel="noreferrer">
            <GitHubIcon size={15} /> ktmud/geetaab
          </a>
          {screen.name !== 'how' ? (
            <>
              <span aria-hidden="true">·</span>
              <button className="footer-link" onClick={() => setScreen({ name: 'how' })}>
                {t.howChordsRecognized}
              </button>
            </>
          ) : null}
        </footer>
      </div>
    </>
  );
}
