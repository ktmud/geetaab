import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '../i18n';
import { BackIcon } from './icons';

export interface HowItWorksProps {
  onBack: () => void;
}

/**
 * The colour story is the point of this page, so it is worth naming: the cool
 * token means "raw measurement, nothing decided yet" and the brass token means
 * "the app has committed to an answer". The spine down the left crosses from
 * one to the other at stage 5, where per-frame guesses become a path the app is
 * willing to print. Every diagram obeys the same rule, and every colour comes
 * from the app's own accent tokens through .hw-raw / .hw-decided — no hex here.
 */
type Tone = 'raw' | 'decided';

/** x, y, height, opacity — the shorthand every bar chart below is written in. */
type Bar = [number, number, number, number];

const STAGE_COUNT = 9;
/** The index at which measurement turns into a decision. */
const DECISION_STEP = 5;

const CHROMA_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const PATH_NODES = [30, 90, 150, 210, 270, 330, 390, 450, 510];
/**
 * The three jobs the nine stages divide into, in order.
 *
 * The boundary between measuring and deciding is the same one the stage cards
 * already draw — nothing is committed to until the frame-by-frame flicker is
 * smoothed — and the third job is where a committed answer stops describing
 * the recording and starts describing what a beginner's hands should do.
 */
const PATH_SEGMENTS = [
  'measure',
  'measure',
  'measure',
  'measure',
  'decide',
  'decide',
  'decide',
  'hands',
  'hands',
] as const;
const SEGMENT_FILL = { measure: 'hw-raw', decide: 'hw-decided', hands: 'hw-hands' } as const;
const PATH_ARROWS: [number, number][] = [
  [38, 82],
  [98, 142],
  [158, 202],
  [218, 262],
  [278, 322],
  [338, 382],
  [398, 442],
  [458, 502],
  [518, 602],
];

/** Which of the five gate checks each kind of sound passes. */
const GATE_ROWS: boolean[][] = [
  [true, true, true, true, true],
  [true, false, true, true, false],
  [true, true, false, true, false],
  [true, true, true, false, false],
];

const SPECTRUM_BARS: Bar[] = [
  [310, 120, 25, 0.3],
  [320, 110, 35, 0.3],
  [330, 95, 50, 1],
  [340, 115, 30, 0.3],
  [350, 105, 40, 1],
  [360, 120, 25, 0.3],
  [370, 100, 45, 1],
  [380, 125, 20, 0.3],
  [390, 130, 15, 0.3],
];

const CHROMA_BINS: Bar[] = [
  [50, 100, 50, 0.6],
  [85, 120, 30, 0.3],
  [120, 125, 25, 0.3],
  [155, 122, 28, 0.3],
  [190, 108, 42, 0.5],
  [225, 130, 20, 0.3],
  [260, 128, 22, 0.3],
  [295, 115, 35, 0.4],
  [330, 120, 30, 0.3],
  [365, 110, 40, 0.5],
  [400, 125, 25, 0.3],
  [435, 122, 28, 0.3],
];

const MEASURED_BARS: Bar[] = [
  [40, 45, 40, 0.5],
  [62, 50, 35, 0.4],
  [84, 55, 30, 0.3],
  [106, 52, 33, 0.3],
  [128, 40, 45, 0.5],
  [150, 58, 27, 0.2],
  [172, 56, 29, 0.2],
  [194, 48, 37, 0.4],
  [216, 54, 31, 0.3],
  [238, 42, 43, 0.5],
  [260, 56, 29, 0.2],
  [282, 54, 31, 0.3],
];

const TEMPLATE_MAJ: Bar[] = [
  [40, 150, 20, 0.3],
  [62, 155, 15, 0.2],
  [84, 160, 10, 0.1],
  [106, 156, 14, 0.1],
  [128, 145, 25, 0.4],
  [150, 162, 8, 0.1],
  [172, 161, 9, 0.1],
  [194, 152, 18, 0.3],
  [216, 160, 10, 0.1],
  [238, 146, 24, 0.4],
  [260, 161, 9, 0.1],
  [282, 159, 11, 0.1],
];

