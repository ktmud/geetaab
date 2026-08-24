import { useEffect, useRef, useState } from 'react';
import { METRICS, stringY, type EngravedSystem } from '../music/tabEngrave';
import type { ChordShape } from '../music/shapes';

/**
 * One system of engraved tablature, laid out the way a printed songbook does it.
 *
 * The layout arrives already solved (see `music/tabEngrave.ts`); this only turns
 * it into shapes. Three details are what make a drawn tab readable where a
 * monospace one is not:
 *
 * A chord is announced by its name *and its box*, above the staff, once where it
 * starts. The box is the thing a beginner actually reads — a name on its own
 * sends them hunting through a chord chart on another page.
 *
 * The string lines are continuous and the fret numbers sit *on* them, in a small
 * opaque gap punched out of the line, which is how engravers have always done it
 * and why a two-digit fret does not push its neighbours out of line.
 *
 * Everything is drawn in the layout's own units and scaled by the viewBox, so
 * the same system fits a phone, a desktop column and a sheet of A4 without any
 * of them being a special case.
 */

/** Geometry of the little chord box over the staff, in staff units. */
const BOX_STRINGS = 6;
const BOX_ROWS = 4;
const BOX_DX = 4.2;
const BOX_W = BOX_DX * (BOX_STRINGS - 1);
const BOX_DY = 5.1;
/** The o / x row above the nut. */
const BOX_MARKS = 5;

/**
 * A chord box small enough to sit over a bar without crowding it.
 *
 * Deliberately not the `ChordDiagram` component: that one is sized in pixels for
 * a card and carries finger numbers and a title, none of which survives being
 * shrunk to twenty units wide. What is left at this size is the part that still
 * reads — which strings are stopped, where, and which are not played at all.
 */
function ChordBox({ shape, x, top }: { shape: ChordShape; x: number; top: number }) {
  const fretted = shape.frets.filter((f) => f > 0);
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  const minFret = fretted.length ? Math.min(...fretted) : 0;
  const baseFret = maxFret <= BOX_ROWS ? 1 : minFret;
  const openNut = baseFret === 1;
  const gridTop = top + BOX_MARKS;

  const stringX = (index: number): number => x + index * BOX_DX;
  const dotY = (fret: number): number => gridTop + (fret - baseFret + 0.5) * BOX_DY;
  const dotR = 1.7;

  return (
    <g className="tab-box">
      {Array.from({ length: BOX_ROWS + 1 }, (_, row) => (
        <line
          key={`f${row}`}
          className={row === 0 && openNut ? 'tab-box-nut' : 'tab-box-line'}
          x1={x}
          x2={x + BOX_W}
          y1={gridTop + row * BOX_DY}
          y2={gridTop + row * BOX_DY}
        />
      ))}
      {Array.from({ length: BOX_STRINGS }, (_, index) => (
        <line
          key={`s${index}`}
          className="tab-box-line"
          x1={stringX(index)}
          x2={stringX(index)}
          y1={gridTop}
          y2={gridTop + BOX_ROWS * BOX_DY}
        />
      ))}

      {!openNut ? (
        <text
          className="tab-box-fret"
          x={x - 1.6}
          y={dotY(baseFret)}
          textAnchor="end"
          dominantBaseline="central"
        >
          {baseFret}
        </text>
      ) : null}

      {/* Open and muted strings, marked above the nut as a songbook marks them. */}
      {shape.frets.map((fret, index) =>
        fret === 0 ? (
          <circle key={`o${index}`} className="tab-box-open" cx={stringX(index)} cy={top + 2} r={1.25} />
        ) : fret < 0 ? (
          <g key={`x${index}`} className="tab-box-mute">
            <line x1={stringX(index) - 1.2} y1={top + 0.8} x2={stringX(index) + 1.2} y2={top + 3.2} />
            <line x1={stringX(index) - 1.2} y1={top + 3.2} x2={stringX(index) + 1.2} y2={top + 0.8} />
          </g>
        ) : null,
      )}

      {shape.barre ? (
        <rect
          className="tab-box-dot"
          x={stringX(shape.barre.from) - dotR}
          y={dotY(shape.barre.fret) - dotR}
          width={stringX(shape.barre.to) - stringX(shape.barre.from) + dotR * 2}
          height={dotR * 2}
          rx={dotR}
        />
      ) : null}

      {shape.frets.map((fret, index) => {
        if (fret <= 0) return null;
        const inBarre =
          shape.barre &&
          fret === shape.barre.fret &&
          index >= shape.barre.from &&
          index <= shape.barre.to;
        if (inBarre) return null;
        return (
          <circle key={`d${index}`} className="tab-box-dot" cx={stringX(index)} cy={dotY(fret)} r={dotR} />
        );
      })}
    </g>
  );
}

/**
 * Screen pixels per staff unit.
 *
 * The drawing has to be pinned to a real size rather than left to fill its
 * container: a 7-unit fret number is legible at about twelve pixels and
 * illegible at seven, and a system that stretches to whatever width it is given
 * lands wherever the layout happens to put it. Pinning the scale here and
 * letting the number of bars on a line vary instead is the way round that keeps
 * the type the same size in every song.
 */
const SCREEN_SCALE = 1.7;

export interface TabStaffProps {
  system: EngravedSystem;
  /** Read out to a screen reader, which cannot make anything of the drawing. */
  label: string;
  className?: string;
  /** Pixels per staff unit; paper can carry finer type than a screen. */
  scale?: number;
}

