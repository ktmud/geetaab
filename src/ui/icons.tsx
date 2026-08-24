interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

export function MicIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

export function FileIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14 3v5h5" />
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M9 17V12l5 2.5L9 17Z" />
    </svg>
  );
}

export function SparkIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function PlayIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor" stroke="none">
      <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

export function PauseIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor" stroke="none">
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

export function StopIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

export function RewindIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 5v14" />
      <path d="M20 6.5v11a1 1 0 0 1-1.55.83l-8-5.5a1 1 0 0 1 0-1.66l8-5.5A1 1 0 0 1 20 6.5Z" />
    </svg>
  );
}

export function SkipBackTenIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
        fontFamily="inherit"
      >
        10
      </text>
    </svg>
  );
}

export function SkipForwardTenIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
        fontFamily="inherit"
      >
        10
      </text>
    </svg>
  );
}

export function CheckIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4.5 12.5 10 18 19.5 6.5" />
    </svg>
  );
}

export function PrintIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="7" rx="1" />
    </svg>
  );
}

export function SpeedIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="M12 17l4-5.5" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function VolumeIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15 8.8a4.6 4.6 0 0 1 0 6.4" />
      <path d="M17.8 6a8.4 8.4 0 0 1 0 12" />
    </svg>
  );
}

export function MetronomeIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9.5 3h5l3.5 18H6L9.5 3Z" />
      <path d="M7 15h10" />
      <path d="M12 19 16.5 7" />
    </svg>
  );
}

export function LoopIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M17 3l3 3-3 3" />
      <path d="M20 6H8a4 4 0 0 0-4 4v1" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M4 18h12a4 4 0 0 0 4-4v-1" />
    </svg>
  );
}

export function BackIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function TrashIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function SlidersIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </svg>
  );
}

export function CloseIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function GitHubIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 4.64 3 8.58 7.18 9.97.53.1.72-.23.72-.5v-1.78c-2.92.63-3.54-1.4-3.54-1.4-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.08 1.61 1.08 1.61 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.2 0-1.14.41-2.08 1.08-2.81-.1-.27-.47-1.34.1-2.79 0 0 .89-.28 2.9 1.08a10.1 10.1 0 0 1 5.28 0c2-1.36 2.89-1.08 2.89-1.08.58 1.45.21 2.52.1 2.79.67.73 1.08 1.67 1.08 2.81 0 4.04-2.46 4.92-4.8 5.18.38.33.71.96.71 1.95v2.88c0 .28.19.6.73.5A10.52 10.52 0 0 0 22.5 12c0-5.8-4.7-10.5-10.5-10.5Z" />
    </svg>
  );
}

export function SunIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
    </svg>
  );
}

export function MoonIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
    </svg>
  );
}

/**
 * The brand mark.
 *
 * Every colour is a custom property rather than a literal, so the mark is
 * repainted by the theme itself: on paper the brass is pitched down a step so
 * a 46px lockup does not glare beside black text.
 */
export function GuitarMark({ size = 26, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="geetaab-mark" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="var(--mark-hi)" />
          <stop offset="46%" stopColor="var(--mark-mid)" />
          <stop offset="100%" stopColor="var(--mark-lo)" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="url(#geetaab-mark)" />
      {/* A nut across the top turns three lines into an unmistakable chord box. */}
      <rect x="5.6" y="6.2" width="12.8" height="1.9" rx="0.95" fill="var(--mark-ink)" />
      <g stroke="var(--mark-ink)" strokeWidth="1.15" strokeLinecap="round" opacity="0.92">
        <path d="M8 8.4v9.8M12 8.4v9.8M16 8.4v9.8" />
      </g>
      <g fill="var(--mark-ink)">
        <circle cx="8" cy="11.4" r="1.85" />
        <circle cx="16" cy="11.4" r="1.85" />
        <circle cx="12" cy="15.4" r="1.85" />
      </g>
    </svg>
  );
}
