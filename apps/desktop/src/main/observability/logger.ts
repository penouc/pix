import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

import { redactSecrets } from '@pi-desktop/security';

/** Maximum size of a single log file before rotation. */
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

type LogLevel = 'info' | 'warn' | 'error';

interface LogRecord {
  level: LogLevel;
  time: number;
  msg: string;
  [key: string]: unknown;
}

/**
 * Structured NDJSON logger for Electron Main process (plan §14 / M8-2).
 * Writes one JSON line per call to a rotating file under app.getPath('logs').
 * Applies redactSecrets to all log messages before writing.
 */
export class DesktopLogger {
  private readonly logPath: string;

  constructor(logsDir: string) {
    mkdirSync(logsDir, { recursive: true });
    this.logPath = path.join(logsDir, 'pi-desktop.jsonl');
  }

  write(level: LogLevel, ...args: unknown[]): void {
    const msg = args
      .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
      .join(' ');
    this.append({ level, time: Date.now(), msg: redactSecrets(msg) });
  }

  /** Return absolute path of the current log file. */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Override console.warn/error/log in the current process so all existing
   * calls automatically flow into the structured log.
   */
  install(): void {
    const baseConsole = globalThis.console;
    const orig = {
      log: baseConsole.log.bind(baseConsole),
      warn: baseConsole.warn.bind(baseConsole),
      error: baseConsole.error.bind(baseConsole),
    };
    baseConsole.log = (...args: unknown[]) => {
      orig.log(...args);
      this.write('info', ...args);
    };
    baseConsole.warn = (...args: unknown[]) => {
      orig.warn(...args);
      this.write('warn', ...args);
    };
    baseConsole.error = (...args: unknown[]) => {
      orig.error(...args);
      this.write('error', ...args);
    };
  }

  private append(record: LogRecord): void {
    try {
      try {
        if (statSync(this.logPath).size > MAX_LOG_FILE_BYTES) {
          renameSync(this.logPath, this.logPath + '.1');
        }
      } catch {
        // file not yet created — that's fine
      }
      appendFileSync(this.logPath, JSON.stringify(record) + '\n', 'utf8');
    } catch {
      // best-effort; never throw from logging
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
