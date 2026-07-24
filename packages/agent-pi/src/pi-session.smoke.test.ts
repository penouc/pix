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
});
