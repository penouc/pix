import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PiAgentRuntime } from './pi-runtime.js';
import { PI_SDK_PACKAGES } from './versions.js';

describe('Pi SDK lock', () => {
  it('pins coding-agent 0.82.0', () => {
    expect(PI_SDK_PACKAGES.version).toBe('0.82.0');
    expect(PI_SDK_PACKAGES.codingAgent).toBe('@earendil-works/pi-coding-agent');
  });
});

describe('PiAgentRuntime session create (no provider call)', () => {
  it('creates an in-memory Pi session against a temp project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-desktop-'));
    const agentDir = path.join(root, 'agent-state');
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await writeFile(path.join(root, 'README.md'), '# fixture\n', 'utf8');

      const runtime = new PiAgentRuntime({
        agentDir,
        allowModelNetwork: false,
      });

      const session = await runtime.createSession({
        projectId: 'test-project',
        projectPath: root,
        title: 'Smoke',
      });

      expect(session.id).toBeTruthy();
      expect(session.projectId).toBe('test-project');

      const models = await runtime.listModels();
      // Built-in catalog should expose at least one model definition offline.
      expect(Array.isArray(models)).toBe(true);

      await runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('rehydrates SQLite-owned session metadata with its original desktop id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-desktop-rehydrate-'));
    try {
      await writeFile(path.join(root, 'README.md'), '# fixture\n', 'utf8');
      const metadata = {
        id: 'persisted-session-id',
        projectId: 'persisted-project',
        projectPath: root,
        title: 'Restored session',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_100,
      };
      const first = new PiAgentRuntime({
        agentDir: path.join(root, 'agent-one'),
        allowModelNetwork: false,
        hydrateEnvAuth: false,
      });
      const created = await first.createSession(metadata);
      expect(created).toMatchObject({
        id: metadata.id,
        projectId: metadata.projectId,
        title: metadata.title,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      });
      await first.dispose();

      const restarted = new PiAgentRuntime({
        agentDir: path.join(root, 'agent-two'),
        allowModelNetwork: false,
        hydrateEnvAuth: false,
      });
      const restored = await restarted.createSession(metadata);
      expect(restored).toEqual(created);
      expect(await restarted.resumeSession(metadata.id)).toEqual(created);
      await restarted.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