export function TabStaff({ system, label, className, scale = SCREEN_SCALE }: TabStaffProps) {
  const { stringGap, staffHeight, headHeight, footHeight, clefWidth, nameHeight } = METRICS;
  const top = headHeight;
  const height = headHeight + staffHeight + footHeight;
  const right = system.width;
  // "TAB" set down the left of the staff, the way printed tablature marks itself.
  const clef = ['T', 'A', 'B'];

  return (
    <svg
      className={`tab-staff${className ? ` ${className}` : ''}`}
      style={{ maxWidth: `${Math.round(right * scale)}px` }}
      viewBox={`0 0 ${right} ${height}`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={label}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <line
          key={i}
          className="tab-staff-string"
          x1={clefWidth}
          x2={system.contentWidth}
          y1={top + i * stringGap}
          y2={top + i * stringGap}
        />
      ))}

      {clef.map((letter, i) => (
        <text
          key={letter}
          className="tab-staff-clef"
          x={clefWidth - 5}
          y={top + staffHeight / 2 + (i - 1) * (staffHeight / 3.2)}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {letter}
        </text>
      ))}

      {system.bars.map((bar) => (
        <line
          key={`bar-${bar.index}`}
          className="tab-staff-barline"
          x1={bar.x}
          x2={bar.x}
          y1={top}
          y2={top + staffHeight}
        />
      ))}
      <line
        className="tab-staff-barline end"
        x1={system.contentWidth}
        x2={system.contentWidth}
        y1={top}
        y2={top + staffHeight}
      />

      {/* The bar the system opens on, tucked over the staff at the left. */}
      <text className="tab-staff-barnum" x={system.bars[0].x + 2} y={top - 3.5}>
        {system.bars[0].index + 1}
      </text>

      {system.bars.map((bar) => (
        <g key={bar.index}>
          {bar.names.map((name, i) => {
            // A name that opens a bar is set from the bar line; one mid-bar is
            // centred on the change. The box follows whichever the name did.
            const boxX = name.anchor === 'start' ? name.x : name.x - BOX_W / 2;
            return (
              <g key={i}>
                <text className="tab-staff-name" x={boxX} y={nameHeight - 3}>
                  {name.label}
                </text>
                {name.shape ? <ChordBox shape={name.shape} x={boxX} top={nameHeight} /> : null}
              </g>
            );
          })}

          {bar.columns.map((column, i) => (
            <g key={i} className={column.accent ? 'tab-staff-col accent' : 'tab-staff-col'}>
              {column.notes.map((note) => (
                <g key={note.string}>
                  {/* Punch the line out behind the number so it reads cleanly. */}
                  <rect
                    className="tab-staff-knockout"
                    x={column.x - 4.6}
                    y={top + stringY(note.string) - 3.6}
                    width={9.2}
                    height={7.2}
                  />
                  <text
                    className={note.fret < 0 ? 'tab-staff-fret muted' : 'tab-staff-fret'}
                    data-string={note.string}
                    x={column.x}
                    y={top + stringY(note.string)}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {note.fret < 0 ? 'x' : note.fret}
                  </text>
                </g>
              ))}

              {/* Under the staff: which way the hand moves, or which finger. */}
              {column.finger ? (
                <text
                  className="tab-staff-finger"
                  x={column.x}
                  y={top + staffHeight + 11}
                  textAnchor="middle"
                >
                  {column.finger}
                </text>
              ) : (
                <text
                  className="tab-staff-stroke"
                  x={column.x}
                  y={top + staffHeight + 12}
                  textAnchor="middle"
                >
                  {column.direction === 'D' ? '↓' : '↑'}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * One system, drawn once it is nearly on screen.
 *
 * A five-minute song engraves to thirty-one systems and seventeen thousand SVG
 * nodes, all of them built in the commit that first shows the tab — about a
 * second of frozen page on a phone, for thirty systems nobody is looking at
 * yet. A phone shows two at a time.
 *
 * The placeholder is not a guess: the staff is an SVG with a viewBox and a
 * capped width, so its height is its width over its own ratio, and giving the
 * box the same ratio and the same cap reserves exactly the space the drawing
 * will take. Nothing moves when it arrives, which is what makes this safe to do
 * under a reader's thumb rather than only at the foot of the page.
 *
 * Once drawn it stays drawn. Scrolling back through a song you are learning is
 * normal, and rebuilding a system every time it crosses the edge of the screen
 * would cost more than it saves.
 */
export function LazyTabStaff(props: TabStaffProps) {
  const [drawn, setDrawn] = useState(false);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (drawn) return;
    const element = slot.current;
    // No observer (or no element yet): draw it rather than leave a gap.
    if (!element || typeof IntersectionObserver === 'undefined') {
      setDrawn(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setDrawn(true);
      },
      // A screen ahead, so a system is ready before it is needed rather than
      // arriving into view.
      { rootMargin: '900px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawn]);

  if (drawn) return <TabStaff {...props} />;

  const { headHeight, staffHeight, footHeight } = METRICS;
  const height = headHeight + staffHeight + footHeight;
  const scale = props.scale ?? SCREEN_SCALE;
  return (
    <div
      ref={slot}
      aria-hidden="true"
      style={{
        maxWidth: `${Math.round(props.system.width * scale)}px`,
        aspectRatio: `${props.system.width} / ${height}`,
      }}
    />
  );
}
