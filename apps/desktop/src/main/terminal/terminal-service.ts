import { spawn } from 'node:child_process';
import path from 'node:path';

import type { ApprovalDecision, TerminalResult } from '@pi-desktop/protocol';
import {
  PermissionPipeline,
  canonicalizePath,
  isPathInsideWorkspace,
  type ApprovalRequestDraft,
  type PolicyContext,
} from '@pi-desktop/security';

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
 * Runs a command the *user* typed in the Terminal panel.
 *
 * It is not a free shell: every command goes through the same
 * normalize → classify → policy → audit pipeline as an agent tool call, so
 * protected paths, workspace escapes and high-risk side effects are refused or
 * held for approval exactly as they are for the agent. There is no PTY, so no
 * interactive programs — one command, captured output.
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
      this.options.requestApproval({
        requestId,
        draft: decision.request,
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        runId: ctx.runId,
      });
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

  /** Resolve and confine the requested cwd to the workspace. */
  private resolveCwd(workspaceRoot: string, requested?: string): string | null {
    if (!requested || requested === '.') return workspaceRoot;
    const absolute = path.isAbsolute(requested) ? requested : path.join(workspaceRoot, requested);
    const canonical = canonicalizePath(workspaceRoot, absolute);
    if (!isPathInsideWorkspace(canonical, workspaceRoot)) return null;
    return canonical;
  }

  private spawnCapped(
    command: string,
    cwd: string,
  ): Promise<{ exitCode: number | null; output: string; truncated: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(command, {
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
        killTree(child.pid);
        finish(null, `… killed after ${DEFAULT_TIMEOUT_MS / 1000}s`);
      }, DEFAULT_TIMEOUT_MS);

      child.on('error', (error) => finish(null, `failed to start: ${error.message}`));
      child.on('close', (code) => finish(code));
    });
  }
}

function killTree(pid: number | undefined) {
  if (pid == null) return;
  try {
    // Negative pid targets the whole process group created by `detached`.
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
