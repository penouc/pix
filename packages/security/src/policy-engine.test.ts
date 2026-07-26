import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PolicyEngine } from './policy-engine.js';
import { normalizeToolCall } from './tool-normalizer.js';

const workspace = path.resolve('/tmp/pi-ws');
const ctx = {
  projectId: 'p1',
  sessionId: 's1',
  runId: 'r1',
  workspaceRoot: workspace,
  projectTrusted: true,
};

describe('PolicyEngine', () => {
  it('allows safe reads when trusted', () => {
    const engine = new PolicyEngine();
    const tool = normalizeToolCall({
      toolCallId: '1',
      toolName: 'read',
      args: { path: 'a.ts' },
      workspaceRoot: workspace,
    });
    const d = engine.evaluate(tool, ctx);
    expect(d.action).toBe('allow');
  });

  it('denies all tools when project untrusted', () => {
    const engine = new PolicyEngine();
    const tool = normalizeToolCall({
      toolCallId: '1',
      toolName: 'read',
      args: { path: 'a.ts' },
      workspaceRoot: workspace,
    });
    const d = engine.evaluate(tool, { ...ctx, projectTrusted: false });
    expect(d.action).toBe('deny');
  });

  it('requires approval for git push', () => {
    const engine = new PolicyEngine();
    const tool = normalizeToolCall({
      toolCallId: '1',
      toolName: 'bash',
      args: { command: 'git push origin main' },
      workspaceRoot: workspace,
    });
    const d = engine.evaluate(tool, ctx);
    expect(d.action).toBe('require-approval');
    if (d.action === 'require-approval') {
      expect(d.request.riskLevel).toBe('external-side-effect');
      expect(d.request.rememberable).toBe(false);
    }
  });

  it('remembers allow-session for sensitive tools', () => {
    const engine = new PolicyEngine();
    const tool = normalizeToolCall({
      toolCallId: '1',
      toolName: 'bash',
      args: { command: 'pnpm install' },
      workspaceRoot: workspace,
    });
    expect(engine.evaluate(tool, ctx).action).toBe('require-approval');
    engine.remember(ctx, 'allow-session', tool, 'sensitive');
    expect(engine.evaluate(tool, ctx).action).toBe('allow');
  });
});

describe('approval modes', () => {
  const ctx = {
    projectId: 'p1',
    sessionId: 's1',
    runId: 'r1',
    workspaceRoot: '/tmp/ws',
    projectTrusted: true,
  };

  const write = normalizeToolCall({
    toolCallId: 't1',
    toolName: 'write',
    args: { path: '/tmp/ws/src/index.ts', content: 'x' },
    workspaceRoot: '/tmp/ws',
  });

  const read = normalizeToolCall({
    toolCallId: 't2',
    toolName: 'read',
    args: { path: '/tmp/ws/src/index.ts' },
    workspaceRoot: '/tmp/ws',
  });

  it('auto-reads lets a workspace write through', () => {
    const engine = new PolicyEngine({ defaultMode: 'auto-reads' });
    expect(engine.evaluate(write, ctx).action).toBe('allow');
  });

  it('ask holds a workspace write for a decision', () => {
    const engine = new PolicyEngine({ defaultMode: 'ask' });
    expect(engine.evaluate(write, ctx).action).toBe('require-approval');
  });

  it('read-only refuses a write outright rather than queueing it', () => {
    const engine = new PolicyEngine({ defaultMode: 'read-only' });
    const decision = engine.evaluate(write, ctx);
    expect(decision.action).toBe('deny');
  });

  it('read-only still allows reads', () => {
    const engine = new PolicyEngine({ defaultMode: 'read-only' });
    expect(engine.evaluate(read, ctx).action).toBe('allow');
  });

  it('read-only overrides an earlier remembered allow', () => {
    // A rule remembered in a permissive mode must not re-open writes.
    const engine = new PolicyEngine({ defaultMode: 'ask' });
    engine.remember(ctx, 'allow-project', write, 'workspace-write');
    expect(engine.evaluate(write, ctx).action).toBe('allow');

    engine.setDefaultMode('read-only');
    expect(engine.evaluate(write, ctx).action).toBe('deny');
  });

  it('a per-session mode overrides the default', () => {
    const engine = new PolicyEngine({ defaultMode: 'auto-reads' });
    engine.setSessionMode('s1', 'read-only');
    expect(engine.evaluate(write, ctx).action).toBe('deny');
    expect(engine.evaluate(write, { ...ctx, sessionId: 'other' }).action).toBe('allow');
  });
});

describe('remembered rules', () => {
  const ctx = {
    projectId: 'p1',
    sessionId: 's1',
    runId: 'r1',
    workspaceRoot: '/tmp/ws',
    projectTrusted: true,
  };
  const write = normalizeToolCall({
    toolCallId: 't1',
    toolName: 'write',
    args: { path: '/tmp/ws/a.ts', content: 'x' },
    workspaceRoot: '/tmp/ws',
  });

  it('lists session and project rules without exposing arguments', () => {
    const engine = new PolicyEngine({ defaultMode: 'ask' });
    engine.remember(ctx, 'allow-session', write, 'workspace-write');
    engine.remember(ctx, 'allow-project', write, 'workspace-write');

    const rules = engine.listRemembered();
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.scope).sort()).toEqual(['project', 'session']);
    expect(rules.every((rule) => rule.toolName === 'write')).toBe(true);
    expect(JSON.stringify(rules)).not.toContain('content');
  });

  it('clears by scope and reverts behaviour to asking', () => {
    const engine = new PolicyEngine({ defaultMode: 'ask' });
    engine.remember(ctx, 'allow-project', write, 'workspace-write');
    expect(engine.evaluate(write, ctx).action).toBe('allow');

    const cleared = engine.clearRemembered({ scope: 'project' });
    expect(cleared).toBe(1);
    expect(engine.evaluate(write, ctx).action).toBe('require-approval');
  });
});
