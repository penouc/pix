import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyMemoryOp,
  createLearnSkillTool,
  createMemoryTool,
  loadMemory,
  saveMemory,
} from './memory-tools.js';

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

let project: string;

beforeEach(() => {
  project = mkdtempSync(path.join(os.tmpdir(), 'pix-memory-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const ctx = () => ({ cwd: project }) as never;

async function runTool(
  tool: ReturnType<typeof createMemoryTool>,
  params: unknown,
) {
  return tool.execute('call-1', params as never, undefined, undefined, ctx());
}

describe('applyMemoryOp', () => {
  it('retains a note (upsert by key)', () => {
    const once = applyMemoryOp([], { action: 'retain', key: 'port', value: '8080' });
    expect(once).toHaveLength(1);
    expect(once[0]).toMatchObject({ key: 'port', value: '8080' });
    const twice = applyMemoryOp(once, { action: 'retain', key: 'port', value: '9090' });
    expect(twice).toHaveLength(1);
    expect(twice[0]?.value).toBe('9090');
  });

  it('forgets by key', () => {
    const notes = [{ key: 'a', value: '1', updatedAt: 1 }];
    expect(applyMemoryOp(notes, { action: 'forget', key: 'a' })).toEqual([]);
  });
});

describe('memory tool', () => {
  it('retain then recall round-trips through the JSON file', async () => {
    const tool = createMemoryTool();
    await runTool(tool, { action: 'retain', key: 'build', value: 'pnpm -r build' });
    const file = path.join(project, '.pi-desktop', 'agent', 'memory.json');
    expect(existsSync(file)).toBe(true);
    expect(loadMemory(project)[0]).toMatchObject({ key: 'build' });

    const recall = await runTool(tool, { action: 'recall' });
    expect(toolText(recall)).toContain('pnpm -r build');
  });

  it('recall filters by key and fuzzy text', async () => {
    const tool = createMemoryTool();
    await runTool(tool, { action: 'retain', key: 'alpha', value: 'first thing' });
    await runTool(tool, { action: 'retain', key: 'beta', value: 'second thing' });
    const byKey = await runTool(tool, { action: 'recall', key: 'beta' });
    expect(byKey.details?.notes).toHaveLength(1);
    expect(byKey.details?.notes[0]?.key).toBe('beta');
    const fuzzy = await runTool(tool, { action: 'recall', value: 'first' });
    expect(fuzzy.details?.notes[0]?.key).toBe('alpha');
  });

  it('forget removes the note', async () => {
    const tool = createMemoryTool();
    await runTool(tool, { action: 'retain', key: 'tmp', value: 'x' });
    await runTool(tool, { action: 'forget', key: 'tmp' });
    expect(loadMemory(project)).toEqual([]);
  });

  it('recall on an empty store returns a friendly message', async () => {
    const tool = createMemoryTool();
    const result = await runTool(tool, { action: 'recall' });
    expect(toolText(result)).toContain('No matching notes');
  });
});

describe('learn tool (#20 → skill)', () => {
  it('writes .pi/skills/<name>/SKILL.md with frontmatter', async () => {
    const tool = createLearnSkillTool();
    const result = await tool.execute(
      'call-1',
      {
        name: 'Test Failure Triage',
        description: 'Diagnoses failing tests',
        body: '1. Reproduce the failure.\n2. Fix the smallest thing.',
      } as never,
      undefined,
      undefined,
      ctx(),
    );
    const file = result.details?.path;
    expect(file).toBeTruthy();
    expect(existsSync(file!)).toBe(true);
    const content = readFileSync(file!, 'utf8');
    expect(content).toContain('name: test-failure-triage');
    expect(content).toContain('description: Diagnoses failing tests');
    expect(content).toContain('2. Fix the smallest thing.');
  });

  it('rejects an empty name', async () => {
    const tool = createLearnSkillTool();
    const result = await tool.execute(
      'call-1',
      { name: '  ', description: 'd', body: 'b' } as never,
      undefined,
      undefined,
      ctx(),
    );
    expect(result.details?.path).toBe('');
  });
});

describe('persistence', () => {
  it('saveMemory/loadMemory survive reload (same file)', () => {
    saveMemory(project, [{ key: 'k', value: 'v', updatedAt: 42 }]);
    expect(loadMemory(project)).toEqual([{ key: 'k', value: 'v', updatedAt: 42 }]);
  });
});
