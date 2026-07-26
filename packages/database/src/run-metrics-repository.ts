import type { RunMetrics } from '@pi-desktop/protocol';

/** One day's activity, for the usage heatmap. */
export interface UsageDay {
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageByModel {
  providerId: string;
  modelId: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastUsedAt: number;
}

export interface UsageSummary {
  from: number;
  to: number;
  totals: {
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    completed: number;
    failed: number;
    cancelled: number;
    /** Median wall-clock duration in ms, or null with nothing to measure. */
    medianDurationMs: number | null;
  };
  days: UsageDay[];
  byModel: UsageByModel[];
}

/**
 * Persisted per-run metrics (plan §14 / §26.2 v6-equivalent).
 *
 * These were in-memory only, so every usage figure reset on restart and the
 * task detail slots could never be filled. Persisting them is what makes a
 * usage history possible at all.
 */
export interface RunMetricsRepository {
  record(
    metrics: RunMetrics & { inputTokens?: number; outputTokens?: number; costUsd?: number },
  ): Promise<void>;
  summary(input: { from: number; to: number; projectId?: string }): UsageSummary;
  close?(): void;
}
