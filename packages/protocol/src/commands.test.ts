import { describe, expect, it } from 'vitest';

import { parseIpcCommand } from './ipc.js';

describe('git.getWorkingTreeDiff IPC command', () => {
  it('accepts a project identifier only', () => {
    expect(
      parseIpcCommand({
        method: 'git.getWorkingTreeDiff',
        params: { projectId: 'project-1' },
      }).success,
    ).toBe(true);
  });

  it('rejects renderer-provided paths and missing projects', () => {
    expect(
      parseIpcCommand({
        method: 'git.getWorkingTreeDiff',
        params: { projectId: '', path: '/tmp/project' },
      }).success,
    ).toBe(false);
  });
});

describe('Provider settings IPC commands', () => {
  it('accepts a provider key save and a default model selection', () => {
    expect(
      parseIpcCommand({
        method: 'provider.saveApiKey',
        params: { providerId: 'openai', apiKey: 'fixture-key' },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'settings.setDefaultModel',
        params: { model: { providerId: 'openai', modelId: 'gpt-5' } },
      }).success,
    ).toBe(true);
  });

  it('rejects empty Provider credentials', () => {
    expect(
      parseIpcCommand({
        method: 'provider.saveApiKey',
        params: { providerId: 'openai', apiKey: '' },
      }).success,
    ).toBe(false);
  });
});
