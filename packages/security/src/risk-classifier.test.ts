import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyRisk } from './risk-classifier.js';
import { normalizeToolCall } from './tool-normalizer.js';

const workspace = path.resolve('/tmp/pi-ws');

function tool(name: string, args: unknown) {
  return normalizeToolCall({
    toolCallId: 't1',
    toolName: name,
    args,
    workspaceRoot: workspace,
  });
}

describe('classifyRisk', () => {
  it('marks workspace read as safe', () => {
    const t = tool('read', { path: 'src/a.ts' });
    expect(classifyRisk(t).level).toBe('safe');
  });

  it('marks edit as workspace-write', () => {
    const t = tool('edit', { path: 'src/a.ts' });
    expect(classifyRisk(t).level).toBe('workspace-write');
  });

  it('marks rm -rf as destructive', () => {
    const t = tool('bash', { command: 'rm -rf ./dist' });
    expect(classifyRisk(t).level).toBe('destructive');
  });

  it('marks git push as external-side-effect', () => {
    const t = tool('bash', { command: 'git push origin main' });
    expect(classifyRisk(t).level).toBe('external-side-effect');
  });

  it('marks .env read as sensitive', () => {
    const t = tool('read', { path: '.env' });
    expect(classifyRisk(t).level).toBe('sensitive');
  });

  it('marks path escape as sensitive', () => {
    const t = tool('read', { path: '../../etc/passwd' });
    expect(t.escapesWorkspace).toBe(true);
    expect(classifyRisk(t).level).toBe('sensitive');
  });

  it('marks npm install as sensitive', () => {
    const t = tool('bash', { command: 'pnpm install' });
    expect(classifyRisk(t).level).toBe('sensitive');
  });
});
