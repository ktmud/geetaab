import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { BackIcon, GitHubIcon } from './icons';

export interface HowItWorksProps {
  onBack: () => void;
}

/**
 * The colour story is the point of this page, so it is worth naming: the cool
 * token means "raw measurement, nothing decided yet" and the brass token means
 * "the app has committed to an answer". The spine down the left changes from
 * one to the other at stage 5, where per-frame guesses become a path the app is
 * willing to print. Every diagram below obeys the same rule, and every colour
 * comes from the app's own accent tokens through .hw-raw / .hw-decided.
 */
type Tone = 'raw' | 'decided';

/** x, y, height, opacity — the shorthand every bar chart below is written in. */
type Bar = [number, number, number, number];

const CHROMA_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const PATH_NODES = [30, 90, 150, 210, 270, 330, 390, 450, 510];
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

/** Where the raw per-frame guess sat on each tick, and what it was called. */
const RAW_TICKS = [60, 75, 65, 55, 70, 60, 80, 68, 72, 62, 76, 66, 58, 74, 64, 70, 59, 77, 61, 73];
const RAW_LABELS = ['C', 'Am', 'G', 'C', 'G', 'Am', 'C', 'Am', 'G', 'C'];

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
  [120, 200, 25, 0.3],
  [138, 200, 25, 0.3],
  [156, 205, 20, 0.3],
  [174, 203, 22, 0.3],
  [192, 198, 27, 0.3],
  [210, 208, 17, 0.2],
];

const KEY_WINNER: Bar[] = [
  [120, 245, 35, 0.6],
  [138, 248, 32, 0.5],
  [156, 255, 25, 0.3],
  [174, 250, 30, 0.4],
  [192, 242, 38, 0.7],
  [210, 258, 22, 0.3],
];

/** Bar line x, chord name, and the x the strum arrows sit on. */
const CHART_BARS: [number, string, number][] = [
  [60, 'G', 75],
  [140, 'D', 155],
  [220, 'Am', 245],
  [300, 'G', 325],
];

