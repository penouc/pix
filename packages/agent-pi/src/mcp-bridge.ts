import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/*
 * #19 — MCP bridge (self-built, permission-pipeline-gated).
 *
 * Reads MCP server config for a project (`.pi-desktop/mcp.json`, or an
 * injected config) and exposes every tool the servers advertise as Pi custom
 * tools, named `mcp__<server>__<tool>`.
 *
 *   - Fail-closed: only tools the server actually lists are registered. A
 *     server that fails to connect/list contributes nothing (and logs); the
 *     session still starts. Unknown tool names are never invented.
 *   - Every mcp_* tool is classified `sensitive` by the risk classifier
 *     (unknown-prefix default → approval-required in Ask mode, blocked in
 *     Plan Mode). Servers can opt a narrower risk via config.
 *   - Process lifecycle: `dispose()` closes every client, which kills the
 *     child process (StdioClientTransport.close kills the spawned command).
 *     Per-call aborts forward the run's AbortSignal to the MCP call.
 *
 * The bridge connects during the extension factory (which the SDK awaits
 * during `resourceLoader.reload()`), and the runtime then folds the
 * discovered tool names into the session's `tools` allowlist — because the
 * SDK's `tools` option is an allowlist, dynamic names must be enumerated.
 */

export interface McpServerConfig {
  /** Stable server id used in tool names: mcp__<id>__<tool>. */
  id: string;
  /** Executable to spawn (stdio transport). */
  command: string;
  args?: string[];
  /** Extra env vars merged over the process env. */
  env?: Record<string, string>;
  /** Working directory for the child process. Defaults to the project. */
  cwd?: string;
  /**
   * Risk level for this server's tools. Default `sensitive`.
   * Allowed: 'safe' | 'workspace-write' | 'sensitive' | 'external-side-effect'.
   */
  risk?: 'safe' | 'workspace-write' | 'sensitive' | 'external-side-effect';
  /** Keep the default timeout per call (ms). Default 60_000. */
  timeoutMs?: number;
}

export interface McpBridgeOptions {
  servers: McpServerConfig[];
  /** cwd passed to the extension factory (project root). */
  projectPath: string;
  /** When true, servers are not actually spawned; dryTools provide tools. */
  dryRun?: boolean;
  /** Tools to expose per server id in dryRun mode: id → Tool[]. */
  dryTools?: Record<string, Tool[]>;
  /** Called with server-id → error when a server fails to start. */
  onError?: (serverId: string, error: Error) => void;
}

/**
 * Load `.pi-desktop/mcp.json` for a project. Missing / invalid files yield an
 * empty list so sessions still start (fail-closed for MCP, not for the app).
 *
 * Accepted shapes:
 *   { "servers": [ { "id", "command", "args"? } ] }
 *   [ { "id", "command", ... } ]
 */
export function loadMcpConfig(projectPath: string): McpServerConfig[] {
  const file = path.join(projectPath, '.pi-desktop', 'mcp.json');
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { servers?: unknown }).servers)
        ? (parsed as { servers: unknown[] }).servers
        : null;
    if (!list) return [];
    const servers: McpServerConfig[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id.trim() : '';
      const command = typeof rec.command === 'string' ? rec.command.trim() : '';
      if (!id || !command) continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
      servers.push({
        id,
        command,
        ...(Array.isArray(rec.args)
          ? { args: rec.args.filter((a): a is string => typeof a === 'string') }
          : {}),
        ...(rec.env && typeof rec.env === 'object' && !Array.isArray(rec.env)
          ? {
              env: Object.fromEntries(
                Object.entries(rec.env as Record<string, unknown>).filter(
                  (e): e is [string, string] => typeof e[1] === 'string',
                ),
              ),
            }
          : {}),
        ...(typeof rec.cwd === 'string' ? { cwd: rec.cwd } : {}),
        ...(rec.risk === 'safe' ||
        rec.risk === 'workspace-write' ||
        rec.risk === 'sensitive' ||
        rec.risk === 'external-side-effect'
          ? { risk: rec.risk }
          : {}),
        ...(typeof rec.timeoutMs === 'number' && Number.isFinite(rec.timeoutMs)
          ? { timeoutMs: Math.max(1_000, Math.floor(rec.timeoutMs)) }
          : {}),
      });
    }
    return servers;
  } catch {
    return [];
  }
}

