import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Metronome, ClockTransport, MediaTransport, type Transport } from '../audio/player';
import { resumeAudio } from '../audio/context';
import type { SongTab } from '../music/tab';
import { ChordDiagram } from './ChordDiagram';
import {
  BackIcon,
  LoopIcon,
  MetronomeIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  RotateIcon,
} from './icons';

export interface PracticeProps {
  tab: SongTab;
  title: string;
  beats: number[];
  barPhase: number;
  audio?: Blob;
  onExit: () => void;
}

const PLAYHEAD_FRACTION = 0.26;

export function Practice({ tab, title, beats, barPhase, audio, onExit }: PracticeProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const transportRef = useRef<Transport | null>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const countInToken = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [clickOn, setClickOn] = useState(!audio);
  const [activeIndex, setActiveIndex] = useState(0);
  const [beatIndex, setBeatIndex] = useState(0);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(null);
  const [portrait, setPortrait] = useState(false);
  const [laneWidth, setLaneWidth] = useState(800);
  const [position, setPosition] = useState(0);

  const beatSeconds = 60 / tab.tempo;
  const pxPerSecond = useMemo(() => {
    // Roughly eleven beats across the lane: enough to read two changes ahead
    // without the current chord shrinking to something you have to squint at.
    const pxPerBeat = Math.max(38, Math.min(88, laneWidth / 11));
    return pxPerBeat / beatSeconds;
  }, [laneWidth, beatSeconds]);

  const events = tab.events;
  const duration = tab.duration;

  useEffect(() => {
    const media = matchMedia('(orientation: portrait)');
    const update = (): void => setPortrait(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const element = laneRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setLaneWidth(element.clientWidth));
    observer.observe(element);
    setLaneWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Fullscreen and orientation lock are best-effort: desktop browsers refuse the
  // lock outright and iOS Safari refuses both, so neither can gate the screen.
  useEffect(() => {
    const root = document.documentElement;
    void root.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
    const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    void orientation?.lock?.('landscape').catch(() => undefined);
    return () => {
      orientation?.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const transport = audio ? new MediaTransport(audio) : new ClockTransport(duration);
    transportRef.current = transport;
    metronomeRef.current = new Metronome({
      beats,
      beatsPerBar: tab.beatsPerBar,
      barPhase,
    });
    return () => {
      transport.dispose();
      transportRef.current = null;
    };
  }, [audio, duration, beats, tab.beatsPerBar, barPhase]);

  useEffect(() => {
    if (transportRef.current) transportRef.current.rate = rate;
  }, [rate]);

  useEffect(() => {
    if (metronomeRef.current) metronomeRef.current.enabled = clickOn;
  }, [clickOn]);

  const findEventIndex = useCallback(
    (time: number): number => {
      for (let i = 0; i < events.length; i++) {
        if (time < events[i].endTime) return i;
      }
      return Math.max(0, events.length - 1);
    },
    [events],
  );

  useEffect(() => {
    let raf = 0;
    let lastEvent = -1;
    let lastBeat = -1;
    let lastPosted = -1;

    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      const transport = transportRef.current;
      if (!transport) return;
      let time = transport.currentTime;

      if (loopRange && time >= loopRange.end) {
        transport.seek(loopRange.start);
        metronomeRef.current?.reset(loopRange.start);
        time = loopRange.start;
      }

      if (innerRef.current) {
        const offset = laneWidth * PLAYHEAD_FRACTION - time * pxPerSecond;
        innerRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
      }

      if (transport.playing) {
        metronomeRef.current?.schedule(time, transport.rate);
      } else {
        // Otherwise a pause would still let the last scheduled clicks through.
        metronomeRef.current?.reset(time);
      }

      const index = findEventIndex(time);
      if (index !== lastEvent) {
        lastEvent = index;
        setActiveIndex(index);
      }
      let beat = 0;
      while (beat + 1 < beats.length && beats[beat + 1] <= time) beat++;
      if (beat !== lastBeat) {
        lastBeat = beat;
        setBeatIndex(beat);
      }
      // The lane moves via a direct transform every frame; React only needs to
      // hear about the clock often enough for the readouts to look live.
      if (Math.abs(time - lastPosted) > 0.1) {
        lastPosted = time;
        setPosition(time);
      }

      if (transport.playing !== playing) setPlaying(transport.playing);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [beats, findEventIndex, laneWidth, loopRange, playing, pxPerSecond]);

  const start = async (): Promise<void> => {
    const transport = transportRef.current;
    if (!transport) return;
    await resumeAudio();
    if (transport instanceof MediaTransport) await transport.whenReady();
    transport.rate = rate;
    metronomeRef.current?.reset(transport.currentTime);

    // Count the player in at the practice tempo, not the song's, so the click
    // they hear is the one they are about to play against.
    const token = ++countInToken.current;
    for (let i = tab.beatsPerBar; i >= 1; i--) {
      setCountIn(i);
      await wait((beatSeconds / rate) * 1000);
      // Pausing during the count-in bumps the token; without this check the
      // count would finish in the background and start playback anyway.
      if (token !== countInToken.current || !transportRef.current) return;
    }
    setCountIn(null);
    await transport.play();
    setPlaying(true);
  };

  const toggle = (): void => {
    const transport = transportRef.current;
    if (!transport) return;
    if (transport.playing || countIn !== null) {
      countInToken.current++;
      transport.pause();
      setCountIn(null);
      setPlaying(false);
    } else {
      void start();
    }
  };

  const restart = (): void => {
    const transport = transportRef.current;
    if (!transport) return;
    const target = loopRange?.start ?? 0;
    transport.seek(target);
    metronomeRef.current?.reset(target);
  };

  const toggleLoop = (): void => {
    if (loopRange) {
      setLoopRange(null);
      return;
    }
    const transport = transportRef.current;
    const time = transport?.currentTime ?? 0;
    const barsPerLoop = tab.loop?.length ?? 4;
    const bar = tab.bars.find((b) => time >= b.startTime && time < b.endTime) ?? tab.bars[0];
    if (!bar) return;
    const firstIndex = Math.floor(bar.index / barsPerLoop) * barsPerLoop;
    const first = tab.bars[firstIndex] ?? tab.bars[0];
    const last = tab.bars[Math.min(tab.bars.length - 1, firstIndex + barsPerLoop - 1)];
    setLoopRange({ start: first.startTime, end: last.endTime });
    transport?.seek(first.startTime);
    metronomeRef.current?.reset(first.startTime);
  };

  const active = events[activeIndex];
  const next = events.slice(activeIndex + 1).find((event) => event.chord);
  const beatsToNext = next ? Math.max(0, Math.round((next.startTime - position) / beatSeconds)) : null;
  const barBeat = ((beatIndex - barPhase) % tab.beatsPerBar + tab.beatsPerBar) % tab.beatsPerBar;

  if (portrait) {
    return (
      <div className="rotate-hint">
        <div>
          <RotateIcon size={68} />
          <h2>Turn your phone sideways</h2>
          <p style={{ maxWidth: 320, margin: '0 auto 18px' }}>
            Practice mode scrolls the chords past a playhead, and that needs the long edge of the
            screen.
          </p>
          <button className="btn" onClick={onExit}>
            Back to the tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="practice">
      <div className="practice-hud">
        <button className="btn btn-ghost" onClick={onExit} style={{ padding: '4px 8px' }}>
          <BackIcon size={17} /> Exit
        </button>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span className="chip">{tab.key.name}</span>
        {tab.capo > 0 ? <span className="chip chip-accent">Capo {tab.capo}</span> : null}
        <span className="spacer" />
        <div className="beat-dots" aria-hidden="true">
          {Array.from({ length: tab.beatsPerBar }, (_, i) => (
            <span
              key={i}
              className={`beat-dot${i === barBeat ? ' on' : ''}${i === 0 ? ' downbeat' : ''}`}
            />
          ))}
        </div>
        <span className="mono" style={{ fontSize: 12 }}>
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>

      <div className="practice-stage">
        <div className="practice-now">
          {active?.chord ? (
            <>
              <div className="practice-now-name">{active.chord.shapeLabel}</div>
              <ChordDiagram shape={active.chord.shape} width={150} />
              <div className="practice-now-sub">
                {active.chord.substitutedFrom
                  ? `stands in for ${active.chord.label}`
                  : tab.capo > 0
                    ? `sounds as ${active.chord.label}`
                    : active.numeral
                      ? `${active.numeral} of ${tab.key.name}`
                      : ''}
              </div>
            </>
          ) : (
            <div className="practice-now-name faint">—</div>
          )}
        </div>

        <div className="practice-lane" ref={laneRef}>
          <div className="lane-inner" ref={innerRef}>
            {beats.map((time, index) => (
              <div
                key={index}
                className={`lane-beat${((index - barPhase) % tab.beatsPerBar + tab.beatsPerBar) % tab.beatsPerBar === 0 ? ' downbeat' : ''}`}
                style={{ left: time * pxPerSecond }}
              />
            ))}
            {events.map((event, index) => (
              <div
                key={index}
                className={`lane-block${index === activeIndex ? ' active' : ''}${
                  !event.chord ? ' nc' : index === activeIndex + 1 ? ' upcoming' : ''
                }`}
                style={{
                  left: event.startTime * pxPerSecond + 2,
                  width: Math.max(24, (event.endTime - event.startTime) * pxPerSecond - 4),
                }}
              >
                <span className="lane-block-name">{event.chord?.shapeLabel ?? 'N.C.'}</span>
                {event.numeral ? <span className="lane-block-numeral">{event.numeral}</span> : null}
              </div>
            ))}
          </div>
          <div
            className="lane-playhead"
            ref={playheadRef}
            style={{ left: `${PLAYHEAD_FRACTION * 100}%` }}
          />
          {countIn !== null ? <div className="countin">{countIn}</div> : null}
        </div>
      </div>

      <div className="practice-dock">
        <button className="transport-btn" onClick={restart} aria-label="Back to the start">
          <RewindIcon size={19} />
        </button>
        <button
          className="transport-btn primary"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing || countIn !== null ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <button
          className="transport-btn"
          onClick={toggleLoop}
          aria-pressed={loopRange !== null}
          aria-label="Loop this section"
          style={loopRange ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
        >
          <LoopIcon size={19} />
        </button>
        <button
          className="transport-btn"
          onClick={() => setClickOn((on) => !on)}
          aria-pressed={clickOn}
          aria-label="Metronome"
          style={clickOn ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
        >
          <MetronomeIcon size={19} />
        </button>

        <div className="speed-control">
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
            aria-label="Practice speed"
          />
          <span className="speed-value">{Math.round(rate * 100)}%</span>
        </div>

        <span className="chip">
          {next && beatsToNext !== null
            ? `${next.chord?.shapeLabel} in ${beatsToNext}`
            : `${Math.round(tab.tempo * rate)} BPM`}
        </span>
      </div>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
