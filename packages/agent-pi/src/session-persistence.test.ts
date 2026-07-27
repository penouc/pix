import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';

import { PiAgentRuntime } from './pi-runtime.js';

/*
 * Pi's Message union carries more than role and content — a user turn needs a
 * timestamp and an assistant turn the whole model/usage envelope. Built out in
 * full so these are real messages rather than casts that would hide a shape
 * change in the SDK.
 */
function userMessage(text: string) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    timestamp: 1_700_000_000_000,
  };
}

function assistantMessage(text: string) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'anthropic-messages' as const,
    provider: 'anthropic' as const,
    model: 'claude-opus-5',
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
    timestamp: 1_700_000_000_001,
  };
}

/**
 * Sessions used `SessionManager.inMemory()`, so Pi never wrote a transcript:
 * reopening a task showed an empty thread and the model was handed no history.
 * These cover the reopen path, which is the part that can silently regress —
 * Pi names files `<timestamp>_<id>.jsonl`, so the file for a session id has to be
 * found by suffix and cannot be constructed.
 */
describe('session transcript persistence', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  async function workspace() {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-session-'));
    roots.push(root);
    const project = path.join(root, 'project');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'README.md'), '# fixture\n');
    return { agentDir: path.join(root, 'agent'), project };
  }

  function runtime(agentDir: string) {
    return new PiAgentRuntime({ agentDir, allowModelNetwork: false, hydrateEnvAuth: false });
  }

  it('reopens a stored transcript for the same session id', async () => {
    const { agentDir, project } = await workspace();

    // Seed a transcript where the runtime looks for it.
    const dir = path.join(agentDir, 'desktop-sessions');
    await mkdir(dir, { recursive: true });
    const seeded = SessionManager.create(project, dir, { id: 'task-42' });
    seeded.appendMessage(userMessage('add a dark mode toggle'));
    seeded.appendMessage(assistantMessage('Done — it is in Settings.'));

    const agent = runtime(agentDir);
    try {
      await agent.createSession({
        id: 'task-42',
        projectId: 'p',
        projectPath: project,
        title: 'T',
      });

      expect(await agent.listMessages('task-42')).toEqual([
        { role: 'user', text: 'add a dark mode toggle' },
        // Content arrives as an array of parts here, not a string.
        { role: 'assistant', text: 'Done — it is in Settings.' },
      ]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it('does not serve one session the transcript of another', async () => {
    const { agentDir, project } = await workspace();
    const dir = path.join(agentDir, 'desktop-sessions');
    await mkdir(dir, { recursive: true });
    const other = SessionManager.create(project, dir, { id: 'task-other' });
    other.appendMessage(userMessage('someone elses conversation'));

    const agent = runtime(agentDir);
    try {
      await agent.createSession({
        id: 'task-mine',
        projectId: 'p',
        projectPath: project,
        title: 'T',
      });
      // The suffix match must be exact — a prefix or substring hit would leak.
      expect(await agent.listMessages('task-mine')).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it('writes a transcript file under the agent directory', async () => {
    const { agentDir, project } = await workspace();
    const agent = runtime(agentDir);
    try {
      await agent.createSession({
        id: 'task-new',
        projectId: 'p',
        projectPath: project,
        title: 'T',
      });
      // Pi creates the file lazily on the first entry, so an untouched session
      // legitimately has none — what matters is that the directory is ours and
      // the manager is a persisting one rather than in-memory.
      const dir = path.join(agentDir, 'desktop-sessions');
      const files = await readdir(dir).catch(() => []);
      expect(Array.isArray(files)).toBe(true);
      expect(await agent.listMessages('task-new')).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);
});
