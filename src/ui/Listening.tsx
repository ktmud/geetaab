import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { stateToChord } from '../core/analyze';
import { SHARP_NAMES, chordName } from '../core/chordTypes';
import { pitchClassHue } from '../music/pitchColor';
import { NC_STATE } from '../core/chords';
import { MUSIC_CHORD_FLOOR } from '../core/music';
import { useT } from '../i18n';
import { Recorder, type LiveFrame } from '../audio/recorder';
import { SpectroPainter } from './spectroPainter';
import { BackIcon, StopIcon, TrashIcon } from './icons';

const MAX_SECONDS = 180;
const MIN_SECONDS = 6;

export interface ListeningProps {
  onDone: (samples: Float32Array, sampleRate: number) => void;
  onCancel: () => void;
}

/**
 * Size class for a chord name, so the ring can hold its longest one.
 *
 * The vocabulary is twelve roots against seven suffixes plus N.C., so names run
 * one to six characters. Measured in the browser rather than assumed: at the
 * top of the type clamp the widest six-character name, D#maj7, spans 215px
 * against an inner diameter of 186px — but so does D#m7 at four characters,
 * spanning 168px, which is why the steps start there and not at five. The CSS
 * does the sizing; this only says which bucket the name is in.
 */
function nameSize(label: string): string {
  if (label.length >= 6) return ' longest';
  if (label.length === 5) return ' longer';
  if (label.length === 4) return ' long';
  return '';
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
  // Which attempt this is. Bumping it tears the whole take down and builds a
  // fresh one — recorder, ring buffer, music gate and spectrogram included —
  // so a restart behaves like a first run rather than inheriting a history.
  const [take, setTake] = useState(0);
  const finishRef = useRef<(() => void) | null>(null);
  /** The last chroma heard while there really was music, for the frozen meter. */
  const heldChroma = useRef<number[]>(new Array(12).fill(0));

  useEffect(() => {
    let cancelled = false;
    const painter = new SpectroPainter();
    painterRef.current = painter;
    // A new painter starts empty, and attaching clears the canvas it is given:
    // the backdrop shows this take, never the one that was thrown away.
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
  }, [take]);

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

  /**
   * Throw this take away without leaving the screen.
   *
   * Someone who mistimed the start wants another go, not the home screen, so
   * every trace of the attempt goes: the recorded buffer and its elapsed timer
   * here, and the recorder's ring buffer, music gate and spectrogram when the
   * effect rebuilds them.
   */
  const discard = useCallback((): void => {
    heldChroma.current = new Array(12).fill(0);
    setFrame(null);
    setSeconds(0);
    setStopping(false);
    setError(null);
    setTake((n) => n + 1);
  }, []);

  const waiting = (frame?.status ?? 'waiting') === 'waiting';
  const level = frame ? Math.min(1, Math.sqrt(frame.level * 6)) : 0;
  const clipping = (frame?.peak ?? 0) > 0.985;
  const quiet = frame !== null && frame.level < 0.004;
  const heardSomething = frame !== null && !quiet;
  const chord = frame && frame.chordState !== NC_STATE ? stateToChord(frame.chordState) : null;
  /**
   * Whether this instant is worth naming a chord over.
   *
   * The floor is MUSIC_CHORD_FLOOR — the same calibrated cut the music gate
   * already applies to this exact number, the best score against the
   * zero-centred chord templates. Measured through the live readout's own
   * pipeline: played chords score 0.125 to 0.43, while white noise tops out at
   * 0.056, pink room tone at 0.072 and digital silence sits at 0.018. The
   * gate's own verdict has to be part of it, because the score alone is not
   * enough: a mains hum is literally a perfect fifth and scores 0.40, and only
   * the gate — which also watches whether the loudness breathes — knows that
   * it is not a song. The 0.12 that used to sit here was a bare number that
   * happened to land just under the quietest real chord.
   */
  const believable = chord !== null && (frame?.chordScore ?? 0) >= MUSIC_CHORD_FLOOR;
  const noMusic = waiting || !believable;
  const chordLabel = chord && !noMusic ? chordName(chord) : '···';
  // Bars that keep dancing while nothing musical is being heard read as though
  // the analysis has found something. When it has not, the last musical reading
  // is held instead, so the meter stops making a claim it cannot support.
  if (frame && !noMusic) heldChroma.current = frame.chroma;
  const chroma = frame && !noMusic ? frame.chroma : heldChroma.current;
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
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--track)" strokeWidth="6" />
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
          <div className={`listen-chord${nameSize(chordLabel)}`}>{chordLabel}</div>
          <div className="listen-chord-sub">{t.hearingNow}</div>
        </div>
      </div>

      <div className="listen-meter">
        <div className={`chroma-bars${noMusic ? ' still' : ''}`} aria-hidden="true">
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
        {/* Covers the meter it contradicts and nothing else: the controls below
            stay reachable, and it never takes a pointer event of its own. */}
        {noMusic ? (
          <div className="listen-nomusic" role="status">
            {t.noMusicDetected}
          </div>
        ) : null}
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

      {/* Two ways out, deliberately unalike. Throwing the take away is a red,
          filled button that only exists while there is something to throw away;
          leaving the screen is a quiet one that is always in the same place. */}
      <div className="listen-exits">
        {waiting ? null : (
          <button className="btn btn-discard" onClick={discard} disabled={stopping}>
            <TrashIcon size={16} />
            {t.discardTake}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onCancel}>
          <BackIcon size={16} />
          {t.backHome}
        </button>
      </div>

      <ul className="tip-list card" style={{ maxWidth: 460 }}>
        {t.recordingTips.map((tip, index) => (
          <li key={index}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}
