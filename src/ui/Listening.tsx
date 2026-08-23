import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { stateToChord } from '../core/analyze';
import { SHARP_NAMES, chordName } from '../core/chordTypes';
import { pitchClassHue } from '../music/pitchColor';
import { NC_STATE } from '../core/chords';
import { useT } from '../i18n';
import { Recorder, type LiveFrame } from '../audio/recorder';
import { SpectroPainter } from './spectroPainter';
import { StopIcon } from './icons';

const MAX_SECONDS = 180;
const MIN_SECONDS = 6;

export interface ListeningProps {
  onDone: (samples: Float32Array, sampleRate: number) => void;
  onCancel: () => void;
}

export function Listening({ onDone, onCancel }: ListeningProps) {
  const t = useT();
  const recorderRef = useRef<Recorder | null>(null);
  const painterRef = useRef<SpectroPainter | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const finishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const painter = new SpectroPainter();
    painterRef.current = painter;
    if (canvasRef.current) painter.attach(canvasRef.current);

    const recorder = new Recorder({
      onFrame: (f) => {
        if (!cancelled) setFrame(f);
      },
      maxSeconds: MAX_SECONDS,
      onMaxReached: () => finishRef.current?.(),
      // The take should be the song, not the shuffling before it: hold until
      // the microphone hears music, keeping the last moment so the first strum
      // still makes it in.
      waitForMusic: true,
      onSpectrum: (column) => {
        if (!cancelled) painter.push(column);
      },
    });
    recorderRef.current = recorder;

    recorder.start().catch((err: unknown) => {
      if (cancelled) return;
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? t.microphone
          : err instanceof Error
            ? err.message
            : t.microphone;
      setError(message);
    });

    const timer = window.setInterval(() => {
      if (!cancelled) setSeconds(recorder.seconds);
    }, 100);

    return () => {
      cancelled = true;
      clearInterval(timer);
      void recorder.cancel();
      recorderRef.current = null;
      painter.dispose();
      painterRef.current = null;
    };
  }, []);

  const finish = useCallback((): void => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setStopping(true);
    void recorder.stop().then(({ samples, sampleRate }) => {
      onDone(samples, sampleRate);
    });
  }, [onDone]);

  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const waiting = (frame?.status ?? 'waiting') === 'waiting';
  const chroma = frame?.chroma ?? new Array(12).fill(0);
  const level = frame ? Math.min(1, Math.sqrt(frame.level * 6)) : 0;
  const clipping = (frame?.peak ?? 0) > 0.985;
  const quiet = frame !== null && frame.level < 0.004;
  const heardSomething = frame !== null && !quiet;
  const chord = frame && frame.chordState !== NC_STATE ? stateToChord(frame.chordState) : null;
  const chordLabel = chord && (frame?.chordScore ?? 0) > 0.12 ? chordName(chord) : '···';
  const ready = seconds >= MIN_SECONDS;

  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  if (error) {
    return (
      <div className="shell">
        <div className="card">
          <h2>{t.microphone}</h2>
          <p>{error}</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={onCancel}>
              {t.back}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell listen">
      {/* The whole take so far, stretched across the viewport behind the
          controls. It sits at the bottom of the app's stacking context, so the
          chord readout stays the subject and this stays the room it happens in. */}
      <canvas ref={canvasRef} className={`listen-spectro${waiting ? '' : ' on'}`} aria-hidden="true" />

      <div className="eyebrow">{waiting ? t.waitingForSong : t.recording}</div>

      <div className={`listen-ring${waiting ? ' waiting' : ''}`}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - level)}
            transform="rotate(-90 60 60)"
            style={{ transition: 'stroke-dashoffset 0.12s linear' }}
          />
        </svg>
        <div>
          <div className="listen-chord">{chordLabel}</div>
          <div className="listen-chord-sub">{t.hearingNow}</div>
        </div>
      </div>

      <div>
        <div className="chroma-bars" aria-hidden="true">
          {chroma.map((value: number, index: number) => (
            <div
              key={index}
              className={`chroma-bar${value > 0.32 ? ' lit' : ''}`}
              style={
                {
                  height: Math.max(3, Math.min(46, value * 110)),
                  '--pc-hue': pitchClassHue(index),
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="chroma-labels" aria-hidden="true">
          {SHARP_NAMES.map((name, index) => (
            <span
              key={name}
              className={chroma[index] > 0.32 ? 'on' : undefined}
              style={{ '--pc-hue': pitchClassHue(index) } as CSSProperties}
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className={`listen-timer${waiting ? ' idle' : ''}`}>
        {waiting ? null : <span className="rec-dot" aria-hidden="true" />}
        {String(Math.floor(seconds / 60)).padStart(2, '0')}:
        {String(Math.floor(seconds % 60)).padStart(2, '0')}
      </div>

      {clipping ? (
        <div className="notice notice-warn">{t.tooLoud}</div>
      ) : quiet ? (
        <div className="notice notice-info">{t.veryQuiet}</div>
      ) : waiting && heardSomething ? (
        <div className="notice notice-info">
          {t.hearRoom}
        </div>
      ) : null}

      {waiting ? (
        <>
          <button className="btn btn-primary btn-lg" disabled>
            {t.playTheSong}
          </button>
          <button className="btn" onClick={() => recorderRef.current?.startNow()}>
            {t.recordAnyway}
          </button>
        </>
      ) : (
        <button className="btn btn-primary btn-lg" onClick={finish} disabled={!ready || stopping}>
          <StopIcon size={18} />
          {stopping ? t.workingText : ready ? t.stopBuildTab : t.keepGoing(MIN_SECONDS - Math.floor(seconds))}
        </button>
      )}

      <button className="btn btn-ghost" onClick={onCancel}>
        {t.cancel}
      </button>

      <ul className="tip-list card" style={{ maxWidth: 460 }}>
        {t.recordingTips.map((tip, index) => (
          <li key={index}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}
