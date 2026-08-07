import React from 'react';
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { theme } from '../theme';

/** Fade + rise entrance. Wrap any element. */
export const Rise: React.FC<{
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  distance?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, duration = 24, distance = 14, style }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        opacity: t,
        transform: `translateY(${(1 - t) * distance}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Slide in from the right (dock panels). */
export const SlideInRight: React.FC<{
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, duration = 26, style }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        opacity: t,
        transform: `translateX(${(1 - t) * 46}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Typewriter: reveal text progressively.
 * Must be `display:block; width:100%` — an inline/absolute overlay collapses
 * the wrap width to min-content (one word per line) in Chromium.
 */
export const Typewriter: React.FC<{
  text: string;
  start?: number;
  charsPerFrame?: number;
  caret?: boolean;
  style?: React.CSSProperties;
}> = ({ text, start = 0, charsPerFrame = 1.4, caret = false, style }) => {
  const frame = useCurrentFrame();
  const count = Math.max(
    0,
    Math.min(text.length, Math.floor((frame - start) * charsPerFrame)),
  );
  const visible = text.slice(0, count);
  const done = count >= text.length;
  const caretOn = caret && !done && Math.floor(frame / 12) % 2 === 0;
  return (
    <div
      style={{
        display: 'block',
        width: '100%',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'normal',
        ...style,
      }}
    >
      {visible}
      {caretOn ? (
        <span
          style={{
            display: 'inline-block',
            width: 2,
            height: '0.95em',
            marginLeft: 2,
            verticalAlign: '-0.12em',
            background: theme.accent,
            borderRadius: 1,
          }}
        />
      ) : null}
    </div>
  );
};

/** Rotating arc spinner. */
export const Spinner: React.FC<{
  size?: number;
  color?: string;
  track?: string;
}> = ({ size = 16, color = theme.accent, track = theme.borderStrong }) => {
  const frame = useCurrentFrame();
  const deg = (frame * 8) % 360;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block' }}>
      <circle cx="8" cy="8" r="6" fill="none" stroke={track} strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="28 10"
        transform={`rotate(${deg} 8 8)`}
      />
    </svg>
  );
};

/** Animated check icon (draws itself). */
export const Check: React.FC<{
  start?: number;
  size?: number;
  color?: string;
}> = ({ start = 0, size = 16, color = theme.accent2 }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'block' }}>
      <circle cx="8" cy="8" r="7" fill={color} opacity={0.16} />
      <path
        d="M4.6 8.4 L7 10.8 L11.6 5.6"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - t}
      />
    </svg>
  );
};

/** Count-up number with tabular figures. */
export const CountUp: React.FC<{
  to: number;
  start?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
}> = ({ to, start = 0, duration = 40, decimals = 0, prefix = '', suffix = '', style }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const value = to * t;
  const formatted =
    decimals > 0
      ? value.toFixed(decimals)
      : Math.round(value).toLocaleString('en-US');
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};

/** Springy pop for small elements (chips, bubbles). */
export const Pop: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, mass: 0.5 } });
  return (
    <div style={{ opacity: s, transform: `scale(${0.9 + 0.1 * s})`, ...style }}>
      {children}
    </div>
  );
};

/** Pulsing glow — used on the primary CTA at the end of a loop. */
export const Pulse: React.FC<{
  children: React.ReactNode;
  start?: number;
  style?: React.CSSProperties;
}> = ({ children, start = 0, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(
    Math.max(0, frame - start),
    [0, 40, 80],
    [0.35, 1, 0.35],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  return (
    <div
      style={{
        boxShadow: `0 0 0 ${4 * p}px ${theme.accentSoft}, 0 0 ${18 * p}px ${
          theme.accentSoft
        }`,
        borderRadius: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
