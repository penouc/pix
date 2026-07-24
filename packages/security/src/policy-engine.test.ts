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
