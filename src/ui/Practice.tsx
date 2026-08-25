import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Metronome, ClockTransport, MediaTransport, type Transport } from '../audio/player';
import { resumeAudio } from '../audio/context';
import { translateKeyName, useLanguage, useT } from '../i18n';
import { enterImmersive, exitImmersive } from './immersive';
import { pluckStringOf } from '../music/pick';
import type { AnalysisResult } from '../core/analyze';
import { eventIndexAt, type SongTab } from '../music/tab';
import { TabSettings } from './TabSettings';
import type { ArrangedSong, TabOptions } from './tabOptions';
import { ChordDiagram } from './ChordDiagram';
import {
  BackIcon,
  LoopIcon,
  MetronomeIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SlidersIcon,
  CloseIcon,
  SkipBackIcon,
  SkipForwardIcon,
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
  analysis: AnalysisResult;
  song: ArrangedSong;
  options: TabOptions;
  onOptionsChange: (options: TabOptions) => void;
  onRetempo?: (bpm: number) => void;
  busy?: boolean;
  title: string;
  beats: number[];
  barPhase: number;
  audio?: Blob;
  onExit: () => void;
}

const PLAYHEAD_FRACTION = 0.26;

/** How far the skip buttons jump. Short enough to land on the bar you meant:
    at 96 BPM ten seconds is four bars away, which is a search rather than a
    nudge. The number reaches the buttons, their labels and their icons from
    here, so they cannot drift apart. */
const SKIP_SECONDS = 5;

