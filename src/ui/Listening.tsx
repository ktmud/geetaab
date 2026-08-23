import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { stateToChord } from '../core/analyze';
import { SHARP_NAMES, chordName } from '../core/chordTypes';
import { pitchClassHue } from '../music/pitchColor';
import { NC_STATE } from '../core/chords';
import { Recorder, type LiveFrame } from '../audio/recorder';
import { StopIcon } from './icons';

const MAX_SECONDS = 180;
const MIN_SECONDS = 6;

export interface ListeningProps {
  onDone: (samples: Float32Array, sampleRate: number) => void;
  onCancel: () => void;
}

export function Listening({ onDone, onCancel }: ListeningProps) {
  const recorderRef = useRef<Recorder | null>(null);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const finishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const recorder = new Recorder({
      onFrame: (f) => {
        if (!cancelled) setFrame(f);
      },
      maxSeconds: MAX_SECONDS,
      onMaxReached: () => finishRef.current?.(),
    });
    recorderRef.current = recorder;

    recorder.start().catch((err: unknown) => {
      if (cancelled) return;
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser settings, then try again.'
          : err instanceof Error
            ? err.message
            : 'The microphone could not be opened.';
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

  const chroma = frame?.chroma ?? new Array(12).fill(0);
  const level = frame ? Math.min(1, Math.sqrt(frame.level * 6)) : 0;
  const clipping = (frame?.peak ?? 0) > 0.985;
  const quiet = frame !== null && frame.level < 0.004;
  const chord = frame && frame.chordState !== NC_STATE ? stateToChord(frame.chordState) : null;
  const chordLabel = chord && (frame?.chordScore ?? 0) > 0.12 ? chordName(chord) : '···';
  const ready = seconds >= MIN_SECONDS;

  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  if (error) {
    return (
      <div className="shell">
        <div className="card">
          <h2>The microphone did not open</h2>
          <p>{error}</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={onCancel}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell listen">
      <div className="eyebrow">Listening</div>

      <div className="listen-ring">
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
          <div className="listen-chord-sub">hearing now</div>
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

      <div className="listen-timer">
        {String(Math.floor(seconds / 60)).padStart(2, '0')}:
        {String(Math.floor(seconds % 60)).padStart(2, '0')}
      </div>

      {clipping ? (
        <div className="notice notice-warn">Too loud — move further from the speaker.</div>
      ) : quiet ? (
        <div className="notice notice-info">Very quiet. Move closer, or turn the song up.</div>
      ) : null}

      <button className="btn btn-primary btn-lg" onClick={finish} disabled={!ready || stopping}>
        <StopIcon size={18} />
        {stopping ? 'Working…' : ready ? 'Stop and build the tab' : `Keep going… ${MIN_SECONDS - Math.floor(seconds)}s`}
      </button>

      <button className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>

      <ul className="tip-list card" style={{ maxWidth: 460 }}>
        <li>Point the phone at the speaker, about an arm's length away.</li>
        <li>Catch a chorus. Thirty seconds of the part you want to play is plenty.</li>
        <li>Quiet room, no singing along — voices confuse the harmony.</li>
        <li>Songs built on a guitar or piano read best; heavy production reads worst.</li>
      </ul>
    </div>
  );
}
