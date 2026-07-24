import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { AuditEntry } from './types.js';

/**
 * Append-only audit log (plan §9.3). Never writes raw secrets — callers must summarize.
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly filePath?: string) {
    if (filePath) {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  append(partial: Omit<AuditEntry, 'id' | 'timestamp'> & { timestamp?: number }): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: partial.timestamp ?? Date.now(),
      ...partial,
    };
    this.entries.push(entry);
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        // best-effort
      }
    }
    return entry;
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit);
  }
}

/** Redact common secret patterns from free text before logging. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[\w.-]+/gi, '$1=***')
    .replace(/\b(sk-[a-zA-Z0-9]{10,})\b/g, 'sk-***')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
}
