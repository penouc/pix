import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { TerminalCloseResult, TerminalOpenResult, TerminalResizeResult } from '@pi-desktop/protocol';
import {
  AuditLog,
  canonicalizePath,
  isPathInsideWorkspace,
  toWorkspaceRelative,
} from '@pi-desktop/security';
import * as pty from 'node-pty';

import { resolveBashPath } from '../platform/environment.js';
import { killProcessTree } from '../platform/process-tree.js';

export interface PtyDataEvent {
  type: 'terminal.data';
  projectId: string;
  ptySessionId: string;
  sequence: number;
  timestamp: number;
  dataBase64: string;
  data?: string;
}

export interface PtyExitEvent {
  type: 'terminal.exit';
  projectId: string;
  ptySessionId: string;
  sequence: number;
  timestamp: number;
  exitCode: number | null;
  signal?: number | null;
}

export type PtySessionEvent = PtyDataEvent | PtyExitEvent;

interface LiveSession {
  id: string;
  projectId: string;
  workspaceRoot: string;
  cwd: string;
  shell: string;
  process: pty.IPty;
  sequence: number;
  disposed: boolean;
}

const GIT_BASH_MISSING =
  'PiX needs Git Bash for the Terminal. Install Git for Windows: https://git-scm.com/download/win';

/**
 * Persistent interactive PTY sessions for the Terminal panel (ADR-0006).
 *
 * Separate from {@link TerminalService}: the agent bash tool stays on the
 * non-interactive permissioned exec path. Opening a session is user-initiated
 * consent; typed input is not re-approved. Start cwd is confined to the
 * workspace, but a live shell can later `cd` outside — that is documented, not
 * chrooted.
 */
export class PtySessionService {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly audit: AuditLog;

  constructor(
    private readonly options: {
      auditFilePath?: string;
      emit: (event: PtySessionEvent) => void;
    },
  ) {
    this.audit = new AuditLog(options.auditFilePath);
  }

  open(input: {
    projectId: string;
    workspaceRoot: string;
    projectTrusted: boolean;
    cwd?: string;
    cols: number;
    rows: number;
  }): TerminalOpenResult {
    if (!input.projectTrusted) {
      throw new PtySessionError('PROJECT_UNTRUSTED', 'Trust the project before opening a terminal.');
    }

    const cwd = this.resolveCwd(input.workspaceRoot, input.cwd);
    if (!cwd) {
      throw new PtySessionError(
        'CWD_OUTSIDE_WORKSPACE',
        'Working directory is outside the project root.',
      );
    }

    const { file, args, shellLabel } = resolveInteractiveShell();
    const env = buildPtyEnv();

    let process: pty.IPty;
    try {
      process = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: input.cols,
        rows: input.rows,
        cwd,
        env,
        // Raw bytes so ANSI / binary chunks survive IPC as base64.
        encoding: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PtySessionError('PTY_SPAWN_FAILED', `Failed to start shell: ${message}`);
    }

    const sessionId = randomUUID();
    const session: LiveSession = {
      id: sessionId,
      projectId: input.projectId,
      workspaceRoot: input.workspaceRoot,
      cwd,
      shell: shellLabel,
      process,
      sequence: 0,
      disposed: false,
    };
    this.sessions.set(sessionId, session);

    // With `encoding: null`, node-pty delivers Buffer; typings still say string.
    process.onData((chunk: string | Buffer) => {
      if (session.disposed) return;
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
      const dataBase64 = buffer.toString('base64');
      const asText = buffer.toString('utf8');
      // Prefer UTF-8 text when the round-trip is lossless; else base64 only.
      const data = Buffer.from(asText, 'utf8').equals(buffer) ? asText : undefined;
      this.options.emit({
        type: 'terminal.data',
        projectId: session.projectId,
        ptySessionId: session.id,
        sequence: (session.sequence += 1),
        timestamp: Date.now(),
        dataBase64,
        ...(data !== undefined ? { data } : {}),
      });
    });

    process.onExit(({ exitCode, signal }) => {
      if (session.disposed) return;
      session.disposed = true;
      this.sessions.delete(session.id);
      this.audit.append({
        projectId: session.projectId,
        sessionId: session.id,
        runId: `pty-${session.id}`,
        kind: 'execution',
        toolName: 'terminal.pty',
        riskLevel: 'workspace-write',
        outcome: 'executed',
        summary: `PTY session exited (code ${exitCode ?? 'null'})`,
        command: session.shell,
        affectedPaths: [session.cwd],
        reasons: ['Interactive terminal session ended'],
      });
      this.options.emit({
        type: 'terminal.exit',
        projectId: session.projectId,
        ptySessionId: session.id,
        sequence: (session.sequence += 1),
        timestamp: Date.now(),
        exitCode: exitCode ?? null,
        signal: signal ?? null,
      });
    });

    this.audit.append({
      projectId: input.projectId,
      sessionId,
      runId: `pty-${sessionId}`,
      kind: 'execution',
      toolName: 'terminal.pty',
      riskLevel: 'workspace-write',
      outcome: 'executed',
      summary: `Opened interactive PTY in ${toWorkspaceRelative(input.workspaceRoot, cwd) ?? '.'}`,
      command: shellLabel,
      affectedPaths: [cwd],
      reasons: [
        'User opened the Terminal panel',
        'Interactive typing is consent; agent bash policy is unchanged',
      ],
    });

    return {
      sessionId,
      cwd,
      relative: toWorkspaceRelative(input.workspaceRoot, cwd) ?? '.',
      shell: shellLabel,
      cols: input.cols,
      rows: input.rows,
      pid: process.pid,
    };
  }

