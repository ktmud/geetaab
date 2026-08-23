import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Metronome, ClockTransport, MediaTransport, type Transport } from '../audio/player';
import { resumeAudio } from '../audio/context';
import { translateKeyName, useLanguage, useT } from '../i18n';
import { pluckStringOf } from '../music/pick';
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
  SkipBackTenIcon,
  SkipForwardTenIcon,
  SpeedIcon,
  VolumeIcon,
} from './icons';

/** Versioned so a future rewrite of the hint can show itself once more. */
const HINT_SEEN_KEY = 'geetaab-practice-hint-v1';

function hintAlreadySeen(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) !== null;
  } catch {
    // Storage can be blocked; showing the hint again is the safe failure.
    return false;
  }
}

/**
 * Starting speed for a song's first practice run.
 *
 * Nobody should have to know they need the slider: when the chords come
 * quicker than a learner can re-finger — about a change every 1.6 seconds —
 * the session opens slowed just enough to make the switches possible, and the
 * slider is only there to override.
 */
function suggestedRate(tab: SongTab): number {
  const durations = tab.events
    .filter((event) => event.chord)
    .map((event) => event.endTime - event.startTime)
    .sort((a, b) => a - b);
  if (durations.length < 4) return 1;
  const median = durations[durations.length >> 1];
  if (median >= 1.6) return 1;
  return Math.max(0.7, Math.ceil((median / 1.6) * 20) / 20);
}

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
  const t = useT();
  const [lang] = useLanguage();
  const laneRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const transportRef = useRef<Transport | null>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const countInToken = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(() => suggestedRate(tab));
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [clickOn, setClickOn] = useState(!audio);
  const [activeIndex, setActiveIndex] = useState(0);
  const [beatIndex, setBeatIndex] = useState(0);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(null);
  const [portrait, setPortrait] = useState(false);
  const [laneWidth, setLaneWidth] = useState(800);
  const [position, setPosition] = useState(0);
  /** Position previewed under the finger while the seek bar is being dragged. */
  const [scrub, setScrub] = useState<number | null>(null);
  const seekbarRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [hintOpen, setHintOpen] = useState(() => !hintAlreadySeen());

  const dismissHint = useCallback((): void => {
    setHintOpen(false);
    try {
      localStorage.setItem(HINT_SEEN_KEY, 'seen');
    } catch {
      // Nothing to do; the hint will simply show again next time.
    }
  }, []);

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
    if (transportRef.current) transportRef.current.volume = volume;
    // The click follows the master knob so "quieter" means the whole practice
    // session, not the song alone under an unmoved metronome.
    if (metronomeRef.current) metronomeRef.current.volume = 0.35 * volume;
  }, [volume]);

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
    if (hintOpen) dismissHint();
    await resumeAudio();
    if (transport instanceof MediaTransport) await transport.whenReady();
    transport.rate = rate;
    metronomeRef.current?.reset(transport.currentTime);

    // One second per number, always. Counting at the song's tempo made the
    // wait depend on a detected BPM that can land an octave high, so a count
    // could flash past in under two seconds; and a count-in is for getting a
    // hand into position, which takes the time it takes regardless of tempo.
    const token = ++countInToken.current;
    for (let i = tab.beatsPerBar; i >= 1; i--) {
      setCountIn(i);
      await wait(1000);
      // Pausing during the count-in bumps the token; without this check the
      // count would finish in the background and start playback anyway.
      if (token !== countInToken.current || !transportRef.current) return;
    }
    setCountIn(null);
    try {
      await transport.play();
    } catch {
      // Autoplay refused (no recent gesture): stay paused rather than crash.
      return;
    }
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

  // The first visit teaches; every visit after that goes straight into the
  // count-in, still inside the click that opened the screen so autoplay
  // policies see a fresh gesture. Declared after the transport effect above,
  // so the transport exists by the time this runs.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || hintOpen || !transportRef.current) return;
    autoStarted.current = true;
    void start();
    // Mount-only by design: `start` is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restart = (): void => {
    seekTo(loopRange?.start ?? 0);
  };

  const seekTo = (time: number): void => {
    const transport = transportRef.current;
    if (!transport || duration <= 0) return;
    const target = Math.min(Math.max(0, time), duration);
    // Dragging out of the looped bars is a decision to leave them; keeping the
    // loop would snap playback straight back and make the bar feel broken.
    if (loopRange && (target < loopRange.start || target >= loopRange.end)) setLoopRange(null);
    transport.seek(target);
    metronomeRef.current?.reset(target);
    setPosition(target);
  };

  const skipBy = (delta: number): void => {
    seekTo((transportRef.current?.currentTime ?? 0) + delta);
  };

  const timeAtPointer = (clientX: number): number => {
    const el = seekbarRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return fraction * duration;
  };

  const onSeekPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbingRef.current = true;
    const time = timeAtPointer(event.clientX);
    setScrub(time);
    seekTo(time);
  };

  const onSeekPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!scrubbingRef.current) return;
    const time = timeAtPointer(event.clientX);
    setScrub(time);
    seekTo(time);
  };

  const endScrub = (): void => {
    scrubbingRef.current = false;
    setScrub(null);
  };

  const onSeekKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') skipBy(-5);
    else if (event.key === 'ArrowRight') skipBy(5);
    else if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(duration);
    else return;
    event.preventDefault();
  };

  // Refs so the one window listener always sees the current handlers.
  const toggleRef = useRef<() => void>(() => {});
  toggleRef.current = toggle;
  const skipRef = useRef<(delta: number) => void>(() => {});
  skipRef.current = skipBy;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      // Buttons handle space themselves and sliders own their arrow keys;
      // stepping in front of either would fire everything twice.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'BUTTON' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute?.('role') === 'slider')
      ) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        toggleRef.current();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        skipRef.current(-5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        skipRef.current(5);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  const shown = scrub ?? Math.min(position, duration);
  const fillPercent = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  const strumSlots = useMemo(() => {
    const slots: { label: string; step?: (typeof tab.strum.steps)[number] }[] = [];
    for (let beat = 0; beat < tab.beatsPerBar; beat += 0.5) {
      const step = tab.strum.steps.find((s) => Math.abs(s.beat - beat) < 1e-6);
      slots.push({ label: beat % 1 === 0 ? String(beat + 1) : '&', step });
    }
    return slots;
  }, [tab]);
  const picking = tab.strum.kind === 'pick';
  // Which strings the thumb takes depends on the chord being played, so the
  // strip is resolved against whatever is under the playhead right now.
  const activeShape = active?.chord?.shape ?? tab.palette[0]?.shape ?? null;
  const barStartTime = beats[Math.max(0, Math.min(beats.length - 1, beatIndex - barBeat))] ?? 0;
  const eighth = Math.max(
    0,
    Math.min(tab.beatsPerBar * 2 - 1, Math.floor(((position - barStartTime) / beatSeconds) * 2)),
  );
  const currentBar = Math.max(
    1,
    Math.min(tab.bars.length, Math.floor((beatIndex - barPhase) / tab.beatsPerBar) + 1),
  );

  if (portrait) {
    return (
      <div className="rotate-hint">
        <div>
          <RotateIcon size={68} />
          <h2>{t.turnPhoneSideways}</h2>
          <p style={{ maxWidth: 320, margin: '0 auto 18px' }}>
            {t.sidewaysNeeded}
          </p>
          <button className="btn" onClick={onExit}>
            {t.backToTab}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="practice">
      <div className="practice-hud">
        <button className="btn btn-ghost" onClick={onExit} style={{ padding: '4px 8px' }}>
          <BackIcon size={17} /> {t.exit}
        </button>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span className="chip">{translateKeyName(tab.key.name, lang)}</span>
        {tab.capo > 0 ? (
          <span className="chip chip-accent">{t.capoChip(tab.capo)}</span>
        ) : null}
        <span className="spacer" />
        <div className="beat-dots" aria-hidden="true">
          {Array.from({ length: tab.beatsPerBar }, (_, i) => (
            <span
              key={i}
              className={`beat-dot${i === barBeat ? ' on' : ''}${i === 0 ? ' downbeat' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="practice-stage">
        <div className="practice-now">
          {active?.chord ? (
            <>
              <div className="practice-now-name">{active.chord.shapeLabel}</div>
              <ChordDiagram shape={active.chord.shape} width={150} />
              <div className="practice-now-sub">
                {active.chord.substitutedFrom
                  ? t.subbedFor(active.chord.label)
                  : tab.capo > 0
                    ? t.soundsAs(active.chord.label)
                    : active.numeral
                      ? t.numeralOfKey(active.numeral, translateKeyName(tab.key.name, lang))
                      : ''}
              </div>
            </>
          ) : (
            <div className="practice-now-name faint">—</div>
          )}
          <div className="practice-next">
            {next?.chord ? (
              <>
                <span className="practice-next-label">{t.next}</span>
                <ChordDiagram
                  shape={next.chord.shape}
                  width={54}
                  showFingers={false}
                  title={t.nextChord(next.chord.shapeLabel)}
                />
                <span className="practice-next-name">
                  {next.chord.shapeLabel}
                  {beatsToNext !== null && beatsToNext > 0 ? t.nextIn(beatsToNext) : ''}
                </span>
              </>
            ) : (
              <span className="practice-next-label">{t.lastChord}</span>
            )}
          </div>
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
          {hintOpen && countIn === null ? (
            <div className="practice-hint">
              <div className="practice-hint-card">
                <h3>{t.howThisWorks}</h3>
                <ul>
                  {t.practiceHints.map((hint, i) => (
                    <li key={i}>
                      {typeof hint === 'function' ? hint(tab.beatsPerBar) : hint}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary" onClick={() => void start()}>
                  {t.gotIt}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="strum-strip" aria-hidden="true">
        <span className="strum-strip-label">{picking ? t.pick : t.strum}</span>
        <div className="strum-strip-steps">
          {strumSlots.map((slot, index) => (
            <span
              key={index}
              className={`strum-cell${slot.step ? (slot.step.accent ? ' accent' : '') : ' gap'}${
                playing && index === eighth ? ' now' : ''
              }${slot.step?.pluck ? ' pluck' : ''}`}
            >
              {slot.step?.pluck && activeShape ? (
                <>
                  {/* The string is the instruction; the finger reminds you
                      which hand shape it belongs to. */}
                  <b>{pluckStringOf(slot.step.pluck, activeShape)}</b>
                  <i>{slot.step.pluck.finger}</i>
                </>
              ) : slot.step ? (
                slot.step.direction === 'D' ? (
                  '↓'
                ) : (
                  '↑'
                )
              ) : (
                '·'
              )}
            </span>
          ))}
        </div>
        <span className="strum-strip-bar mono">
          {t.barOf(currentBar, tab.bars.length)}
        </span>
      </div>

      <div className="practice-dock">
        <div className="seek-row">
          <span className="seek-time mono">{formatTime(shown)}</span>
          <div
            className="seekbar"
            ref={seekbarRef}
            role="slider"
            tabIndex={0}
            aria-label={t.songPosition}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shown)}
            aria-valuetext={t.seekPosition(formatTime(shown), formatTime(duration))}
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onKeyDown={onSeekKeyDown}
          >
            <div className="seekbar-track">
              {loopRange && duration > 0 ? (
                <div
                  className="seekbar-loop"
                  style={{
                    left: `${(loopRange.start / duration) * 100}%`,
                    width: `${((loopRange.end - loopRange.start) / duration) * 100}%`,
                  }}
                />
              ) : null}
              <div className="seekbar-fill" style={{ width: `${fillPercent}%` }} />
            </div>
            <div className="seekbar-handle" style={{ left: `${fillPercent}%` }} />
          </div>
          <span className="seek-time mono">{formatTime(duration)}</span>
        </div>

        <div className="dock-row">
          <button className="transport-btn" onClick={restart} aria-label={t.backStart}>
            <RewindIcon size={19} />
          </button>
          <button className="transport-btn" onClick={() => skipBy(-10)} aria-label={t.backTenSeconds}>
            <SkipBackTenIcon size={20} />
          </button>
          <button
            className="transport-btn primary"
            onClick={toggle}
            aria-label={playing ? t.pause : t.play}
          >
            {playing || countIn !== null ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </button>
          <button
            className="transport-btn"
            onClick={() => skipBy(10)}
            aria-label={t.forwardTenSeconds}
          >
            <SkipForwardTenIcon size={20} />
          </button>
          <button
            className="transport-btn"
            onClick={toggleLoop}
            aria-pressed={loopRange !== null}
            aria-label={t.loopSection}
            style={loopRange ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            <LoopIcon size={19} />
          </button>
          <button
            className="transport-btn"
            onClick={() => setClickOn((on) => !on)}
            aria-pressed={clickOn}
            aria-label={t.metronome}
            style={clickOn ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            <MetronomeIcon size={19} />
          </button>

          <span className="spacer" />

          <div className="speed-control" title={t.practiceSpeed}>
            <SpeedIcon size={15} />
            <span className="ctl-label">{t.speedLabel}</span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
              aria-label={t.practiceSpeed}
            />
            <span className="speed-value">{Math.round(rate * 100)}%</span>
          </div>

          <div className="volume-wrap">
            <button
              className="transport-btn sm"
              onClick={() => setVolumeOpen((open) => !open)}
              aria-expanded={volumeOpen}
              aria-label={t.volume}
              style={volumeOpen ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              <VolumeIcon size={17} />
            </button>
            {volumeOpen ? (
              <div className="volume-pop">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  aria-label={t.playbackVolume}
                />
                <span className="volume-value mono">{Math.round(volume * 100)}%</span>
              </div>
            ) : null}
          </div>

          <span className="chip">{Math.round(tab.tempo * rate)} BPM</span>
        </div>
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