export function Practice({
  analysis,
  song,
  options,
  onOptionsChange,
  onRetempo,
  busy,
  title,
  beats,
  barPhase,
  audio,
  onExit,
}: PracticeProps) {
  const tab = song.tab;
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
  // -1 until the first chord arrives; see findEventIndex.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [beatIndex, setBeatIndex] = useState(0);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(null);
  const [portrait, setPortrait] = useState(false);
  /** Upright and tall enough for the lane to draw shapes as well as names. */
  const [roomy, setRoomy] = useState(false);
  const [laneWidth, setLaneWidth] = useState(800);
  const [laneHeight, setLaneHeight] = useState(200);
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

  /**
   * The scale the lane is currently drawn at, readable from inside a frame.
   *
   * The chord blocks are laid out by React at `startTime * pxPerSecond`, while
   * the lane is slid under the playhead by an animation frame writing a
   * transform straight to the DOM. Both have to use the same scale or the line
   * lands on the wrong chord — and they stop agreeing the moment the lane
   * changes width, because the frame was holding whatever the scale was when
   * its effect last ran. A phone does that in the middle of playing: rotating
   * it, or its address bar collapsing, resizes the lane under a running loop.
   * Reading through a ref means the frame always uses the scale the blocks were
   * actually drawn with.
   */
  const scaleRef = useRef({ laneWidth, pxPerSecond });
  scaleRef.current = { laneWidth, pxPerSecond };

  /**
   * Move the lane in the same commit that moves the blocks.
   *
   * React lays the blocks out at the new scale as soon as it renders, but the
   * lane's own offset is written by an animation frame, which does not run
   * until after. For that one frame the blocks have moved and the lane has not,
   * and the line sits over the wrong chord — briefly, but a screenshot is one
   * frame. Writing it here, before the browser paints, means there is no frame
   * where the two disagree.
   */
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const transport = transportRef.current;
    if (!inner) return;
    const time = transport?.currentTime ?? 0;
    inner.style.transform = `translate3d(${laneWidth * PLAYHEAD_FRACTION - time * pxPerSecond}px, 0, 0)`;
  }, [laneWidth, pxPerSecond]);

  const events = tab.events;
  const duration = tab.duration;

  useEffect(() => {
    // Two questions, because the upright layout answers them separately: which
    // way up the screen is, and whether it is tall enough to spend height on
    // the lookahead as well as on the chord in hand.
    const media = matchMedia('(orientation: portrait)');
    const roomy = matchMedia('(orientation: portrait) and (min-height: 701px)');
    const update = (): void => {
      setPortrait(media.matches);
      setRoomy(roomy.matches);
    };
    update();
    media.addEventListener('change', update);
    roomy.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      roomy.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const element = laneRef.current;
    if (!element) return;
    const measure = (): void => {
      setLaneWidth(element.clientWidth);
      setLaneHeight(element.clientHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // The full screen is taken from inside the tap that opened this one (see
  // immersive.ts — it is only granted while the gesture is live). This is the
  // second attempt, for the paths that arrive here without one, and the cleanup
  // that hands the screen back either way.
  useEffect(() => {
    void enterImmersive();
    return exitImmersive;
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

  // The rule itself lives in the tab model, where a test can reach it.
  const findEventIndex = useCallback((time: number): number => eventIndexAt(events, time), [events]);

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
        const scale = scaleRef.current;
        const offset = scale.laneWidth * PLAYHEAD_FRACTION - time * scale.pxPerSecond;
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
    // Not keyed on the lane's size: the frame reads that through scaleRef, so a
    // resize no longer restarts the loop — it just draws at the new scale.
  }, [beats, findEventIndex, loopRange, playing]);

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

  /**
   * The arrangement sheet.
   *
   * Deciding the strum is wrong is something that happens *while* playing along,
   * not before; until now that cost a trip back to the tab screen. Opening it
   * pauses, because the tab under it is about to be rebuilt and a playhead
   * running over a chart that changes shape underneath it is disorienting.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = (): void => {
    const transport = transportRef.current;
    if (transport?.playing || countIn !== null) {
      countInToken.current++;
      transport?.pause();
      setCountIn(null);
      setPlaying(false);
    }
    setSettingsOpen(true);
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

  /** How many bars the loop button covers, so the button can say so. */
  const loopBars = tab.loop?.length ?? 4;
  const active = events[activeIndex];
  // slice(0) during the run-in, so the countdown counts into the first chord
  // rather than past it to the second.
  const next = events.slice(activeIndex + 1).find((event) => event.chord);
  const beatsToNext = next ? Math.max(0, Math.round((next.startTime - position) / beatSeconds)) : null;
  const barBeat = ((beatIndex - barPhase) % tab.beatsPerBar + tab.beatsPerBar) % tab.beatsPerBar;
  const shown = scrub ?? Math.min(position, duration);
  const fillPercent = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  /**
   * The pattern as strokes that last, rather than as a row of equal boxes.
   *
   * A strum pattern is written on a grid of eighths, but the eighths a
   * pattern does not strike are not rests: the chord goes on ringing through
   * them, and the hand goes on moving through them without touching the
   * strings. So a stroke's duration runs to the next stroke — in D · D U · U
   * D U that is a quarter, an eighth, a quarter, then three eighths — and a
   * strip of identical cells says the opposite, that every stroke is worth
   * the same. Each stroke here is one cell as wide as it is long, carrying a
   * faint mark for each eighth it rings through: the hand still passing the
   * strings, no strike.
   */
  const strumSlots = useMemo(() => {
    const perBar = tab.beatsPerBar * 2;
    const struck = [...tab.strum.steps].sort((a, b) => a.beat - b.beat);
    return struck.map((step, i) => {
      const startEighth = Math.round(step.beat * 2);
      // To the next stroke, or round the bar line to the first one again.
      const nextEighth = i + 1 < struck.length ? Math.round(struck[i + 1].beat * 2) : perBar + Math.round(struck[0].beat * 2);
      return { step, startEighth, eighths: Math.max(1, nextEighth - startEighth) };
    });
  }, [tab]);
  const picking = tab.strum.kind === 'pick';
  // Which strings the thumb takes depends on the chord being played, so the
  // strip is resolved against whatever is under the playhead right now.
  const activeShape = active?.chord?.shape ?? tab.palette[0]?.shape ?? null;

  /**
   * Which lane blocks get a chord box drawn in them, and how big.
   *
   * Only upright: sideways the lane runs beside a full-size diagram of the
   * chord in hand, and a row of small copies of it beside that is noise. Only
   * the blocks on screen, and only the ones wide enough to hold a legible box —
   * a chord that lasts one beat is a sliver, and a box squeezed into it reads
   * as a smudge where the name still reads as a name.
   */
  // Sized off the lane's height, which is what actually bounds it: a block is
  // as tall as the lane and as wide as the chord is long, so width would make
  // the same chord a different size in every song.
  const laneShapeWidth = Math.round(Math.min(92, Math.max(44, (laneHeight * 0.62) / 1.18)));
  const shapeIn = (index: number, startTime: number, endTime: number): boolean =>
    roomy &&
    index >= activeIndex - 1 &&
    index <= activeIndex + 4 &&
    (endTime - startTime) * pxPerSecond >= laneShapeWidth + 14;
  const barStartTime = beats[Math.max(0, Math.min(beats.length - 1, beatIndex - barBeat))] ?? 0;
  const eighth = Math.max(
    0,
    Math.min(tab.beatsPerBar * 2 - 1, Math.floor(((position - barStartTime) / beatSeconds) * 2)),
  );
  const currentBar = Math.max(
    1,
    Math.min(tab.bars.length, Math.floor((beatIndex - barPhase) / tab.beatsPerBar) + 1),
  );

  return (
    <div className={`practice${portrait ? ' portrait' : ''}`}>
      <div className="practice-hud">
        <button className="btn btn-ghost" onClick={onExit} style={{ padding: '4px 8px' }}>
          <BackIcon size={17} /> {t.exit}
        </button>
        <strong className="practice-title">{title}</strong>
        <span className="chip">{translateKeyName(tab.key.name, lang)}</span>
        {tab.capo > 0 ? (
          <span className="chip chip-accent">{t.capoChip(tab.capo)}</span>
        ) : null}
        <span className="spacer" />
        <button
          className="btn btn-ghost practice-settings-btn"
          onClick={openSettings}
          aria-label={t.makeItFitHands}
          title={t.makeItFitHands}
        >
          <SlidersIcon size={17} />
        </button>
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
                {/* The shape, not just the name, for the handful of blocks
                    actually on screen. A name is only useful to someone who
                    already knows the chord, which is the opposite of who this
                    screen is for — and drawing every block's box instead of the
                    visible ones would put thousands of nodes in the lane of a
                    long song for the sake of five. */}
                {shapeIn(index, event.startTime, event.endTime) && event.chord ? (
                  <ChordDiagram
                    shape={event.chord.shape}
                    width={laneShapeWidth}
                    showFingers={false}
                  />
                ) : event.numeral ? (
                  <span className="lane-block-numeral">{event.numeral}</span>
                ) : null}
              </div>
            ))}
          </div>
          <div
            className="lane-playhead"
            ref={playheadRef}
            // Pixels from the same laneWidth the transform uses, not a
            // percentage of the element. A percentage moves the instant CSS
            // relays the lane out — on a rotation, or a phone's address bar
            // collapsing — while the transform is still using the width the
            // last render measured, and for those frames the line sits over a
            // chord that is not the one playing.
            style={{ left: laneWidth * PLAYHEAD_FRACTION }}
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
              className={`strum-cell${slot.step.accent ? ' accent' : ''}${
                playing && eighth >= slot.startEighth && eighth < slot.startEighth + slot.eighths
                  ? ' now'
                  : ''
              }${slot.step.pluck ? ' pluck' : ''}${slot.eighths > 1 ? ' held' : ''}`}
              style={{ flexGrow: slot.eighths }}
            >
              {slot.step.pluck && activeShape ? (
                <>
                  {/* The string is the instruction; the finger reminds you
                      which hand shape it belongs to. */}
                  <b>{pluckStringOf(slot.step.pluck, activeShape)}</b>
                  <i>{slot.step.pluck.finger}</i>
                </>
              ) : (
                slot.step.direction === 'D' ? '↓' : '↑'
              )}
              {/* The eighths it rings through: the hand passes, nothing is struck. */}
              {slot.eighths > 1 ? <em className="strum-cell-ring">{'·'.repeat(slot.eighths - 1)}</em> : null}
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
          <button
            className="transport-btn"
            onClick={() => skipBy(-SKIP_SECONDS)}
            aria-label={t.backSeconds(SKIP_SECONDS)}
          >
            <SkipBackIcon size={20} seconds={SKIP_SECONDS} />
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
            onClick={() => skipBy(SKIP_SECONDS)}
            aria-label={t.forwardSeconds(SKIP_SECONDS)}
          >
            <SkipForwardIcon size={20} seconds={SKIP_SECONDS} />
          </button>
          <button
            className="transport-btn"
            onClick={toggleLoop}
            aria-pressed={loopRange !== null}
            // The button used to say "loop this section" without ever saying how
            // long a section is; it is the song's own repeating loop where one
            // was found, and four bars where it was not.
            aria-label={loopRange ? t.loopingSection(loopBars) : t.loopSection(loopBars)}
            title={loopRange ? t.loopingSection(loopBars) : t.loopSection(loopBars)}
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

      {settingsOpen ? (
        <div
          className="practice-sheet-veil"
          role="dialog"
          aria-modal="true"
          aria-label={t.makeItFitHands}
          // Clicking the darkened area behind the sheet is the fastest way out
          // on a phone held in two hands; the sheet itself must not close it.
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="practice-sheet">
            <div className="practice-sheet-head">
              <h2>{t.makeItFitHands}</h2>
              <button
                className="btn btn-ghost"
                onClick={() => setSettingsOpen(false)}
                aria-label={t.close}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <TabSettings
              analysis={analysis}
              song={song}
              options={options}
              onOptionsChange={onOptionsChange}
              onRetempo={onRetempo}
              busy={busy}
            />
          </div>
        </div>
      ) : null}
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
