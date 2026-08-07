/**
 * PiX desktop light theme — mirrored from
 * apps/desktop/src/renderer/styles/globals.css (:root / Organic).
 * Marketing screenshots are light; do not use the dark IDE palette.
 */
export const theme = {
  bg: '#f8faf8',
  surface: '#f3f6f3',
  raised: '#fafcfa',
  white: '#ffffff',
  border: '#e0e8e0',
  borderStrong: '#c5d4c5',
  muted: '#6f7a6f',
  text: '#17181a',
  textDim: '#4f5a4f',
  accent: '#6b8f5c',
  accentSoft: 'rgba(107, 143, 92, 0.14)',
  accent100: '#f1f5ec',
  accentText: '#56633f',
  accent2: '#5d9e82',
  danger: '#b85c5c',
  heat: ['#ffffff', '#c4d9a8', '#aebf92', '#728157', '#56633f'] as const,
  heatSurface: '#e4eae4',
  shadow: '0 1px 2px rgba(20,21,24,0.07)',
  shadowMd: '0 8px 24px rgba(20,21,24,0.08)',
} as const;

export const fontStack =
  "'Figtree', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
export const monoStack =
  "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace";