const TEMPLATE_MIN: Bar[] = [
  [40, 240, 20, 0.3],
  [62, 245, 15, 0.2],
  [84, 250, 10, 0.1],
  [106, 246, 14, 0.1],
  [128, 235, 25, 0.4],
  [150, 252, 8, 0.1],
  [172, 251, 9, 0.1],
  [194, 242, 18, 0.3],
  [216, 250, 10, 0.1],
  [238, 233, 27, 0.4],
  [260, 251, 9, 0.1],
  [282, 249, 11, 0.1],
];

const TEMPLATE_WINNER: Bar[] = [
  [360, 165, 25, 0.6],
  [382, 170, 20, 0.5],
  [404, 175, 15, 0.4],
  [426, 172, 18, 0.4],
  [448, 160, 30, 0.6],
  [470, 178, 12, 0.3],
  [492, 177, 13, 0.3],
  [514, 168, 22, 0.5],
  [536, 176, 14, 0.3],
];

/**
 * Where each raw per-frame guess landed, and what it was called. The row label
 * lives in a gutter to the left of x=150 so it can never sit on a chord name.
 */
const RAW_TICKS = [60, 75, 65, 55, 70, 60, 80, 68, 72, 62, 76, 66, 58, 74, 64, 70, 59, 77, 61, 73];
const RAW_LABELS = ['C', 'Am', 'G', 'C', 'G', 'Am', 'C', 'Am', 'G', 'C'];
const SMOOTH_PATH: [number, number, number, number][] = [
  [160, 175, 230, 175],
  [230, 175, 280, 190],
  [280, 190, 350, 190],
  [350, 190, 410, 175],
  [410, 175, 480, 175],
];
/** Each name rides 10 units above the path where it sits, flats and slopes alike. */
const SMOOTH_LABELS: [number, number, string][] = [
  [195, 165, 'C'],
  [255, 172, 'Am'],
  [315, 180, 'G'],
  [380, 172, 'C'],
  [445, 165, 'Am'],
];

const SONG_CHROMA: Bar[] = [
  [40, 50, 50, 0.6],
  [65, 45, 55, 0.5],
  [90, 60, 40, 0.3],
  [115, 55, 45, 0.4],
  [140, 40, 60, 0.7],
  [165, 65, 35, 0.3],
  [190, 70, 30, 0.2],
  [215, 50, 50, 0.5],
  [240, 60, 40, 0.3],
  [265, 35, 65, 0.7],
  [290, 65, 35, 0.3],
  [315, 58, 42, 0.4],
];

const KEY_RUNNER_UP: Bar[] = [
  [140, 200, 25, 0.3],
  [158, 200, 25, 0.3],
  [176, 205, 20, 0.3],
  [194, 203, 22, 0.3],
  [212, 198, 27, 0.3],
  [230, 208, 17, 0.2],
];

const KEY_WINNER: Bar[] = [
  [140, 245, 35, 0.6],
  [158, 248, 32, 0.5],
  [176, 255, 25, 0.3],
  [194, 250, 30, 0.4],
  [212, 242, 38, 0.7],
  [230, 258, 22, 0.3],
];

