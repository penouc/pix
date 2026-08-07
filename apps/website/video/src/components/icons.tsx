import React from 'react';

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const base = (size: number, color: string, strokeWidth: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const PlusIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.6 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M8 3 V13 M3 8 H13" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.5 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 L14 14" />
  </svg>
);

export const ZapIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.5 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M9 1.5 L4 9 H8 L7 14.5 L12 7 H8 Z" />
  </svg>
);

export const SparklesIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.5 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M8 1.5 L9 6 L13.5 7 L9 8 L8 12.5 L7 8 L2.5 7 L7 6 Z" />
  </svg>
);

export const FolderIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.5 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M1.5 3.5 C1.5 2.95 1.95 2.5 2.5 2.5 H6 L7.5 4 H13.5 C14.05 4 14.5 4.45 14.5 5 V12.5 C14.5 13.05 14.05 13.5 13.5 13.5 H2.5 C1.95 13.5 1.5 13.05 1.5 12.5 Z" />
  </svg>
);

export const ChevronIcon: React.FC<IconProps & { down?: boolean }> = ({
  size = 12,
  color = '#6f7a6f',
  strokeWidth = 1.6,
  down = true,
}) => (
  <svg {...base(size, color, strokeWidth)} style={{ transform: down ? undefined : 'rotate(-90deg)' }}>
    <path d="M4 6 L8 10 L12 6" />
  </svg>
);

export const GearIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8 V3.4 M8 12.6 V14.2 M1.8 8 H3.4 M12.6 8 H14.2 M3.2 3.2 L4.3 4.3 M11.7 11.7 L12.8 12.8 M12.8 3.2 L11.7 4.3 M4.3 11.7 L3.2 12.8" />
  </svg>
);

export const PanelIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M10 2.5 V13.5" />
  </svg>
);

export const ImageIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="5.5" cy="6.5" r="1.2" />
    <path d="M2.5 11.5 L6 8.5 L8.5 10.5 L11 7.5 L13.5 11.5" />
  </svg>
);

export const BrainIcon: React.FC<IconProps> = ({ size = 14, color = '#6b8f5c', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M6 3.2 C4.2 3.2 3 4.6 3 6.2 C3 7.1 3.4 7.9 4 8.4 V11.5 C4 12.3 4.7 13 5.5 13 H6.5 V8.6 C5.6 8.2 5 7.3 5 6.2 C5 5.4 5.5 4.7 6.2 4.5" />
    <path d="M10 3.2 C11.8 3.2 13 4.6 13 6.2 C13 7.1 12.6 7.9 12 8.4 V11.5 C12 12.3 11.3 13 10.5 13 H9.5 V8.6 C10.4 8.2 11 7.3 11 6.2 C11 5.4 10.5 4.7 9.8 4.5" />
    <path d="M6.5 5.5 H9.5 M6.5 8 H9.5 M6.5 10.5 H9.5" />
  </svg>
);

export const TerminalIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.5 6 L6.5 8 L4.5 10" />
    <path d="M8.5 10.5 H11.5" />
  </svg>
);

export const FileIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M9 1.5 H4.5 C3.95 1.5 3.5 1.95 3.5 2.5 V13.5 C3.5 14.05 3.95 14.5 4.5 14.5 H11.5 C12.05 14.5 12.5 14.05 12.5 13.5 V5 Z" />
    <path d="M9 1.5 V5 H12.5" />
  </svg>
);

export const EditIcon: React.FC<IconProps> = ({ size = 14, color = '#6f7a6f', strokeWidth = 1.4 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M11.5 1.8 L14.2 4.5 L5.6 13.1 L2.6 13.8 L3.3 10.8 Z" />
    <path d="M9.8 3.5 L12.5 6.2" />
  </svg>
);

export const ArrowUpIcon: React.FC<IconProps> = ({ size = 14, color = '#ffffff', strokeWidth = 2 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <path d="M8 12.5 V3.5 M4.5 7 L8 3.5 L11.5 7" />
  </svg>
);

export const CheckCircleIcon: React.FC<IconProps> = ({ size = 14, color = '#6b8f5c', strokeWidth = 1.5 }) => (
  <svg {...base(size, color, strokeWidth)}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M5.2 8.2 L7.2 10.2 L10.8 6.2" />
  </svg>
);
