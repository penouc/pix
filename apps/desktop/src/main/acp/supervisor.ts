import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

import type { HistoryAgentId } from '@pi-desktop/protocol';

import { getAcpAgent } from './detect.js';

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export type AcpPermissionRequest = {
  requestId: string;
  runId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind?: string }>;
  resolve: (optionId: string) => void;
};

export type AcpRunEvent =
  | { type: 'text'; runId: string; text: string }
  | { type: 'thinking'; runId: string; text: string }
  | { type: 'tool'; runId: string; tool: string; detail?: string }
  | { type: 'permission'; request: AcpPermissionRequest }
  | { type: 'done'; runId: string; sessionId: string | null }
  | { type: 'error'; runId: string; message: string };

/**
 * Minimal ACP client over newline-delimited JSON-RPC stdio.
 * Prefer this thin client so we can map session/request_permission into PiX's
 * ApprovalDialog — never auto-approve.
 */
class AcpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  onUpdate: (update: Record<string, unknown>) => void = () => {};
  onRequest: (method: string, params: unknown) => Promise<unknown> = async () => ({});

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.proc = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', (chunk: Buffer) => {
      // Keep stderr visible for diagnosing adapter failures.
      process.stderr.write(chunk);
    });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        return;
      }
      void this.handle(msg);
    });
  }

  private async handle(msg: JsonRpc): Promise<void> {
    if (msg.id != null && (msg.result !== undefined || msg.error)) {
      const id = typeof msg.id === 'string' ? Number(msg.id) : msg.id;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/update') {
      this.onUpdate((msg.params ?? {}) as Record<string, unknown>);
      return;
    }
    if (msg.method && msg.id != null) {
      try {
        const result = await this.onRequest(msg.method, msg.params);
        this.send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (err) {
        this.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  private send(payload: JsonRpc): void {
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  initialize(): Promise<{
    authMethods?: Array<{ id: string; name?: string }>;
    agentCapabilities?: Record<string, unknown>;
  }> {
    return this.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'pix', version: '0.6.3' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
    });
  }

  authenticate(methodId: string): Promise<unknown> {
    return this.request('authenticate', { methodId });
  }

  sessionNew(cwd: string): Promise<{ sessionId: string }> {
    return this.request('session/new', { cwd, mcpServers: [] });
  }

  sessionLoad(sessionId: string, cwd: string): Promise<unknown> {
    return this.request('session/load', { sessionId, cwd, mcpServers: [] });
  }

  sessionPrompt(sessionId: string, text: string): Promise<unknown> {
    return this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  kill(): void {
    try {
      this.proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

export interface AcpStartInput {
  agent: HistoryAgentId;
  cwd: string;
  /** Empty = connect/resume only; first turn comes via prompt(). */
  prompt?: string;
  resumeSessionId?: string;
  /** Caller-supplied id so UI can bind stream events before spawn returns. */
  runId?: string;
  onEvent: (event: AcpRunEvent) => void;
}

export interface AcpRunHandle {
  runId: string;
  agent: HistoryAgentId;
  sessionId: string | null;
  prompt: (text: string) => Promise<void>;
  abort: () => void;
}

/**
 * Spawns and drives one ACP agent session. Permission prompts are forwarded
 * via onEvent — the caller must resolve them (never auto-allow).
 */
export class AcpSupervisor {
  private runs = new Map<
    string,
    {
      client: AcpClient;
      sessionId: string | null;
      agent: HistoryAgentId;
      onEvent: (event: AcpRunEvent) => void;
    }
  >();
  private permissions = new Map<string, AcpPermissionRequest>();

  async start(input: AcpStartInput): Promise<AcpRunHandle> {
    const info = await getAcpAgent(input.agent);
    if (!info?.available) {
      throw new Error(`${input.agent} is not available on this machine`);
    }
    // OMP JSON one-shot is not full ACP — reject interactive resume for now.
    if (input.agent === 'omp') {
      throw new Error('Oh My Pi runs via terminal resume in this build; ACP drive is not wired yet');
    }

    const runId = input.runId ?? randomUUID();
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(info.env ?? {}),
    };
    const client = new AcpClient(info.command, info.args, input.cwd, childEnv);
    this.runs.set(runId, {
      client,
      sessionId: null,
      agent: input.agent,
      onEvent: input.onEvent,
    });

    client.onUpdate = (params) => {
      const update = (params.update ?? params) as Record<string, unknown>;
      const kind = String(update.sessionUpdate ?? update.type ?? '');
      if (kind === 'agent_message_chunk' || kind === 'message' || kind === 'agent_message') {
        const content = update.content as { text?: string } | string | undefined;
        const text =
          typeof content === 'string'
            ? content
            : typeof content?.text === 'string'
              ? content.text
              : typeof update.text === 'string'
                ? update.text
                : '';
        if (text) input.onEvent({ type: 'text', runId, text });
        return;
      }
      if (kind === 'agent_thought_chunk' || kind === 'thought') {
        const content = update.content as { text?: string } | undefined;
        const text = content?.text ?? (typeof update.text === 'string' ? update.text : '');
        if (text) input.onEvent({ type: 'thinking', runId, text });
        return;
      }
      if (kind === 'tool_call' || kind === 'tool_call_update') {
        const title = String(update.title ?? update.tool ?? update.name ?? 'tool');
        input.onEvent({ type: 'tool', runId, tool: title });
      }
    };

    client.onRequest = async (method, params) => {
      if (method === 'session/request_permission') {
        return this.handlePermission(runId, params, input.onEvent);
      }
      if (method === 'fs/read_text_file') {
        const p = params as { path?: string };
        if (!p.path) throw new Error('missing path');
        const { readFileSync } = await import('node:fs');
        return { content: readFileSync(p.path, 'utf8') };
      }
      if (method === 'fs/write_text_file') {
        const p = params as { path?: string; content?: string };
        if (!p.path) throw new Error('missing path');
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { dirname } = await import('node:path');
        mkdirSync(dirname(p.path), { recursive: true });
        writeFileSync(p.path, p.content ?? '', 'utf8');
        return {};
      }
      return {};
    };

    try {
      const init = await client.initialize();
      const methods = init.authMethods ?? [];
      if (methods.length > 0) {
        // Prefer non-interactive methods; never invent credentials.
        const preferred =
          methods.find((m) => m.id.includes('api_key')) ??
          methods.find((m) => m.id.includes('token')) ??
          methods[0];
        if (preferred) {
          try {
            await client.authenticate(preferred.id);
          } catch {
            /* some agents auth via CLI already */
          }
        }
      }

      let sessionId: string | null = null;
      if (input.resumeSessionId) {
        try {
          await client.sessionLoad(input.resumeSessionId, input.cwd);
          sessionId = input.resumeSessionId;
        } catch {
          const created = await client.sessionNew(input.cwd);
          sessionId = created.sessionId;
        }
      } else {
        const created = await client.sessionNew(input.cwd);
        sessionId = created.sessionId;
      }
      const run = this.runs.get(runId);
      if (run) run.sessionId = sessionId;

      const firstPrompt = input.prompt?.trim() ?? '';
      if (firstPrompt) {
        // Return the handle immediately — awaiting the prompt would block IPC
        // until the whole turn finishes, so the UI never switches.
        this.queuePrompt(runId, firstPrompt);
      }
    } catch (err) {
      input.onEvent({
        type: 'error',
        runId,
        message: err instanceof Error ? err.message : String(err),
      });
      input.onEvent({ type: 'done', runId, sessionId: this.runs.get(runId)?.sessionId ?? null });
      client.kill();
      this.runs.delete(runId);
    }

    return {
      runId,
      agent: input.agent,
      sessionId: this.runs.get(runId)?.sessionId ?? null,
      prompt: (text: string) => this.prompt(runId, text),
      abort: () => this.abort(runId),
    };
  }

  /** Send a follow-up (or first) turn on an already-connected ACP run. */
  async prompt(runId: string, text: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run?.sessionId) throw new Error('ACP run is not active');
    this.queuePrompt(runId, text);
  }

  private queuePrompt(runId: string, text: string): void {
    const run = this.runs.get(runId);
    if (!run?.sessionId) throw new Error('ACP run is not active');
    const { client, sessionId, onEvent } = run;
    void client
      .sessionPrompt(sessionId, text)
      .then(() => {
        onEvent({ type: 'done', runId, sessionId });
      })
      .catch((err) => {
        onEvent({
          type: 'error',
          runId,
          message: err instanceof Error ? err.message : String(err),
        });
        onEvent({ type: 'done', runId, sessionId });
        // Keep the process alive for another try unless the session is gone.
      });
  }

  abort(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.client.kill();
    this.runs.delete(runId);
    for (const [id, req] of this.permissions) {
      if (req.runId === runId) {
        req.resolve('cancel');
        this.permissions.delete(id);
      }
    }
  }

  resolvePermission(requestId: string, optionId: string): boolean {
    const req = this.permissions.get(requestId);
    if (!req) return false;
    req.resolve(optionId);
    this.permissions.delete(requestId);
    return true;
  }

  private handlePermission(
    runId: string,
    params: unknown,
    onEvent: (event: AcpRunEvent) => void,
  ): Promise<{ outcome: { outcome: string; optionId?: string } }> {
    const p = (params ?? {}) as {
      toolCall?: { title?: string; kind?: string };
      options?: Array<{ optionId: string; name: string; kind?: string }>;
    };
    const requestId = randomUUID();
    const options =
      p.options?.length
        ? p.options
        : [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ];

    return new Promise((resolve) => {
      const request: AcpPermissionRequest = {
        requestId,
        runId,
        title: p.toolCall?.title ?? 'Agent requests permission',
        options,
        resolve: (optionId: string) => {
          if (optionId === 'cancel' || optionId.startsWith('reject')) {
            resolve({ outcome: { outcome: 'rejected' } });
          } else {
            resolve({ outcome: { outcome: 'selected', optionId } });
          }
        },
      };
      this.permissions.set(requestId, request);
      onEvent({ type: 'permission', request });
    });
  }
}