/** Bar line x, chord name, and the x the strum arrows sit on. */
const CHART_BARS: [number, string, number][] = [
  [60, 'G', 75],
  [140, 'D', 155],
  [220, 'Am', 245],
  [300, 'G', 325],
];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function Stage({
  index,
  label,
  title,
  tone,
  current,
  children,
}: {
  index: number;
  label: string;
  title?: string;
  tone: Tone;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`hw-stage${tone === 'decided' ? ' decided' : ''}${current ? ' current' : ''}`}
      data-stage={index}
    >
      <div className="hw-stage-num">{label}</div>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

function Figure({
  index,
  aria,
  caption,
  viewBox,
  revealed,
  legend,
  children,
}: {
  index: number;
  aria: string;
  caption: string;
  viewBox: string;
  revealed: boolean;
  legend?: readonly string[];
  children: ReactNode;
}) {
  // Every figure's type sizes were chosen against the prose beside them, so a
  // figure must never be drawn larger than the size it was drawn at — stretched
  // to fill a desktop card, a 13px label comes out bigger than the paragraph it
  // is explaining. Scaling down on a narrow screen is fine; scaling up is not.
  const naturalWidth = Number(viewBox.split(/\s+/)[2]) || 0;
  return (
    <figure
      className={`hw-fig${revealed ? ' is-visible' : ''}`}
      data-fig={index}
      style={naturalWidth ? ({ ['--fig-w' as string]: `${naturalWidth}px` } as CSSProperties) : undefined}
    >
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={aria}>
        {children}
      </svg>
      {legend ? (
        <ul className="hw-legend">
          {legend.map((label, i) => (
            <li key={label}>
              <span className={`hw-legend-dot ${['measure', 'decide', 'hands'][i]}`} />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/**
 * An optional layer under a stage, for the one idea in it that a curious reader
 * will stop on and everyone else should be able to walk past.
 *
 * A native <details> rather than component state: it survives printing (the
 * browser expands it), it is keyboard- and screen-reader-native, and a reader
 * using find-in-page gets it opened for them on a hit inside it. The page's job
 * is to be readable in one pass; this is the second pass, for whoever wants it.
 */
function Deeper({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="hw-deeper">
      <summary>{title}</summary>
      <div className="hw-deeper-body">{children}</div>
    </details>
  );
}

function TermList({ terms, descs }: { terms: readonly string[]; descs: readonly string[] }) {
  return (
    <ul className="hw-list">
      {terms.map((term, i) => (
        <li key={term}>
          <strong>{term}</strong>
          {descs[i]}
        </li>
      ))}
    </ul>
  );
}

function RawBars({ bars }: { bars: Bar[] }) {
  return (
    <>
      {bars.map(([x, y, h, o]) => (
        <rect key={x} x={x} y={y} width="18" height={h} className="hw-raw" opacity={o} />
      ))}
    </>
  );
}

export function HowItWorks({ onBack }: HowItWorksProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [revealed, setRevealed] = useState<boolean[]>(() => new Array(STAGE_COUNT).fill(false));

  // The link into this page lives in the footer, so the reader is usually at the
  // bottom of the previous screen when they press it. Without this they would
  // land somewhere in the middle of the explainer.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Which stage the reader is in. A tall dead band top and bottom means the
  // section crossing the middle of the viewport is the one that counts, which
  // is what a reader would say they are "in". The limits card is watched too,
  // as a marker for "past the end": without it, jumping straight to the foot of
  // the page leaves nothing in the band and the stepper would sit on whichever
  // stage happened to be last seen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const marked = Array.from(root.querySelectorAll<HTMLElement>('[data-stage]'));
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.stage);
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        if (visible.size) setActive(Math.min(Math.min(...visible), STAGE_COUNT - 1));
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    marked.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  // Reveal each diagram the first time it is scrolled to, then stop watching it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const figures = Array.from(root.querySelectorAll<HTMLElement>('.hw-fig'));
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(new Array(STAGE_COUNT).fill(true));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const hits: number[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          hits.push(Number((entry.target as HTMLElement).dataset.fig));
          observer.unobserve(entry.target);
        }
        if (!hits.length) return;
        setRevealed((prev) => {
          const next = prev.slice();
          for (const index of hits) next[index] = true;
          return next;
        });
      },
      { threshold: 0.12 },
    );
    figures.forEach((figure) => observer.observe(figure));
    return () => observer.disconnect();
  }, []);

  const goToStage = useCallback((index: number) => {
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-stage="${index}"]`);
    if (!target) return;
    // Asked for explicitly rather than left to CSS scroll-behavior, so the jump
    // still works when that is switched off for reduced motion.
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setActive(index);
  }, []);

  const progress = STAGE_COUNT > 1 ? active / (STAGE_COUNT - 1) : 1;

  return (
    <div className="shell how-it-works" ref={rootRef}>
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> {t.back}
        </button>
      </div>

      <div className="eyebrow">{t.hwEyebrow}</div>
      <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)' }}>{t.hwTitle}</h1>
      <p className="lede hw-lede">{t.hwLede}</p>

      <nav className="hw-steps" aria-label={t.hwStepsLabel}>
        <ol>
          {t.hwSteps.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                aria-label={label}
                aria-current={i === active ? 'step' : undefined}
                className={[
                  'hw-step',
                  i >= DECISION_STEP ? 'decided' : '',
                  i <= active ? 'reached' : '',
                  i === active ? 'current' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => goToStage(i)}
              >
                <span className="hw-step-dot" aria-hidden="true" />
                <span className="hw-step-label">{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="hw-path" style={{ ['--hw-progress' as string]: progress } as CSSProperties}>
        {/* ---------- overview ---------- */}
        <Stage index={0} label={t.hwOverview} tone="raw" current={active === 0}>
          <Figure
            index={0}
            revealed={revealed[0]}
            aria={t.hwOverviewAria}
            caption={t.hwOverviewCaption}
            viewBox="0 0 640 120"
            legend={t.hwLegend}
          >
            <defs>
              <marker
                id="hw-arrow-path"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="currentColor" />
              </marker>
            </defs>

            {PATH_NODES.map((cx, i) => (
              <circle
                key={cx}
                cx={cx}
                cy="60"
                r="8"
                className={SEGMENT_FILL[PATH_SEGMENTS[i]]}
                stroke="currentColor"
                strokeWidth="2"
              />
            ))}
            <circle
              cx="610"
              cy="60"
              r="8"
              className="hw-hands"
              stroke="currentColor"
              strokeWidth="2"
            />

            {PATH_ARROWS.map(([x1, x2]) => (
              <line
                key={x1}
                x1={x1}
                y1="60"
                x2={x2}
                y2="60"
                stroke="currentColor"
                strokeWidth="1.5"
                markerEnd="url(#hw-arrow-path)"
              />
            ))}

            {PATH_NODES.map((cx, i) => (
              <text key={cx} x={cx} y="85" textAnchor="middle" className="hw-mono">
                {i + 1}
              </text>
            ))}
            {PATH_NODES.map((cx, i) => (
              <text key={cx} x={cx} y="108" textAnchor="middle" className="hw-note">
                {t.hwNodes[i]}
              </text>
            ))}
          </Figure>
        </Stage>

        {/* ---------- stage 1: the music gate ---------- */}
        <Stage
          index={1}
          label={t.hwStageLabel(1)}
          title={t.hwS1Title}
          tone="raw"
          current={active === 1}
        >
          <p>{t.hwS1P1}</p>
          <p>{t.hwS1P2}</p>
          <TermList terms={t.hwS1Terms} descs={t.hwS1Descs} />
          <p>
            {t.hwS1P3a}
            <em>{t.hwS1P3Em}</em>
            {t.hwS1P3b}
          </p>
          <Figure
            index={1}
            revealed={revealed[1]}
            aria={t.hwS1Aria}
            caption={t.hwS1Caption}
            viewBox="12 5 366 251"
          >
            {t.hwS1Cols.map((col, i) => (
              <text key={col} x={100 + i * 60} y="25" className="hw-mono" textAnchor="middle">
                {col}
              </text>
            ))}

            {/* A filled brass dot is a pass — a decided "yes". A hollow cool
                ring is the raw measurement that never cleared the bar. */}
            {GATE_ROWS.map((row, r) => (
              <g key={r}>
                <text x="20" y={80 + r * 55} fontWeight="500">
                  {t.hwS1Rows[r]}
                </text>
                {row.map((pass, c) =>
                  pass ? (
                    <circle
                      key={c}
                      cx={100 + c * 60}
                      cy={70 + r * 55}
                      r="6"
                      className="hw-decided"
                    />
                  ) : (
                    <circle
                      key={c}
                      cx={100 + c * 60}
                      cy={70 + r * 55}
                      r="7"
                      strokeWidth="2"
                      fill="none"
                      className="hw-raw-s"
                    />
                  ),
                )}
                <line x1="20" y1={50 + r * 55} x2="370" y2={50 + r * 55} className="hw-rule" />
              </g>
            ))}
          </Figure>
        </Stage>

        {/* ---------- stage 2: the FFT ---------- */}
        <Stage
          index={2}
          label={t.hwStageLabel(2)}
          title={t.hwS2Title}
          tone="raw"
          current={active === 2}
        >
          <p>{t.hwS2P1}</p>
          <Figure
            index={2}
            revealed={revealed[2]}
            aria={t.hwS2Aria}
            caption={t.hwS2Caption}
            viewBox="0 0 455 177"
          >
            <defs>
              <marker
                id="hw-arrow-fft"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" className="hw-raw" />
              </marker>
            </defs>

            <text x="20" y="30" className="hw-mono">
              {t.hwS2Waveform}
            </text>
            <g className="hw-raw-s" strokeWidth="2" fill="none">
              <path d="M 20 100 Q 30 110 40 95 Q 50 80 60 85 Q 70 90 80 75 Q 90 60 100 70 Q 110 80 120 65 Q 130 50 140 60 Q 150 70 160 55 Q 170 40 180 50 Q 190 60 200 45" />
            </g>
            <line x1="20" y1="105" x2="200" y2="105" className="hw-rule" />

            <path
              d="M 220 50 L 240 60 L 220 70"
              fill="none"
              className="hw-raw-s"
              strokeWidth="2"
              markerEnd="url(#hw-arrow-fft)"
            />
            <text x="230" y="92" textAnchor="middle" fontSize="12" className="hw-dim">
              FFT
            </text>

            <text x="300" y="30" className="hw-mono">
              {t.hwS2Spectrum}
            </text>
            {SPECTRUM_BARS.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="8" height={h} className="hw-raw" opacity={o} />
            ))}

            <line x1="300" y1="145" x2="410" y2="145" className="hw-rule" />
            <text x="303" y="167" fontSize="11" className="hw-dim">
              {t.hwS2Low}
            </text>
            <text x="407" y="167" fontSize="11" textAnchor="end" className="hw-dim">
              {t.hwS2High}
            </text>

            {/* The fundamental is called out above the spectrum and the overtones
                from the empty margin at the right, so the two labels can never
                land in the same lane however long the words get. */}
            <text
              x="334"
              y="62"
              textAnchor="middle"
              fontSize="12"
              fontWeight="500"
              className="hw-raw"
            >
              {t.hwS2RealString}
            </text>
            <line x1="334" y1="68" x2="334" y2="91" className="hw-raw-s" strokeWidth="1.5" />

            <text x="422" y="105" fontSize="12" fontWeight="500" className="hw-raw">
              {t.hwS2Harmonics}
            </text>
            <g className="hw-raw-s" strokeWidth="1.5" fill="none">
              <path d="M 418 101 L 381 100" />
              <path d="M 418 101 L 361 105" />
            </g>
          </Figure>
        </Stage>

        {/* ---------- stage 3: chroma folding ---------- */}
        <Stage
          index={3}
          label={t.hwStageLabel(3)}
          title={t.hwS3Title}
          tone="raw"
          current={active === 3}
        >
          <p>
            {t.hwS3P1a}
            <em>{t.hwS3P1Em}</em>
            {t.hwS3P1b}
          </p>
          <p>{t.hwS3P2}</p>
          <Figure
            index={3}
            revealed={revealed[3]}
            aria={t.hwS3Aria}
            caption={t.hwS3Caption}
            viewBox="0 0 473 232"
          >
            <defs>
              <marker
                id="hw-arrow-fold"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" className="hw-raw" />
              </marker>
            </defs>

            {/* Names ride above their note so the fold lines never draw through
                a label, and all three arrows land on the C bucket itself. They
                draw in turn and the bucket then fills: the one thing a still
                picture of this cannot show. */}
            <text x="80" y="22" textAnchor="middle" fontSize="12">
              {t.hwS3LowC}
            </text>
            <circle cx="80" cy="38" r="6" className="hw-raw" />
            <path
              d="M 80 48 Q 78 70 66 92"
              pathLength={1}
              fill="none"
              className="hw-raw-s hw-draw"
              style={{ transitionDelay: '80ms' }}
              strokeWidth="1.5"
              markerEnd="url(#hw-arrow-fold)"
            />

            <text x="180" y="22" textAnchor="middle" fontSize="12">
              {t.hwS3MidC}
            </text>
            <circle cx="180" cy="38" r="6" className="hw-raw" />
            <path
              d="M 180 48 Q 130 66 68 92"
              pathLength={1}
              fill="none"
              className="hw-raw-s hw-draw"
              style={{ transitionDelay: '240ms' }}
              strokeWidth="1.5"
              markerEnd="url(#hw-arrow-fold)"
            />

            <text x="280" y="22" textAnchor="middle" fontSize="12">
              {t.hwS3HighC}
            </text>
            <circle cx="280" cy="38" r="6" className="hw-raw" />
            <path
              d="M 280 48 Q 150 62 70 92"
              pathLength={1}
              fill="none"
              className="hw-raw-s hw-draw"
              style={{ transitionDelay: '400ms' }}
              strokeWidth="1.5"
              markerEnd="url(#hw-arrow-fold)"
            />

            <text x="330" y="78" className="hw-mono" fontSize="12">
              {t.hwS3Chroma}
            </text>

            {CHROMA_BINS.map(([x, y, h, o], i) => (
              <g key={x}>
                <rect
                  x={x}
                  y={y}
                  width="30"
                  height={h}
                  className={i === 0 ? 'hw-raw hw-grow' : 'hw-raw'}
                  opacity={o}
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <text x={x + 15} y="180" textAnchor="middle" className="hw-mono">
                  {CHROMA_NAMES[i]}
                </text>
              </g>
            ))}

            <text x="310" y="220" textAnchor="middle" fontSize="11" className="hw-dim">
              {t.hwS3Buckets}
            </text>
          </Figure>
          <Deeper title={t.hwDeepChromaTitle}>
            <p>{t.hwDeepChromaP1}</p>
            <p>{t.hwDeepChromaP2}</p>
          </Deeper>
        </Stage>

        {/* ---------- stage 4: template matching ---------- */}
        <Stage
          index={4}
          label={t.hwStageLabel(4)}
          title={t.hwS4Title}
          tone="raw"
          current={active === 4}
        >
          <p>{t.hwS4P1}</p>
          <p>{t.hwS4P2}</p>
          <Figure
            index={4}
            revealed={revealed[4]}
            aria={t.hwS4Aria}
            caption={t.hwS4Caption}
            viewBox="0 0 600 320"
          >
            <text x="20" y="30" fontWeight="600" fontSize="13">
              {t.hwS4Measured}
            </text>
            <RawBars bars={MEASURED_BARS} />
            <line x1="20" y1="100" x2="310" y2="100" className="hw-rule" />

            <text x="20" y="135" fontWeight="600" fontSize="13">
              Cmaj
            </text>
            <RawBars bars={TEMPLATE_MAJ} />
            <line x1="20" y1="190" x2="310" y2="190" className="hw-rule" />

            <text x="20" y="225" fontWeight="600" fontSize="13">
              Cmin
            </text>
            <RawBars bars={TEMPLATE_MIN} />

            <rect
              x="335"
              y="135"
              width="240"
              height="160"
              className="hw-decided hw-decided-s"
              fillOpacity="0.09"
              strokeWidth="2"
              rx="4"
            />
            <text x="345" y="152" fontWeight="600" fontSize="13" className="hw-decided">
              C7 ← {t.hwS4BestMatch}
            </text>
            {TEMPLATE_WINNER.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="18" height={h} className="hw-decided" opacity={o} />
            ))}

            <path
              d="M 550 262 L 558 270 L 570 247"
              pathLength={1}
              fill="none"
              className="hw-decided-s hw-draw"
              style={{ transitionDelay: '450ms' }}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Figure>
        </Stage>

        {/* ---------- stage 5: viterbi, where measurement becomes an answer ---------- */}
        <Stage
          index={5}
          label={t.hwStageLabel(5)}
          title={t.hwS5Title}
          tone="decided"
          current={active === 5}
        >
          <p>{t.hwS5P1}</p>
          <p>
            {t.hwS5P2a}
            <em>{t.hwS5P2Em}</em>
            {t.hwS5P2b}
          </p>
          <Figure
            index={5}
            revealed={revealed[5]}
            aria={t.hwS5Aria}
            caption={t.hwS5Caption}
            viewBox="0 0 620 220"
          >
            {/* Row labels sit in their own gutter left of x=150; the data lane
                starts there, so a long English label cannot reach a chord name. */}
            <text x="20" y="32" fontWeight="600" fontSize="13">
              {t.hwS5Raw}
            </text>
            <text x="20" y="50" fontSize="11" className="hw-dim">
              {t.hwS5RawSub}
            </text>

            <g className="hw-raw-s" strokeWidth="1" opacity="0.5">
              {RAW_TICKS.map((y, i) => (
                <line
                  key={i}
                  x1={155 + i * 10}
                  y1={y}
                  x2={165 + i * 10}
                  y2={y}
                  className="hw-flicker"
                  style={{ transitionDelay: `${i * 32}ms` }}
                />
              ))}
            </g>

            <g fontSize="11" className="hw-mono">
              {RAW_LABELS.map((name, i) => (
                <text key={i} x={160 + i * 20} y="44" textAnchor="middle" className="hw-raw">
                  {name}
                </text>
              ))}
            </g>

            <line x1="20" y1="110" x2="600" y2="110" className="hw-rule" />

            <text x="20" y="140" fontWeight="600" fontSize="13">
              {t.hwS5Smoothed}
            </text>
            <text x="20" y="158" fontSize="11" className="hw-dim">
              {t.hwS5SmoothedSub}
            </text>

            <g className="hw-decided-s" strokeWidth="2">
              {SMOOTH_PATH.map(([x1, y1, x2, y2], i) => (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  pathLength={1}
                  className="hw-draw"
                  style={{ transitionDelay: `${700 + i * 110}ms` }}
                />
              ))}
            </g>

            <g fontSize="12" className="hw-mono hw-decided" fontWeight="600">
              {SMOOTH_LABELS.map(([x, y, name], i) => (
                <text key={i} x={x} y={y} textAnchor="middle">
                  {name}
                </text>
              ))}
            </g>

            <g fontSize="10" className="hw-dim" textAnchor="middle">
              <text x="160" y="212">
                0s
              </text>
              <text x="290" y="212">
                0.5s
              </text>
              <text x="420" y="212">
                1.0s
              </text>
            </g>
          </Figure>
        </Stage>

        {/* ---------- stage 6: tempo ---------- */}
        <Stage
          index={6}
          label={t.hwStageLabel(6)}
          title={t.hwS6Title}
          tone="decided"
          current={active === 6}
        >
          <p>{t.hwS6P1}</p>
          <Figure
            index={6}
            revealed={revealed[6]}
            aria={t.hwS6Aria}
            caption={t.hwS6Caption}
            viewBox="10 5 518 240"
          >
            <text x="20" y="25" fontWeight="600" fontSize="13">
              {t.hwS6Onset}
            </text>

            <g className="hw-raw-s" strokeWidth="2.5" fill="none" strokeLinecap="round">
              <path
                d="M 40 150 Q 60 80 80 140 Q 100 70 120 135 Q 140 75 160 130 Q 180 85 200 125 Q 220 95 240 120 Q 260 100 280 118 Q 300 110 320 115 Q 340 115 360 115 Q 380 120 400 130 Q 420 140 440 125 Q 460 100 480 130 Q 500 120 520 130"
                pathLength={1}
                className="hw-draw"
              />
            </g>

            <g className="hw-decided-s" strokeWidth="2">
              {[80, 140, 200, 260, 320, 380, 440, 500].map((x, i) => (
                <line
                  key={x}
                  x1={x}
                  y1="170"
                  x2={x}
                  y2="190"
                  className="hw-flicker"
                  style={{ transitionDelay: `${500 + i * 70}ms` }}
                />
              ))}
            </g>

            <g className="hw-decided-s" strokeWidth="1.5" fill="none">
              <path d="M 80 210 L 80 220 L 140 220 L 140 210" />
            </g>
            <text
              x="110"
              y="235"
              textAnchor="middle"
              fontSize="12"
              fontWeight="500"
              className="hw-decided"
            >
              {t.hwS6BeatInterval}
            </text>

            <line x1="40" y1="170" x2="520" y2="170" className="hw-rule" />
          </Figure>
          <Deeper title={t.hwDeepOctaveTitle}>
            <p>{t.hwDeepOctaveP1}</p>
            <p>{t.hwDeepOctaveP2}</p>
          </Deeper>
        </Stage>

        {/* ---------- stage 7: key ---------- */}
        <Stage
          index={7}
          label={t.hwStageLabel(7)}
          title={t.hwS7Title}
          tone="decided"
          current={active === 7}
        >
          <p>{t.hwS7P1}</p>
          <Figure
            index={7}
            revealed={revealed[7]}
            aria={t.hwS7Aria}
            caption={t.hwS7Caption}
            viewBox="10 9 338 279"
          >
            <text x="20" y="30" fontWeight="600" fontSize="13">
              {t.hwS7SongChroma}
            </text>
            {SONG_CHROMA.map(([x, y, h, o], i) => (
              <g key={x}>
                <rect x={x} y={y} width="20" height={h} className="hw-raw" opacity={o} />
                <text x={x + 10} y="130" fontSize="10" className="hw-mono" textAnchor="middle">
                  {CHROMA_NAMES[i]}
                </text>
              </g>
            ))}

            <line x1="20" y1="160" x2="340" y2="160" className="hw-rule" />
            <text x="20" y="185" fontWeight="600" fontSize="12">
              {t.hwS7Candidates}
            </text>

            {/* Candidate names live in a gutter that ends at x=130, where the
                profiles begin. */}
            <text x="20" y="215" className="hw-mono" fontWeight="600">
              {t.hwS7RunnerUpKey}
            </text>
            {KEY_RUNNER_UP.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="15" height={h} className="hw-raw" opacity={o} />
            ))}

            <rect
              x="130"
              y="235"
              width="160"
              height="35"
              className="hw-decided hw-decided-s"
              fillOpacity="0.1"
              strokeWidth="2"
              rx="3"
            />
            <text x="20" y="265" className="hw-mono hw-decided" fontWeight="600">
              {t.hwS7BestKey} ← {t.hwS7Best}
            </text>
            {KEY_WINNER.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="15" height={h} className="hw-decided" opacity={o} />
            ))}
          </Figure>
        </Stage>

        {/* ---------- stages 8 and 9: arranging, and the finished chart ---------- */}
        <Stage
          index={8}
          label={t.hwStages89}
          title={t.hwS89Title}
          tone="decided"
          current={active === 8}
        >
          <p>{t.hwS89P1}</p>
          <TermList terms={t.hwS89Terms} descs={t.hwS89Descs} />
          <Figure
            index={8}
            revealed={revealed[8]}
            aria={t.hwS89Aria}
            caption={t.hwS89Caption}
            viewBox="10 11 378 179"
          >
            {/* Only short labels live inside the drawing; the sentence that used
                to run past the viewBox is in the figcaption now. */}
            <text x="20" y="30" fontWeight="600" fontSize="13">
              {t.hwS89Final}
            </text>

            {CHART_BARS.map(([x, name, strumX]) => (
              <g key={x}>
                <line x1={x} y1="70" x2={x} y2="150" stroke="currentColor" strokeWidth="2" />
                <text x={x + 10} y="60" className="hw-mono hw-decided" fontWeight="600">
                  {name}
                </text>
                <g textAnchor="middle" fontSize="16" className="hw-decided">
                  <text x={strumX} y="90">
                    v
                  </text>
                  <text x={strumX} y="110">
                    v
                  </text>
                  <text x={strumX} y="130">
                    v
                  </text>
                  <text x={strumX} y="150">
                    v
                  </text>
                </g>
              </g>
            ))}
            <line x1="380" y1="70" x2="380" y2="150" stroke="currentColor" strokeWidth="2" />

            <text x="20" y="180" fontSize="11" className="hw-dim">
              {t.hwS89Strum}
            </text>
          </Figure>
        </Stage>
      </div>

      <div className="card hw-limits" data-stage={STAGE_COUNT}>
        <h2>{t.hwLimitsTitle}</h2>
        <p>{t.hwLimitsIntro}</p>
        <ul className="hw-list">
          <li>
            <strong>{t.hwLimitTerms[0]}</strong>
            {t.hwLimitAccuracyLead}
            <span className="hw-stat">96%</span>
            {t.hwLimitAccuracyMid}
            <span className="hw-stat">70%</span>
            {t.hwLimitAccuracyTail}
          </li>
          <li>
            <strong>{t.hwLimitTerms[1]}</strong>
            {t.hwLimitHardIntro}
            <ul className="hw-list hw-sublist">
              {t.hwLimitHardItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </li>
          <li>
            <strong>{t.hwLimitTerms[2]}</strong>
            {t.hwLimitVocab}
          </li>
        </ul>
      </div>

      {/* No GitHub link here: the page footer below carries the same one, and
          the two sat one under the other. This closing came from a standalone
          version of the page that had no footer of its own. */}
      <div className="hw-closing">
        <p>{t.hwClosing}</p>
      </div>
    </div>
  );
}