function Stage({
  label,
  title,
  tone,
  children,
}: {
  label: string;
  title?: string;
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <section className={`hw-stage${tone === 'decided' ? ' decided' : ''}`}>
      <div className="hw-stage-num">{label}</div>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

function Figure({
  aria,
  caption,
  viewBox,
  children,
}: {
  aria: string;
  caption: string;
  viewBox: string;
  children: ReactNode;
}) {
  return (
    <figure className="hw-fig">
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={aria}>
        {children}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
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

  return (
    <div className="shell how-it-works">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> {t.back}
        </button>
      </div>

      <div className="eyebrow">{t.hwEyebrow}</div>
      <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)' }}>{t.hwTitle}</h1>
      <p className="lede hw-lede">{t.hwLede}</p>

      <div className="hw-path">
        {/* ---------- overview ---------- */}
        <Stage label={t.hwOverview} tone="raw">
          <Figure aria={t.hwOverviewAria} caption={t.hwOverviewCaption} viewBox="0 0 640 120">
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
                className={i < 5 ? 'hw-raw' : 'hw-decided'}
                stroke="currentColor"
                strokeWidth="2"
              />
            ))}
            <circle cx="610" cy="60" r="8" className="hw-decided" stroke="currentColor" strokeWidth="2" />

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
        <Stage label={t.hwStageLabel(1)} title={t.hwS1Title} tone="raw">
          <p>{t.hwS1P1}</p>
          <p>{t.hwS1P2}</p>
          <TermList terms={t.hwS1Terms} descs={t.hwS1Descs} />
          <p>
            {t.hwS1P3a}
            <em>{t.hwS1P3Em}</em>
            {t.hwS1P3b}
          </p>
          <Figure aria={t.hwS1Aria} caption={t.hwS1Caption} viewBox="0 0 500 280">
            {t.hwS1Cols.map((col, i) => (
              <text key={col} x={100 + i * 60} y="25" className="hw-mono" textAnchor="middle">
                {col}
              </text>
            ))}

            {/* A filled brass dot is a pass — a decided "yes". A hollow cool
                ring is the raw measurement that never cleared the bar. */}
            {GATE_ROWS.map((row, r) => (
              <g key={r}>
                <text x="30" y={80 + r * 55} fontWeight="500">
                  {t.hwS1Rows[r]}
                </text>
                {row.map((pass, c) =>
                  pass ? (
                    <circle key={c} cx={100 + c * 60} cy={70 + r * 55} r="6" className="hw-decided" />
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
                <line x1="50" y1={50 + r * 55} x2="370" y2={50 + r * 55} className="hw-rule" />
              </g>
            ))}
          </Figure>
        </Stage>

        {/* ---------- stage 2: the FFT ---------- */}
        <Stage label={t.hwStageLabel(2)} title={t.hwS2Title} tone="raw">
          <p>{t.hwS2P1}</p>
          <Figure aria={t.hwS2Aria} caption={t.hwS2Caption} viewBox="0 0 600 280">
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
            <text x="230" y="90" textAnchor="middle" fontSize="12" className="hw-dim">
              FFT
            </text>

            <text x="300" y="30" className="hw-mono">
              {t.hwS2Spectrum}
            </text>
            {SPECTRUM_BARS.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="8" height={h} className="hw-raw" opacity={o} />
            ))}

            <line x1="300" y1="145" x2="410" y2="145" className="hw-rule" />
            <text x="305" y="165" fontSize="11" className="hw-dim">
              {t.hwS2Low}
            </text>
            <text x="380" y="165" fontSize="11" className="hw-dim">
              {t.hwS2High}
            </text>

            <text x="330" y="65" textAnchor="middle" fontSize="12" fontWeight="500" className="hw-raw">
              {t.hwS2RealString}
            </text>
            <line x1="330" y1="75" x2="330" y2="90" className="hw-raw-s" strokeWidth="1.5" />

            <text x="350" y="75" textAnchor="middle" fontSize="12" fontWeight="500" className="hw-raw">
              {t.hwS2Harmonic}
            </text>
            <line x1="350" y1="80" x2="350" y2="95" className="hw-raw-s" strokeWidth="1.5" />

            <text x="370" y="60" textAnchor="middle" fontSize="12" fontWeight="500" className="hw-raw">
              {t.hwS2Harmonic}
            </text>
            <line x1="370" y1="70" x2="370" y2="95" className="hw-raw-s" strokeWidth="1.5" />
          </Figure>
        </Stage>

        {/* ---------- stage 3: chroma folding ---------- */}
        <Stage label={t.hwStageLabel(3)} title={t.hwS3Title} tone="raw">
          <p>
            {t.hwS3P1a}
            <em>{t.hwS3P1Em}</em>
            {t.hwS3P1b}
          </p>
          <p>{t.hwS3P2}</p>
          <Figure aria={t.hwS3Aria} caption={t.hwS3Caption} viewBox="0 0 620 240">
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

            <circle cx="80" cy="30" r="6" className="hw-raw" />
            <text x="80" y="55" textAnchor="middle" fontSize="12">
              {t.hwS3LowC}
            </text>
            <path
              d="M 80 40 Q 100 60 110 85"
              fill="none"
              className="hw-raw-s"
              strokeWidth="1.5"
              markerEnd="url(#hw-arrow-fold)"
            />

            <circle cx="180" cy="30" r="6" className="hw-raw" />
            <text x="180" y="55" textAnchor="middle" fontSize="12">
              {t.hwS3MidC}
            </text>
            <path
              d="M 180 40 Q 110 60 110 85"
              fill="none"
              className="hw-raw-s"
              strokeWidth="1.5"
              markerEnd="url(#hw-arrow-fold)"
            />

            <circle cx="280" cy="30" r="6" className="hw-raw" />
            <text x="280" y="55" textAnchor="middle" fontSize="12">
              {t.hwS3HighC}
            </text>
            <path
              d="M 280 40 Q 120 60 110 85"
              fill="none"
              className="hw-raw-s"
              strokeWidth="1.5"
              markerEnd="url(#hw-arrow-fold)"
            />

            <text x="310" y="75" className="hw-mono" fontSize="11">
              {t.hwS3Chroma}
            </text>

            {CHROMA_BINS.map(([x, y, h, o], i) => (
              <g key={x}>
                <rect
                  x={x}
                  y={y}
                  width="30"
                  height={h}
                  className="hw-raw"
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
        </Stage>

        {/* ---------- stage 4: template matching ---------- */}
        <Stage label={t.hwStageLabel(4)} title={t.hwS4Title} tone="raw">
          <p>{t.hwS4P1}</p>
          <p>{t.hwS4P2}</p>
          <Figure aria={t.hwS4Aria} caption={t.hwS4Caption} viewBox="0 0 600 320">
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
            <text x="345" y="150" fontWeight="600" fontSize="13" className="hw-decided">
              C7 ← {t.hwS4BestMatch}
            </text>
            {TEMPLATE_WINNER.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="18" height={h} className="hw-decided" opacity={o} />
            ))}

            <path
              d="M 560 260 L 568 268 L 580 245"
              fill="none"
              className="hw-decided-s"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Figure>
        </Stage>

        {/* ---------- stage 5: viterbi, where measurement becomes an answer ---------- */}
        <Stage label={t.hwStageLabel(5)} title={t.hwS5Title} tone="decided">
          <p>{t.hwS5P1}</p>
          <p>
            {t.hwS5P2a}
            <em>{t.hwS5P2Em}</em>
            {t.hwS5P2b}
          </p>
          <Figure aria={t.hwS5Aria} caption={t.hwS5Caption} viewBox="0 0 620 220">
            <text x="20" y="25" fontWeight="600" fontSize="13">
              {t.hwS5Raw}
            </text>
            <text x="20" y="50" fontSize="11" className="hw-dim">
              {t.hwS5RawSub}
            </text>

            <g className="hw-raw-s" strokeWidth="1" opacity="0.45">
              {RAW_TICKS.map((y, i) => (
                <line key={i} x1={60 + i * 10} y1={y} x2={70 + i * 10} y2={y} />
              ))}
            </g>

            <g fontSize="11" className="hw-mono">
              {RAW_LABELS.map((name, i) => (
                <text key={i} x={65 + i * 20} y="50" textAnchor="middle" className="hw-raw">
                  {name}
                </text>
              ))}
            </g>

            <line x1="40" y1="110" x2="580" y2="110" className="hw-rule" />

            <text x="20" y="135" fontWeight="600" fontSize="13">
              {t.hwS5Smoothed}
            </text>
            <text x="20" y="160" fontSize="11" className="hw-dim">
              {t.hwS5SmoothedSub}
            </text>

            <g className="hw-decided-s" strokeWidth="2">
              <line x1="60" y1="175" x2="130" y2="175" />
              <line x1="130" y1="175" x2="180" y2="190" />
              <line x1="180" y1="190" x2="250" y2="190" />
              <line x1="250" y1="190" x2="310" y2="175" />
              <line x1="310" y1="175" x2="380" y2="175" />
            </g>

            <g fontSize="12" className="hw-mono hw-decided" fontWeight="600">
              <text x="95" y="165" textAnchor="middle">
                C
              </text>
              <text x="155" y="165" textAnchor="middle">
                Am
              </text>
              <text x="215" y="185" textAnchor="middle">
                G
              </text>
              <text x="280" y="185" textAnchor="middle">
                C
              </text>
              <text x="345" y="165" textAnchor="middle">
                Am
              </text>
            </g>

            <g fontSize="10" className="hw-dim" textAnchor="middle">
              <text x="60" y="215">
                0s
              </text>
              <text x="190" y="215">
                0.5s
              </text>
              <text x="320" y="215">
                1.0s
              </text>
            </g>
          </Figure>
        </Stage>

        {/* ---------- stage 6: tempo ---------- */}
        <Stage label={t.hwStageLabel(6)} title={t.hwS6Title} tone="decided">
          <p>{t.hwS6P1}</p>
          <Figure aria={t.hwS6Aria} caption={t.hwS6Caption} viewBox="0 0 580 240">
            <text x="20" y="25" fontWeight="600" fontSize="13">
              {t.hwS6Onset}
            </text>

            <g className="hw-raw-s" strokeWidth="2.5" fill="none" strokeLinecap="round">
              <path d="M 40 150 Q 60 80 80 140 Q 100 70 120 135 Q 140 75 160 130 Q 180 85 200 125 Q 220 95 240 120 Q 260 100 280 118 Q 300 110 320 115 Q 340 115 360 115 Q 380 120 400 130 Q 420 140 440 125 Q 460 100 480 130 Q 500 120 520 130" />
            </g>

            <g className="hw-decided-s" strokeWidth="2">
              {[80, 140, 200, 260, 320, 380, 440, 500].map((x) => (
                <line key={x} x1={x} y1="170" x2={x} y2="190" />
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
        </Stage>

        {/* ---------- stage 7: key ---------- */}
        <Stage label={t.hwStageLabel(7)} title={t.hwS7Title} tone="decided">
          <p>{t.hwS7P1}</p>
          <Figure aria={t.hwS7Aria} caption={t.hwS7Caption} viewBox="0 0 600 280">
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

            <text x="40" y="215" className="hw-mono" fontWeight="600">
              G maj
            </text>
            {KEY_RUNNER_UP.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="15" height={h} className="hw-raw" opacity={o} />
            ))}

            <rect
              x="100"
              y="235"
              width="160"
              height="35"
              className="hw-decided hw-decided-s"
              fillOpacity="0.1"
              strokeWidth="2"
              rx="3"
            />
            <text x="40" y="265" className="hw-mono hw-decided" fontWeight="600">
              C maj ← {t.hwS7Best}
            </text>
            {KEY_WINNER.map(([x, y, h, o]) => (
              <rect key={x} x={x} y={y} width="15" height={h} className="hw-decided" opacity={o} />
            ))}
          </Figure>
        </Stage>

        {/* ---------- stages 8 and 9: arranging, and the finished chart ---------- */}
        <Stage label={t.hwStages89} title={t.hwS89Title} tone="decided">
          <p>{t.hwS89P1}</p>
          <TermList terms={t.hwS89Terms} descs={t.hwS89Descs} />
          <Figure aria={t.hwS89Aria} caption={t.hwS89Caption} viewBox="0 0 520 200">
            <text x="20" y="30" fontWeight="600" fontSize="13">
              {t.hwS89Final}
            </text>

            {CHART_BARS.map(([x, name, strumX]) => (
              <g key={x}>
                <line x1={x} y1="60" x2={x} y2="140" stroke="currentColor" strokeWidth="2" />
                <text x={x + 10} y="50" className="hw-mono hw-decided" fontWeight="600">
                  {name}
                </text>
                <g textAnchor="middle" fontSize="16" className="hw-decided">
                  <text x={strumX} y="80">
                    v
                  </text>
                  <text x={strumX} y="100">
                    v
                  </text>
                  <text x={strumX} y="120">
                    v
                  </text>
                  <text x={strumX} y="140">
                    v
                  </text>
                </g>
              </g>
            ))}
            <line x1="380" y1="60" x2="380" y2="140" stroke="currentColor" strokeWidth="2" />

            <text x="20" y="180" fontSize="11" className="hw-dim">
              {t.hwS89ChartNote}
            </text>
          </Figure>
        </Stage>
      </div>

      <div className="card hw-limits">
        <h2>{t.hwLimitsTitle}</h2>
        <p>{t.hwLimitsIntro}</p>
        <ul className="hw-list">
          <li>
            <strong>{t.hwLimitTerms[0]}</strong>
            {t.hwLimitAccuracyLead}
            <span className="hw-stat">94%</span>
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

      <div className="hw-closing">
        <p>{t.hwClosing}</p>
        <p>
          <a href="https://github.com/ktmud/geetaab" target="_blank" rel="noreferrer">
            <GitHubIcon size={14} /> {t.hwClosingLink}
          </a>
        </p>
      </div>
    </div>
  );
}
