import type { CSSProperties } from 'react';

import type { BadgeTone } from '@/components/ui/badge';

export type RunStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'waiting_for_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * The design's four tones: `wait` (accent, pulsing), `run` (sage, pulsing),
 * `done` (neutral) and `fail` (muted rose).
 */
export type Tone = 'wait' | 'run' | 'done' | 'fail';

export const toneBadge: Record<Tone, BadgeTone> = {
  wait: 'accent',
  run: 'accent-2',
  done: 'neutral',
  fail: 'outline',
};

export const toneDotColor: Record<Tone, string> = {
  wait: 'var(--color-accent)',
  run: 'var(--color-accent-2)',
  done: 'var(--color-neutral-400)',
  fail: 'var(--color-danger)',
};

export const tonePulses: Record<Tone, boolean> = {
  wait: true,
  run: true,
  done: false,
  fail: false,
};

export function statusTone(status: RunStatus): Tone {
  switch (status) {
    case 'waiting_for_approval':
      return 'wait';
    case 'starting':
    case 'running':
    case 'stopping':
      return 'run';
    case 'failed':
      return 'fail';
    default:
      return 'done';
  }
}

/** Short label for the run header — never show raw enum strings to the user. */
export function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Working';
    case 'waiting_for_approval':
      return 'Needs approval';
    case 'stopping':
      return 'Stopping';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Stopped';
    default:
      return '';
  }
}

export function dotStyle(tone: Tone, size = 7): CSSProperties {
  return {
    width: `${size}px`,
    height: `${size}px`,
    flex: 'none',
    borderRadius: '50%',
    background: toneDotColor[tone],
    animation: tonePulses[tone] ? 'pi-pulse 1.8s ease-in-out infinite' : 'none',
  };
}

/** Placeholder for a value the app genuinely does not have. Never invent one. */
export const NOT_REPORTED = '—';

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return NOT_REPORTED;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function formatDuration(
  startedAt: number | null | undefined,
  endedAt?: number | null,
): string {
  if (!startedAt) return NOT_REPORTED;
  const ms = Math.max(0, (endedAt ?? Date.now()) - startedAt);
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Format a bare duration in ms. `formatDuration` expects timestamps, and a 0 start reads as missing. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return NOT_REPORTED;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatTokens(tokens: number | null | undefined): string {
  if (tokens == null) return NOT_REPORTED;
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

/** Usage analytics always use millions so totals and model rows share one unit. */
export function formatTokenMillions(tokens: number | null | undefined): string {
  if (tokens == null) return NOT_REPORTED;
  const millions = tokens / 1_000_000;
  return `${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(millions)}M`;
}

export function formatCost(costUsd: number | null | undefined): string {
  if (costUsd == null) return NOT_REPORTED;
  return `$${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
}

export function formatInteger(value: number | null | undefined): string {
  if (value == null) return NOT_REPORTED;
  return value.toLocaleString();
}

/** Git status letter + the ramp colour the design assigns it. */
export const fileKindBadge: Record<string, { letter: string; background: string }> = {
  added: { letter: 'A', background: 'var(--color-accent-2)' },
  modified: { letter: 'M', background: 'var(--color-accent)' },
  deleted: { letter: 'D', background: 'var(--color-neutral-500)' },
  renamed: { letter: 'R', background: 'var(--color-neutral-600)' },
};

export function fileBadgeStyle(background: string): CSSProperties {
  return {
    width: '17px',
    height: '17px',
    flex: 'none',
    borderRadius: '6px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '9.5px',
    fontWeight: 700,
    color: 'var(--color-bg)',
    background,
  };
}

/** Count insertions/deletions straight out of a unified patch. */
export function patchLineStats(
  patch: string | undefined,
): { added: number; deleted: number } | null {
  if (!patch) return null;
  let added = 0;
  let deleted = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  return { added, deleted };
}
