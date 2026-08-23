import type { ChordShape } from '../music/shapes';

const STRINGS = 6;

export interface ChordDiagramProps {
  shape: ChordShape;
  width?: number;
  /** Draw the fretting-hand finger numbers inside the dots. */
  showFingers?: boolean;
  title?: string;
}

/**
 * A standard chord box.
 *
 * Low E is on the left, as it is in every songbook: a diagram that mirrors the
 * convention is worse than no diagram, because the player will not notice.
 */
export function ChordDiagram({ shape, width = 92, showFingers = true, title }: ChordDiagramProps) {
  const fretted = shape.frets.filter((f) => f > 0);
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  const minFret = fretted.length ? Math.min(...fretted) : 0;
  // Open shapes get the four-fret box a songbook prints; only stretched or
  // moved-up shapes need a fifth row, and an empty row wastes the space that
  // makes the dots readable at a glance.
  const fretRows = maxFret <= 3 ? 4 : 5;
  const baseFret = maxFret <= fretRows - 1 ? 1 : minFret;

  const height = Math.round(width * 1.18);
  const left = width * 0.16;
  const right = width * 0.09;
  const top = height * 0.2;
  const bottom = height * 0.07;
  const gridW = width - left - right;
  const gridH = height - top - bottom;
  const dx = gridW / (STRINGS - 1);
  const dy = gridH / fretRows;

  const stringX = (index: number): number => left + index * dx;
  const fretY = (fret: number): number => top + (fret - baseFret + 1) * dy;
  const dotY = (fret: number): number => fretY(fret) - dy / 2;
  const dotR = Math.min(dx, dy) * 0.4;

  const openNut = baseFret === 1;

  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={title ?? 'Chord diagram'}
    >
      {title ? <title>{title}</title> : null}

      {Array.from({ length: fretRows + 1 }, (_, row) => (
        <line
          key={`fret-${row}`}
          x1={left}
          x2={left + gridW}
          y1={top + row * dy}
          y2={top + row * dy}
          stroke={row === 0 && openNut ? 'var(--text)' : 'var(--line)'}
          strokeWidth={row === 0 && openNut ? 3.2 : 1}
          strokeLinecap="round"
        />
      ))}

      {Array.from({ length: STRINGS }, (_, index) => (
        <line
          key={`string-${index}`}
          x1={stringX(index)}
          x2={stringX(index)}
          y1={top}
          y2={top + gridH}
          stroke="var(--line)"
          strokeWidth={1}
        />
      ))}

      {!openNut ? (
        <text
          x={left - dx * 0.45}
          y={dotY(baseFret) + dotR * 0.4}
          fontSize={width * 0.13}
          fill="var(--text-faint)"
          textAnchor="end"
          fontFamily="var(--mono)"
        >
          {baseFret}
        </text>
      ) : null}

      {shape.frets.map((fret, index) => {
        if (fret > 0) return null;
        const x = stringX(index);
        const y = top - height * 0.055;
        if (fret === 0) {
          return (
            <circle
              key={`open-${index}`}
              cx={x}
              cy={y}
              r={dotR * 0.55}
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth={1.4}
            />
          );
        }
        const s = dotR * 0.5;
        return (
          <g key={`mute-${index}`} stroke="var(--text-faint)" strokeWidth={1.5} strokeLinecap="round">
            <line x1={x - s} y1={y - s} x2={x + s} y2={y + s} />
            <line x1={x - s} y1={y + s} x2={x + s} y2={y - s} />
          </g>
        );
      })}

      {shape.barre ? (
        <rect
          x={stringX(shape.barre.from) - dotR}
          y={dotY(shape.barre.fret) - dotR}
          width={stringX(shape.barre.to) - stringX(shape.barre.from) + dotR * 2}
          height={dotR * 2}
          rx={dotR}
          fill="var(--accent)"
        />
      ) : null}

      {shape.frets.map((fret, index) => {
        if (fret <= 0) return null;
        if (shape.barre && fret === shape.barre.fret && index >= shape.barre.from && index <= shape.barre.to) {
          return null;
        }
        return (
          <circle
            key={`dot-${index}`}
            cx={stringX(index)}
            cy={dotY(fret)}
            r={dotR}
            fill="var(--accent)"
          />
        );
      })}

      {showFingers
        ? shape.frets.map((fret, index) => {
            const finger = shape.fingers[index];
            if (fret <= 0 || !finger) return null;
            return (
              <text
                key={`finger-${index}`}
                x={stringX(index)}
                y={dotY(fret) + dotR * 0.62}
                fontSize={dotR * 1.5}
                fontWeight={700}
                fill="#21160a"
                textAnchor="middle"
              >
                {finger}
              </text>
            );
          })
        : null}
    </svg>
  );
}

export interface ChordCardProps {
  shape: ChordShape;
  name: string;
  sub?: string;
  width?: number;
}

export function ChordCard({ shape, name, sub, width = 92 }: ChordCardProps) {
  return (
    <div className="diagram-card">
      <div className="diagram-name">{name}</div>
      <ChordDiagram shape={shape} width={width} title={`${name} chord diagram`} />
      {sub ? <div className="diagram-sub">{sub}</div> : null}
    </div>
  );
}
