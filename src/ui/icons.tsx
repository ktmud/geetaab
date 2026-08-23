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

export function RotateIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2.5" y="7" width="19" height="10" rx="2" />
      <path d="M9 3.5 12 1l3 2.5" />
      <path d="M12 1v4" />
    </svg>
  );
}

export function GuitarMark({ size = 26, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="geetaab-mark" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#ffd487" />
          <stop offset="46%" stopColor="#f5b03c" />
          <stop offset="100%" stopColor="#dd7a26" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="url(#geetaab-mark)" />
      {/* A nut across the top turns three lines into an unmistakable chord box. */}
      <rect x="5.6" y="6.2" width="12.8" height="1.9" rx="0.95" fill="#2a1a08" />
      <g stroke="#2a1a08" strokeWidth="1.15" strokeLinecap="round" opacity="0.92">
        <path d="M8 8.4v9.8M12 8.4v9.8M16 8.4v9.8" />
      </g>
      <g fill="#2a1a08">
        <circle cx="8" cy="11.4" r="1.85" />
        <circle cx="16" cy="11.4" r="1.85" />
        <circle cx="12" cy="15.4" r="1.85" />
      </g>
    </svg>
  );
}
