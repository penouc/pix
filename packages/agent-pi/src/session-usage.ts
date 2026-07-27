/** One billable assistant turn parsed from a Pi session JSONL file. */
export interface SessionLogUsageEntry {
  runId: string;
  sessionId: string;
  projectId: string;
  providerId: string;
  modelId: string;
  startedAt: number;
  completedAt: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface SessionLogFileMeta {
  sessionId: string;
  cwd: string;
}

/** Stable run id for rows imported from session logs (distinct from live UUID runs). */
export function sessionLogRunId(messageLineId: string): string {
  return `session-log:${messageLineId}`;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Map Pi assistant `usage` objects into normalized token/cost fields. */
export function extractUsage(usage: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
} | null {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;

  const inputTokens = pickNumber(record, ['input', 'inputTokens', 'input_tokens']);
  const outputTokens = pickNumber(record, ['output', 'outputTokens', 'output_tokens']);
  const totalTokens = pickNumber(record, ['totalTokens', 'total_tokens', 'total']);

  let costUsd: number | undefined;
  const cost = record['cost'];
  if (typeof cost === 'number' && Number.isFinite(cost)) {
    costUsd = cost;
  } else if (cost && typeof cost === 'object') {
    costUsd = pickNumber(cost as Record<string, unknown>, ['total', 'totalUsd', 'usd']);
  }

  if (
    inputTokens == null &&
    outputTokens == null &&
    totalTokens == null &&
    costUsd == null
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : undefined),
    costUsd,
  };
}

function parseTimestamp(value: unknown, fallbackIso?: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof fallbackIso === 'string') {
    const parsed = Date.parse(fallbackIso);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Parse new JSONL lines from a Pi desktop session file.
 * Returns entries and the number of lines consumed from the input batch.
 */
export function parseSessionLogLines(
  lines: string[],
  meta: SessionLogFileMeta,
  resolveProjectId: (sessionId: string, cwd: string) => string | null,
): SessionLogUsageEntry[] {
  const projectId = resolveProjectId(meta.sessionId, meta.cwd);
  if (!projectId) return [];

  const entries: SessionLogUsageEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (row['type'] !== 'message') continue;
    const message = row['message'];
    if (!message || typeof message !== 'object') continue;
    const msg = message as Record<string, unknown>;
    if (msg['role'] !== 'assistant') continue;

    const usage = extractUsage(msg['usage']);
    if (!usage) continue;

    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    if (inputTokens + outputTokens <= 0 && (usage.costUsd ?? 0) <= 0) continue;

    const lineId = typeof row['id'] === 'string' ? row['id'] : null;
    if (!lineId) continue;

    const providerId = typeof msg['provider'] === 'string' ? msg['provider'] : 'unknown';
    const modelId = typeof msg['model'] === 'string' ? msg['model'] : 'unknown';
    const when = parseTimestamp(
      msg['timestamp'],
      typeof row['timestamp'] === 'string' ? row['timestamp'] : undefined,
    );

    entries.push({
      runId: sessionLogRunId(lineId),
      sessionId: meta.sessionId,
      projectId,
      providerId,
      modelId,
      startedAt: when,
      completedAt: when,
      inputTokens,
      outputTokens,
      costUsd: usage.costUsd ?? 0,
    });
  }

  return entries;
}

/** Read the session header from the first lines of a Pi session file. */
export function readSessionLogMeta(lines: string[]): SessionLogFileMeta | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      if (row['type'] !== 'session') continue;
      const sessionId = typeof row['id'] === 'string' ? row['id'] : null;
      const cwd = typeof row['cwd'] === 'string' ? row['cwd'] : '';
      if (!sessionId) return null;
      return { sessionId, cwd };
    } catch {
      continue;
    }
  }
  return null;
}