  write(sessionId: string, payload: { data?: string; dataBase64?: string }): { ok: true } {
    const session = this.requireSession(sessionId);
    if (payload.dataBase64 == null && payload.data == null) {
      throw new PtySessionError('INVALID_WRITE', 'terminal.write requires data or dataBase64.');
    }
    const chunk =
      payload.dataBase64 != null
        ? Buffer.from(payload.dataBase64, 'base64')
        : Buffer.from(payload.data ?? '', 'utf8');
    session.process.write(chunk);
    return { ok: true };
  }

  resize(sessionId: string, cols: number, rows: number): TerminalResizeResult {
    const session = this.requireSession(sessionId);
    session.process.resize(cols, rows);
    return { ok: true, cols, rows };
  }

  close(sessionId: string): TerminalCloseResult {
    const session = this.sessions.get(sessionId);
    if (!session || session.disposed) {
      return { ok: true };
    }
    session.disposed = true;
    this.sessions.delete(sessionId);
    try {
      session.process.kill();
    } catch {
      killProcessTree(session.process.pid);
    }
    this.audit.append({
      projectId: session.projectId,
      sessionId: session.id,
      runId: `pty-${session.id}`,
      kind: 'execution',
      toolName: 'terminal.pty',
      riskLevel: 'workspace-write',
      outcome: 'executed',
      summary: 'Closed interactive PTY session',
      command: session.shell,
      affectedPaths: [session.cwd],
      reasons: ['User closed the terminal tab or disposed the session'],
    });
    return { ok: true };
  }

  /** Kill every live session (window close / project switch). */
  closeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.close(id);
    }
  }

  /** Test helper — live session count. */
  get size(): number {
    return this.sessions.size;
  }

  private requireSession(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.disposed) {
      throw new PtySessionError('PTY_NOT_FOUND', 'Terminal session is no longer available.');
    }
    return session;
  }

  private resolveCwd(workspaceRoot: string, requested?: string): string | null {
    if (!requested || requested === '.') return workspaceRoot;
    const absolute = path.isAbsolute(requested) ? requested : path.join(workspaceRoot, requested);
    const canonical = canonicalizePath(workspaceRoot, absolute);
    if (!isPathInsideWorkspace(workspaceRoot, canonical)) return null;
    return canonical;
  }
}

export class PtySessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PtySessionError';
  }
}

/**
 * Resolve the interactive login shell for the Terminal panel.
 *
 * Windows uses Git Bash so the dialect matches the agent bash tool. Unix uses
 * `$SHELL` when it exists, otherwise bash then zsh.
 */
export function resolveInteractiveShell(): {
  file: string;
  args: string[];
  shellLabel: string;
} {
  if (process.platform === 'win32') {
    const bashPath = resolveBashPath();
    if (!bashPath) {
      throw new PtySessionError('BASH_NOT_FOUND', GIT_BASH_MISSING);
    }
    // Login + interactive so profile scripts and job control behave like a
    // real terminal tab, not `bash -c one-shot`.
    return { file: bashPath, args: ['-l', '-i'], shellLabel: bashPath };
  }

  const fromEnv = process.env.SHELL?.trim();
  const candidates = [fromEnv, '/bin/bash', '/bin/zsh', '/bin/sh'].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { file: candidate, args: ['-l'], shellLabel: candidate };
    }
  }
  throw new PtySessionError('SHELL_NOT_FOUND', 'No interactive shell found (tried $SHELL, bash, zsh).');
}

function buildPtyEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = env.COLORTERM || 'truecolor';
  // Drop the one-shot runner's anti-color flags if a parent shell set them.
  delete env.NO_COLOR;
  delete env.CI;
  return env;
}
