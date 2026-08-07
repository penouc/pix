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

  // #15 — grep / find / ls / glob are first-class read-only search tools.
  it.each(['grep', 'find', 'ls', 'glob'])('marks %s as safe inside the workspace', (name) => {
    const t = tool(name, { path: 'src' });
    expect(classifyRisk(t).level).toBe('safe');
  });

  it.each(['grep', 'find', 'ls', 'glob'])(
    'escalates %s to sensitive when the search path escapes the workspace',
    (name) => {
      const t = tool(name, { path: '../../etc' });
      expect(t.escapesWorkspace).toBe(true);
      expect(classifyRisk(t).level).toBe('sensitive');
    },
  );

  it('treats todo and ask as safe (they mutate only in-session state)', () => {
    expect(classifyRisk(tool('todo', { action: 'create', items: [] })).level).toBe('safe');
    expect(classifyRisk(tool('ask', { question: 'Which?' })).level).toBe('safe');
  });

  // #13 — hash_lines is read-only; #14 — diagnostics/references are read-only,
  // rename rewrites files.
  it('treats hash_lines and lsp_diagnostics / lsp_references as safe', () => {
    expect(classifyRisk(tool('hash_lines', { path: 'src/a.ts' })).level).toBe('safe');
    expect(classifyRisk(tool('lsp_diagnostics', { path: 'src/a.ts' })).level).toBe('safe');
    expect(classifyRisk(tool('lsp_references', { path: 'src/a.ts', symbol: 'x' })).level).toBe(
      'safe',
    );
  });

  it('treats lsp_rename as workspace-write', () => {
    const t = tool('lsp_rename', { path: 'src/a.ts', symbol: 'x', newName: 'y' });
    expect(classifyRisk(t).level).toBe('workspace-write');
  });

  // #16 / #17 / #18 / #19 / #20 — Batch D risk classes.
  it.each(['git_status', 'git_diff', 'git_log'])('marks %s as safe', (name) => {
    expect(classifyRisk(tool(name, {})).level).toBe('safe');
  });

  it('marks git_commit as workspace-write (local only, never push)', () => {
    expect(classifyRisk(tool('git_commit', { message: 'fix: x' })).level).toBe('workspace-write');
  });

  it('marks web_search as external-side-effect', () => {
    expect(classifyRisk(tool('web_search', { query: 'typescript' })).level).toBe(
      'external-side-effect',
    );
  });

  it('marks memory recall as safe and retain/forget as workspace-write', () => {
    expect(classifyRisk(tool('memory', { action: 'recall' })).level).toBe('safe');
    expect(classifyRisk(tool('memory', { action: 'retain', key: 'k', value: 'v' })).level).toBe(
      'workspace-write',
    );
    expect(classifyRisk(tool('memory', { action: 'forget', key: 'k' })).level).toBe(
      'workspace-write',
    );
  });

  it('marks learn as workspace-write', () => {
    expect(
      classifyRisk(tool('learn', { name: 'foo', description: 'd', body: 'steps' })).level,
    ).toBe('workspace-write');
  });

  it('marks mcp__* tools as sensitive', () => {
    expect(classifyRisk(tool('mcp__fixture__echo', { text: 'hi' })).level).toBe('sensitive');
  });
});
