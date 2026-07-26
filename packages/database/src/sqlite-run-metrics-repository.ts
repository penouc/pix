import type { RunMetrics } from '@pi-desktop/protocol';

import type {
  RunMetricsRepository,
  UsageByModel,
  UsageDay,
  UsageSummary,
} from './run-metrics-repository.js';
import type { SqliteDatabase } from './sqlite-connection.js';

interface DayRow {
  date: string;
  runs: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

interface ModelRow {
  provider_id: string | null;
  model_id: string | null;
  runs: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  last_used_at: number;
}

interface TotalsRow {
  runs: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  completed: number;
  failed: number;
  cancelled: number;
}

export class SqliteRunMetricsRepository implements RunMetricsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async record(
    metrics: RunMetrics & { inputTokens?: number; outputTokens?: number; costUsd?: number },
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO run_metrics (
           run_id, session_id, project_id, provider_id, model_id,
           started_at, completed_at, first_token_at,
           tool_call_count, file_change_count,
           input_tokens, output_tokens, cost_usd, outcome
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           completed_at = excluded.completed_at,
           first_token_at = excluded.first_token_at,
           tool_call_count = excluded.tool_call_count,
           file_change_count = excluded.file_change_count,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           cost_usd = excluded.cost_usd,
           outcome = excluded.outcome`,
      )
      .run(
        metrics.runId,
        metrics.sessionId,
        metrics.projectId,
        metrics.providerId ?? null,
        metrics.modelId ?? null,
        metrics.startedAt,
        metrics.completedAt ?? null,
        metrics.firstTokenAt ?? null,
        metrics.toolCallCount,
        metrics.fileChangeCount,
        metrics.inputTokens ?? null,
        metrics.outputTokens ?? null,
        metrics.costUsd ?? null,
        metrics.outcome ?? null,
      );
  }

  summary(input: { from: number; to: number; projectId?: string }): UsageSummary {
    const scope = input.projectId ? 'AND project_id = ?' : '';
    const args: Array<number | string> = input.projectId
      ? [input.from, input.to, input.projectId]
      : [input.from, input.to];

    // `unixepoch` keeps bucketing in the user's local zone, so a run at 23:30
    // lands on the day they remember doing it.
    const days = (
      this.db
        .prepare(
          `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS date,
                  COUNT(*) AS runs,
                  SUM(input_tokens) AS input_tokens,
                  SUM(output_tokens) AS output_tokens,
                  SUM(cost_usd) AS cost_usd
             FROM run_metrics
            WHERE started_at BETWEEN ? AND ? ${scope}
            GROUP BY date
            ORDER BY date`,
        )
        .all(...args) as unknown as DayRow[]
    ).map((row): UsageDay => ({
      date: row.date,
      runs: row.runs,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      costUsd: row.cost_usd ?? 0,
    }));

    const byModel = (
      this.db
        .prepare(
          `SELECT provider_id, model_id,
                  COUNT(*) AS runs,
                  SUM(input_tokens) AS input_tokens,
                  SUM(output_tokens) AS output_tokens,
                  SUM(cost_usd) AS cost_usd,
                  MAX(started_at) AS last_used_at
             FROM run_metrics
            WHERE started_at BETWEEN ? AND ? ${scope}
            GROUP BY provider_id, model_id
            ORDER BY runs DESC`,
        )
        .all(...args) as unknown as ModelRow[]
    ).map((row): UsageByModel => ({
      providerId: row.provider_id ?? 'unknown',
      modelId: row.model_id ?? 'unknown',
      runs: row.runs,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      costUsd: row.cost_usd ?? 0,
      lastUsedAt: row.last_used_at,
    }));

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS runs,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd) AS cost_usd,
                SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN outcome = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
           FROM run_metrics
          WHERE started_at BETWEEN ? AND ? ${scope}`,
      )
      .get(...args) as unknown as TotalsRow | undefined;

    // Median rather than mean: one 40-minute run should not describe the rest.
    const durations = (
      this.db
        .prepare(
          `SELECT (completed_at - started_at) AS ms
             FROM run_metrics
            WHERE completed_at IS NOT NULL
              AND started_at BETWEEN ? AND ? ${scope}
            ORDER BY ms`,
        )
        .all(...args) as unknown as { ms: number }[]
    ).map((row) => row.ms);

    return {
      from: input.from,
      to: input.to,
      totals: {
        runs: totals?.runs ?? 0,
        inputTokens: totals?.input_tokens ?? 0,
        outputTokens: totals?.output_tokens ?? 0,
        costUsd: totals?.cost_usd ?? 0,
        completed: totals?.completed ?? 0,
        failed: totals?.failed ?? 0,
        cancelled: totals?.cancelled ?? 0,
        medianDurationMs: durations.length
          ? durations[Math.floor((durations.length - 1) / 2)]!
          : null,
      },
      days,
      byModel,
    };
  }
}
