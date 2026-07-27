import type { DesktopAgentEvent } from '@pi-desktop/protocol';
import type { RunMetrics } from '@pi-desktop/protocol';

/**
 * In-memory store for per-run metrics (plan §14 / M8-2).
 * Updated by observing agent events; completed entries are kept for the session.
 */
/** Token/cost figures the provider reported, kept alongside the run. */
export type RunMetricsWithUsage = RunMetrics & {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export class RunMetricsStore {
  private readonly active = new Map<string, RunMetricsWithUsage>();
  private readonly completed: RunMetricsWithUsage[] = [];
  private readonly MAX_COMPLETED = 100;
  /**
   * Called once per finished run so Main can persist it. In-memory alone meant
   * every usage figure reset on restart.
   */
  onFinished?: (metrics: RunMetricsWithUsage) => void;

  observe(event: DesktopAgentEvent): void {
    switch (event.type) {
      case 'run.started': {
        this.active.set(event.runId, {
          runId: event.runId,
          sessionId: event.sessionId,
          projectId: event.projectId,
          providerId: event.model?.providerId,
          modelId: event.model?.modelId,
          startedAt: event.timestamp,
          toolCallCount: 0,
          fileChangeCount: 0,
        });
        break;
      }
      case 'message.delta': {
        const m = this.active.get(event.runId);
        if (m && !m.firstTokenAt) {
          m.firstTokenAt = event.timestamp;
        }
        break;
      }
      case 'tool.requested': {
        const m = this.active.get(event.runId);
        if (m) m.toolCallCount++;
        break;
      }
      case 'tool.completed': {
        const m = this.active.get(event.runId);
        if (m && event.toolName && (event.toolName === 'write' || event.toolName === 'edit')) {
          if (event.ok) m.fileChangeCount++;
        }
        break;
      }
      case 'usage.updated': {
        const m = this.active.get(event.runId);
        if (m) {
          // Pi reports per assistant turn; sum across tool loops in one run.
          if (event.inputTokens != null) m.inputTokens = (m.inputTokens ?? 0) + event.inputTokens;
          if (event.outputTokens != null)
            m.outputTokens = (m.outputTokens ?? 0) + event.outputTokens;
          if (event.costUsd != null) m.costUsd = (m.costUsd ?? 0) + event.costUsd;
        }
        break;
      }
      case 'run.completed': {
        this.finish(event.runId, 'completed', event.timestamp);
        break;
      }
      case 'run.failed': {
        this.finish(event.runId, 'failed', event.timestamp);
        break;
      }
      case 'run.cancelled': {
        this.finish(event.runId, 'cancelled', event.timestamp);
        break;
      }
    }
  }

  get(runId: string): RunMetricsWithUsage | undefined {
    return this.active.get(runId) ?? this.completed.find((m) => m.runId === runId);
  }

  listCompleted(): RunMetricsWithUsage[] {
    return [...this.completed];
  }

  private finish(runId: string, outcome: RunMetrics['outcome'], timestamp: number): void {
    const m = this.active.get(runId);
    if (!m) return;
    m.completedAt = timestamp;
    m.outcome = outcome;
    this.active.delete(runId);
    this.completed.push(m);
    if (this.completed.length > this.MAX_COMPLETED) {
      this.completed.shift();
    }
    this.onFinished?.(m);
  }
}
