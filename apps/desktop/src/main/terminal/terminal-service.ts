import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { ApprovalDecision, TerminalCwdResult, TerminalResult } from '@pi-desktop/protocol';
import {
  PermissionPipeline,
  canonicalizePath,
  isPathInsideWorkspace,
  toWorkspaceRelative,
  type ApprovalRequestDraft,
  type PolicyContext,
} from '@pi-desktop/security';

import { resolveBashPath } from '../platform/environment.js';
import { killProcessTree } from '../platform/process-tree.js';

/** UI keeps the tail; anything longer is cut with an explicit marker (plan §14.1). */
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface TerminalApprovalRequest {
  requestId: string;
  draft: ApprovalRequestDraft;
  projectId: string;
  /**
   * Scope carried through so the Renderer's event filter accepts it. The store
   * also exempts approvals from run scoping — a dropped approval would leave
   * this command waiting forever.
   */
  sessionId: string;
  runId: string;
}

/**
 * Non-interactive one-shot command runner (policy + capped capture).
 *
 * The Terminal panel uses PtySessionService for interactive PTY sessions
 * (ADR-0006). This class remains for any caller that still needs a single
 * audited `spawn` with workspace-confined cwd — it is not the UI shell.
 */
export class TerminalService {
  private readonly pipeline: PermissionPipeline;

  constructor(
    private readonly options: {
      auditFilePath?: string;
      /** Emits an approval request to the Renderer; resolved via resolveApproval. */
      requestApproval: (request: TerminalApprovalRequest) => void;
    },
  ) {
    this.pipeline = new PermissionPipeline({ auditFilePath: options.auditFilePath });
  }

  /** Keeps the Terminal panel in step with the session approval mode. */
  setApprovalMode(mode: 'ask' | 'auto-reads' | 'read-only'): void {
    this.pipeline.policy.setDefaultMode(mode);
  }