interface ConnectedServer {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class McpBridge {
  private readonly servers: McpServerConfig[];
  private readonly projectPath: string;
  private readonly dryRun: boolean;
  private readonly onError: (serverId: string, error: Error) => void;
  private readonly dryTools: Record<string, Tool[]>;
  private connected: ConnectedServer[] = [];
  /** tool name → server + tool for dispatch. */
  private readonly registry = new Map<string, { server: ConnectedServer; tool: Tool }>();
  private started = false;

  constructor(options: McpBridgeOptions) {
    this.servers = options.servers;
    this.projectPath = options.projectPath;
    this.dryRun = options.dryRun ?? false;
    this.dryTools = options.dryTools ?? {};
    this.onError = options.onError ?? ((id, error) => console.warn(`[McpBridge] ${id} failed:`, error.message));
  }

  /** Names of every registered mcp_* tool (for the session `tools` allowlist). */
  toolNames(): string[] {
    return [...this.registry.keys()];
  }

  /**
   * Connect every server and register its tools with the extension API.
   * Fail-closed: a failing server is skipped, never fatal.
   */
  async registerTools(pi: ExtensionAPI): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const config of this.servers) {
      try {
        const server = await this.connectServer(config);
        this.connected.push(server);
        for (const tool of server.tools) {
          const name = `mcp__${config.id}__${tool.name}`;
          this.registry.set(name, { server, tool });
          pi.registerTool(
            createMcpTool(
              name,
              config,
              tool,
              (args, signal) =>
                this.call(name, args, signal, config.timeoutMs),
            ),
          );
        }
      } catch (error) {
        this.onError(config.id, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async connectServer(config: McpServerConfig): Promise<ConnectedServer> {
    if (this.dryRun) {
      return {
        config,
        client: undefined as never,
        transport: undefined as never,
        tools: this.dryTools[config.id] ?? [],
      };
    }
    const client = new Client({ name: 'pi-desktop-mcp', version: '0.3.0' });
    const transport = new StdioClientTransport({
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.env
        ? {
            env: {
              ...(process.env as Record<string, string>),
              ...config.env,
            },
          }
        : {}),
      ...(config.cwd ? { cwd: config.cwd } : { cwd: this.projectPath }),
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      return { config, client, transport, tools: listed.tools ?? [] };
    } catch (error) {
      // Never leak a half-open child process on connect failure.
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  /** Call an MCP tool by its registered Pi name. Throws when unknown. */
  async call(
    name: string,
    args: unknown,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<{ content: unknown; isError: boolean }> {
    const entry = this.registry.get(name);
    if (!entry) {
      throw new Error(`Unknown MCP tool "${name}" (fail-closed).`);
    }
    // Dry-run servers have no live client — return canned content.
    if (this.dryRun && entry.server.client === undefined) {
      return {
        content: [{ type: 'text', text: `(dry-run) ${JSON.stringify(args)}` }],
        isError: false,
      };
    }
    const timeout = timeoutMs ?? entry.server.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await entry.server.client.callTool(
        { name: entry.tool.name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { signal: controller.signal },
      );
      const content = result.content ?? [];
      return { content, isError: result.isError === true };
    } catch (error) {
      if (signal?.aborted || controller.signal.aborted) {
        throw new Error(`MCP tool "${name}" cancelled.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Close every client (kills the child processes). Idempotent. */
  async dispose(): Promise<void> {
    const closing = this.connected.map(async (server) => {
      if (!server.client) return; // dry-run stubs have no live client
      try {
        await server.client.close();
      } catch (error) {
        console.warn(`[McpBridge] closing ${server.config.id} failed`, error);
      }
    });
    await Promise.allSettled(closing);
    this.connected = [];
    this.registry.clear();
  }
}

/** Format MCP callTool content (text / image parts) as text for the model. */
function formatMcpContent(content: unknown): string {
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      parts.push(String(part));
      continue;
    }
    const rec = part as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
    if (rec.type === 'text' && typeof rec.text === 'string') {
      parts.push(rec.text);
    } else if (rec.type === 'image') {
      parts.push(`[image ${rec.mimeType ?? 'unknown'} (${String(rec.data ?? '').length} chars base64)]`);
    } else {
      try {
        parts.push(JSON.stringify(part));
      } catch {
        parts.push(String(part));
      }
    }
  }
  return parts.join('\n');
}

function createMcpTool(
  name: string,
  config: McpServerConfig,
  tool: Tool,
  call: (args: unknown, signal?: AbortSignal) => Promise<{ content: unknown; isError: boolean }>,
) {
  const toolDescription = (tool.description ?? '').slice(0, 1500);
  return defineTool({
    name,
    label: `${config.id}: ${tool.name}`,
    description:
      `Tool from MCP server "${config.id}" (${config.command}).\n` +
      (toolDescription ? `${toolDescription}\n` : '') +
      `Risk level: ${config.risk ?? 'sensitive'}. This tool may touch external systems — it requires approval in Ask mode.`,
    promptSnippet: `${name} — MCP tool from ${config.id}`,
    parameters: (() => {
      // MCP tool schemas are JSON Schema; TypeBox accepts most shapes, but to
      // stay permissive we fall back to an open object when parsing is unsafe.
      try {
        if (tool.inputSchema && typeof tool.inputSchema === 'object') {
          const props = (tool.inputSchema as { properties?: Record<string, unknown> })
            .properties;
          if (props && typeof props === 'object') {
            const required =
              (tool.inputSchema as { required?: string[] }).required ?? [];
            const fields = Object.entries(props).map(([key, schema]) => [
              key,
              jsonSchemaToTypeBox(schema as Record<string, unknown>, required.includes(key)),
            ]);
            return Type.Object(Object.fromEntries(fields), {
              additionalProperties: true,
            });
          }
        }
      } catch {
        // fall through to permissive object
      }
      return Type.Record(Type.String(), Type.Unknown(), {
        description: 'Free-form arguments for the MCP tool',
      });
    })(),
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ isError: boolean }>> {
      const args = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
      const { content, isError } = await call(args, signal);
      const text = formatMcpContent(content);
      return {
        content: [{ type: 'text', text: text || '(no content)' }],
        details: { isError },
      };
    },
  });
}

/** Minimal JSON Schema → TypeBox for the common cases MCP servers emit. */
function jsonSchemaToTypeBox(
  schema: Record<string, unknown>,
  required: boolean,
): unknown {
  const type = schema.type;
  const description = typeof schema.description === 'string' ? schema.description : undefined;
  const opts: Record<string, unknown> = {};
  if (description) opts['description'] = description;
  switch (type) {
    case 'string': {
      if (schema.enum && Array.isArray(schema.enum)) {
        return Type.Union(
          (schema.enum as unknown[]).map((value) =>
            Type.Literal(value as string | number | boolean),
          ),
          opts,
        );
      }
      return required ? Type.String(opts) : Type.Optional(Type.String(opts));
    }
    case 'integer':
    case 'number':
      return required ? Type.Number(opts) : Type.Optional(Type.Number(opts));
    case 'boolean':
      return required ? Type.Boolean(opts) : Type.Optional(Type.Boolean(opts));
    case 'array':
      return required
        ? Type.Array(Type.Unknown(), opts)
        : Type.Optional(Type.Array(Type.Unknown(), opts));
    case 'object':
      return required
        ? Type.Record(Type.String(), Type.Unknown(), opts)
        : Type.Optional(Type.Record(Type.String(), Type.Unknown(), opts));
    default:
      return required ? Type.Unknown(opts) : Type.Optional(Type.Unknown(opts));
  }
}
