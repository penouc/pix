import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { fontStack, theme } from '../theme';

export type CaptionCue = {
  /** Inclusive start frame. */
  from: number;
  /** Exclusive end frame. */
  to: number;
  text: string;
};

/**
 * Slim top caption bar — sits under the window chrome so it never fights the
 * composer or mid-thread typewriter.
 */
export const Captions: React.FC<{ cues: CaptionCue[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const cue = cues.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;

  const fadeIn = interpolate(frame, [cue.from, cue.from + 6], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(frame, [cue.to - 6, cue.to], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex: 40,
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingTop: 48,
      }}
    >
      <div
        style={{
          opacity,
          maxWidth: 680,
          padding: '8px 16px',
          borderRadius: 999,
          background: 'rgba(23, 24, 26, 0.82)',
          color: '#f8faf8',
          fontFamily: fontStack,
          fontSize: 14.5,
          fontWeight: 600,
          lineHeight: 1.35,
          textAlign: 'center',
          letterSpacing: '0.01em',
          boxShadow: '0 6px 20px rgba(20,21,24,0.16)',
          border: `1px solid rgba(107,143,92,0.35)`,
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};