  /** Lets Main route a Renderer decision to this pipeline. */
  resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
    return this.pipeline.resolve(requestId, decision);
  }

  async exec(input: {
    projectId: string;
    workspaceRoot: string;
    projectTrusted: boolean;
    command: string;
    cwd?: string;
    sessionId?: string;
  }): Promise<TerminalResult> {
    const startedAt = Date.now();
    const cwd = this.resolveCwd(input.workspaceRoot, input.cwd);
    if (!cwd) {
      return {
        command: input.command,
        cwd: input.cwd ?? '.',
        outcome: 'denied',
        exitCode: null,
        output: '',
        truncated: false,
        durationMs: 0,
        reason: 'Working directory is outside the project root.',
      };
    }

    const ctx: PolicyContext = {
      projectId: input.projectId,
      sessionId: input.sessionId ?? 'terminal',
      runId: `terminal-${startedAt}`,
      workspaceRoot: input.workspaceRoot,
      projectTrusted: input.projectTrusted,
    };

    const decision = this.pipeline.evaluate({
      toolCallId: ctx.runId,
      toolName: 'bash',
      args: { command: input.command, cwd },
      ctx,
    });

    if (decision.action === 'deny') {
      return {
        command: input.command,
        cwd,
        outcome: 'denied',
        exitCode: null,
        output: '',
        truncated: false,
        durationMs: Date.now() - startedAt,
        reason: decision.message,
      };
    }

    if (decision.action === 'require-approval') {
      const { requestId, decision: pending } = this.pipeline.requestApproval(
        ctx,
        decision.tool,
        decision.request,
        decision.assessment,
      );
      /*
       * A command the user typed is not asked about.
       *
       * Approval exists to put a person in the loop when the *agent* wants to
       * act. Here the person is the one acting — the keystroke is the consent —
       * so a dialog asking them to confirm their own `ls` has nobody on the other
       * side of it. It still goes through requestApproval/resolve rather than
       * around them, so the audit log records the command and an explicit
       * decision instead of silently gaining a blind spot.
       *
       * Policy *denials* are untouched: a protected path or a workspace escape is
       * still refused above, before this point.
       */
      this.pipeline.resolve(requestId, 'allow-once');
      const answer = await pending;
      if (answer === 'deny') {
        return {
          command: input.command,
          cwd,
          outcome: 'cancelled',
          exitCode: null,
          output: '',
          truncated: false,
          durationMs: Date.now() - startedAt,
          reason: 'You denied this command.',
        };
      }
    }

    const run = await this.spawnCapped(input.command, cwd);
    return {
      command: input.command,
      cwd,
      outcome: 'ran',
      exitCode: run.exitCode,
      output: run.output,
      truncated: run.truncated,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Move a terminal tab to another directory.
   *
   * `cd` cannot be executed: each command runs in its own subshell, so a `cd`
   * there would be undone the moment the shell exits. The directory therefore
   * lives in the tab, and this resolves the target against the same confinement
   * rule every command path uses. `~` means the project root, not `$HOME` —
   * nothing outside the workspace is reachable anyway, so pointing it at the
   * root is the only reading that does something useful.
   */
  async changeDirectory(input: {
    workspaceRoot: string;
    cwd?: string;
    target: string;
  }): Promise<TerminalCwdResult> {
    const from = this.resolveCwd(input.workspaceRoot, input.cwd) ?? input.workspaceRoot;
    const stay = (reason: string): TerminalCwdResult => ({
      outcome: 'refused',
      cwd: from,
      // The root can itself be reached through a symlink (/var vs /private/var);
      // toWorkspaceRelative resolves both sides before comparing.
      relative: toWorkspaceRelative(input.workspaceRoot, from) ?? '.',
      reason,
    });

    const raw = input.target.trim().replace(/^['"]|['"]$/g, '');
    const requested =
      raw === '' || raw === '~' || raw === '~/'
        ? input.workspaceRoot
        : path.isAbsolute(raw)
          ? raw
          : path.join(from, raw);

    const canonical = canonicalizePath(input.workspaceRoot, requested);
    if (!isPathInsideWorkspace(input.workspaceRoot, canonical)) {
      return stay('That directory is outside the project root.');
    }

    try {
      const stats = await stat(canonical);
      if (!stats.isDirectory()) return stay(`Not a directory: ${raw}`);
    } catch {
      return stay(`No such directory: ${raw}`);
    }

    return {
      outcome: 'changed',
      cwd: canonical,
      relative: toWorkspaceRelative(input.workspaceRoot, canonical) ?? '.',
    };
  }

  /**
   * Resolve and confine the requested cwd to the workspace.
   *
   * `isPathInsideWorkspace` takes (root, target) — the arguments used to be
   * reversed here, which asked whether the *root* was inside the requested
   * directory. Every ancestor of the project therefore passed, so a cwd of `/`
   * or the user's home would have been accepted and the command would have run
   * outside the workspace.
   */
  private resolveCwd(workspaceRoot: string, requested?: string): string | null {
    if (!requested || requested === '.') return workspaceRoot;
    const absolute = path.isAbsolute(requested) ? requested : path.join(workspaceRoot, requested);
    const canonical = canonicalizePath(workspaceRoot, absolute);
    if (!isPathInsideWorkspace(workspaceRoot, canonical)) return null;
    return canonical;
  }

  private spawnCapped(
    command: string,
    cwd: string,
  ): Promise<{ exitCode: number | null; output: string; truncated: boolean }> {
    // Windows: run through Git Bash so the user's Terminal speaks the same
    // dialect as the agent's bash tool (plan: Windows support). The same policy
    // classifier therefore recognises `rm -rf`, `curl`, `git push` … whether
    // typed or issued by the model. cmd.exe/PowerShell syntax would slip past
    // those rules. When bash is genuinely absent, fail loudly instead of
    // silently switching to cmd.
    const bashPath = process.platform === 'win32' ? resolveBashPath() : null;
    if (process.platform === 'win32' && !bashPath) {
      return Promise.resolve({
        exitCode: null,
        output:
          'PiX needs Git Bash to run commands. Install Git for Windows: ' +
          'https://git-scm.com/download/win',
        truncated: false,
      });
    }

    return new Promise((resolve) => {
      const child =
        process.platform === 'win32'
          ? spawn(bashPath as string, ['-c', command], {
              cwd,
              // Own process tree so a timeout can take everything down (M8-1).
              detached: true,
              windowsHide: true,
              env: { ...process.env, TERM: 'dumb', CI: '1', NO_COLOR: '1' },
            })
          : spawn(command, {
              cwd,
              shell: true,
              // Own process group so a timeout can take the whole tree down (M8-1).
              detached: true,
              env: { ...process.env, TERM: 'dumb', CI: '1', NO_COLOR: '1' },
            });

      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      let settled = false;

      const collect = (chunk: Buffer) => {
        if (truncated) return;
        size += chunk.length;
        chunks.push(chunk);
        if (size > MAX_OUTPUT_BYTES) truncated = true;
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);

      const finish = (exitCode: number | null, note?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        let output = Buffer.concat(chunks).toString('utf8');
        if (truncated) {
          output = `${output.slice(-MAX_OUTPUT_BYTES)}\n… output truncated at ${MAX_OUTPUT_BYTES} bytes`;
        }
        resolve({ exitCode, output: note ? `${output}\n${note}` : output, truncated });
      };

      const timer = setTimeout(() => {
        killProcessTree(child.pid);
        finish(null, `… killed after ${DEFAULT_TIMEOUT_MS / 1000}s`);
      }, DEFAULT_TIMEOUT_MS);

      child.on('error', (error) => finish(null, `failed to start: ${error.message}`));
      child.on('close', (code) => finish(code));
    });
  }
}
