import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

import { McpBridge } from './mcp-bridge.js';

const fixtureServer = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-fixture-server.mjs',
);

const bridges: McpBridge[] = [];
function track(bridge: McpBridge): McpBridge {
  bridges.push(bridge);
  return bridge;
}

afterEach(async () => {
  await Promise.allSettled(bridges.splice(0).map((b) => b.dispose()));
});

/** Minimal ExtensionAPI-shaped recorder. */
function fakePi() {
  const registered: Array<{ name: string; def: ToolDefinition }> = [];
  return {
    registered,
    registerTool(def: ToolDefinition) {
      registered.push({ name: def.name, def });
    },
  };
}

describe('McpBridge', () => {
  it('registers every advertised tool as mcp__<server>__<tool>', async () => {
    const bridge = track(
      new McpBridge({
        servers: [{ id: 'fixture', command: process.execPath, args: [fixtureServer] }],
        projectPath: process.cwd(),
      }),
    );
    const pi = fakePi();
    await bridge.registerTools(pi as never);
    expect(bridge.toolNames().sort()).toEqual(['mcp__fixture__add', 'mcp__fixture__echo']);
    expect(pi.registered.map((r) => r.name).sort()).toEqual([
      'mcp__fixture__add',
      'mcp__fixture__echo',
    ]);
  });

  it('calls a tool through the live server', async () => {
    const bridge = track(
      new McpBridge({
        servers: [{ id: 'fixture', command: process.execPath, args: [fixtureServer] }],
        projectPath: process.cwd(),
      }),
    );
    await bridge.registerTools(fakePi() as never);
    const result = await bridge.call('mcp__fixture__echo', { text: 'hello' });
    expect(result.content).toEqual([{ type: 'text', text: 'echo:hello' }]);
    expect(result.isError).toBe(false);

    const sum = await bridge.call('mcp__fixture__add', { a: 2, b: 3 });
    expect(sum.content).toEqual([{ type: 'text', text: '5' }]);
  });

  it('fails closed for unknown tool names', async () => {
    const bridge = track(
      new McpBridge({
        servers: [{ id: 'fixture', command: process.execPath, args: [fixtureServer] }],
        projectPath: process.cwd(),
      }),
    );
    await bridge.registerTools(fakePi() as never);
    await expect(bridge.call('mcp__fixture__nonexistent', {})).rejects.toThrow(
      /Unknown MCP tool.*fail-closed/,
    );
  });

  it('skips a server that fails to start without breaking the session', async () => {
    const errors: string[] = [];
    const bridge = track(
      new McpBridge({
        servers: [
          { id: 'good', command: process.execPath, args: [fixtureServer] },
          { id: 'broken', command: 'definitely-not-a-real-binary-xyz', args: [] },
        ],
        projectPath: process.cwd(),
        onError: (id) => errors.push(id),
      }),
    );
    const pi = fakePi();
    await bridge.registerTools(pi as never);
    // Broken server contributed nothing, good server worked.
    expect(errors).toEqual(['broken']);
    expect(bridge.toolNames().sort()).toEqual(['mcp__good__add', 'mcp__good__echo']);
    expect(pi.registered.length).toBe(2);
  });

  it('dispose kills the child process', async () => {
    const bridge = track(
      new McpBridge({
        servers: [{ id: 'fixture', command: process.execPath, args: [fixtureServer] }],
        projectPath: process.cwd(),
      }),
    );
    await bridge.registerTools(fakePi() as never);
    await bridge.dispose();
    // After dispose the registry is empty; a call fails closed.
    await expect(bridge.call('mcp__fixture__echo', { text: 'x' })).rejects.toThrow(
      /Unknown MCP tool/,
    );
  });

  it('dry-run mode registers injected tools without spawning', async () => {
    const dryTools: Tool[] = [
      {
        name: 'virtual',
        description: 'A fake tool',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ];
    const bridge = track(
      new McpBridge({
        servers: [{ id: 'fake', command: 'unused' }],
        projectPath: process.cwd(),
        dryRun: true,
        dryTools: { fake: dryTools },
      }),
    );
    const pi = fakePi();
    await bridge.registerTools(pi as never);
    expect(bridge.toolNames()).toEqual(['mcp__fake__virtual']);
    const result = await bridge.call('mcp__fake__virtual', { q: 'x' });
    expect(result.content).toEqual([{ type: 'text', text: '(dry-run) {"q":"x"}' }]);
  });
});
