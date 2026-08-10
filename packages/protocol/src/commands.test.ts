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

describe('Multimodal message IPC commands', () => {
  const image = {
    data: 'aGVsbG8=',
    mimeType: 'image/png',
    name: 'screenshot.png',
    size: 5,
  };

  it('accepts image-only messages and image steering', () => {
    expect(
      parseIpcCommand({
        method: 'agent.sendMessage',
        params: { sessionId: 'session-1', text: '', images: [image] },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'agent.steer',
        params: { runId: 'run-1', text: 'look here', images: [image] },
      }).success,
    ).toBe(true);
  });

  it('rejects empty messages and unsupported image formats', () => {
    expect(
      parseIpcCommand({
        method: 'agent.sendMessage',
        params: { sessionId: 'session-1', text: '', images: [] },
      }).success,
    ).toBe(false);
    expect(
      parseIpcCommand({
        method: 'agent.sendMessage',
        params: {
          sessionId: 'session-1',
          text: 'inspect',
          images: [{ ...image, mimeType: 'image/svg+xml' }],
        },
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
        params: { model: { kind: 'model', providerId: 'openai', modelId: 'gpt-5' } },
      }).success,
    ).toBe(true);
    // Auto (#21) is a first-class selection, not a sentinel provider id.
    expect(
      parseIpcCommand({
        method: 'settings.setDefaultModel',
        params: { model: { kind: 'auto' } },
      }).success,
    ).toBe(true);
    // The pre-#21 bare ModelRef shape is rejected so a stale renderer cannot
    // silently pin a model the runtime treats as unset.
    expect(
      parseIpcCommand({
        method: 'settings.setDefaultModel',
        params: { model: { providerId: 'openai', modelId: 'gpt-5' } },
      }).success,
    ).toBe(false);
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

describe('Auto model routing IPC commands', () => {
  it('round-trips the configurable fallback chain', () => {
    const get = parseIpcCommand({ method: 'settings.getAutoModel' });
    expect(get.success).toBe(true);
    const set = parseIpcCommand({
      method: 'settings.setAutoModel',
      params: {
        config: {
          defaultKey: 'openai/gpt-4o-mini',
          planKey: 'anthropic/claude-sonnet-4-5',
          fallbackKeys: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'],
        },
      },
    });
    expect(set.success).toBe(true);
    // Keys are non-empty strings; format is resolved (and unresolvable keys
    // skipped) by the runtime, not rejected here.
    expect(
      parseIpcCommand({
        method: 'settings.setAutoModel',
        params: { config: { fallbackKeys: [''] } },
      }).success,
    ).toBe(false);
  });
});

describe('Compaction IPC commands', () => {
  it('accepts getContextUsage, compact, and auto-compaction toggles', () => {
    expect(
      parseIpcCommand({
        method: 'agent.getContextUsage',
        params: { sessionId: 'session-1' },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'agent.compact',
        params: { sessionId: 'session-1', customInstructions: 'keep auth' },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'agent.setAutoCompaction',
        params: { enabled: true, sessionId: 'session-1' },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'agent.getAutoCompaction',
        params: { sessionId: 'session-1' },
      }).success,
    ).toBe(true);
  });

  it('accepts session fork commands', () => {
    expect(
      parseIpcCommand({
        method: 'agent.forkPoints',
        params: { sessionId: 'session-1' },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'agent.forkSession',
        params: { sessionId: 'session-1', entryId: 'entry-7' },
      }).success,
    ).toBe(true);
    // The entry id is required: rewinding a session is a scoped action.
    expect(
      parseIpcCommand({
        method: 'agent.forkSession',
        params: { sessionId: 'session-1' },
      }).success,
    ).toBe(false);
  });
});

describe('Browser preview IPC commands', () => {
  it('accepts attach, navigate, bounds, and picker commands', () => {
    expect(parseIpcCommand({ method: 'browser.attach' }).success).toBe(true);
    expect(parseIpcCommand({ method: 'browser.detach' }).success).toBe(true);
    expect(
      parseIpcCommand({
        method: 'browser.navigate',
        params: { url: 'http://localhost:5173/' },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'browser.setBounds',
        params: { x: 10, y: 20, width: 400, height: 600 },
      }).success,
    ).toBe(true);
    expect(
      parseIpcCommand({
        method: 'browser.setVisible',
        params: { visible: false },
      }).success,
    ).toBe(true);
    expect(parseIpcCommand({ method: 'browser.startPicker' }).success).toBe(true);
    expect(parseIpcCommand({ method: 'browser.cancelPicker' }).success).toBe(true);
  });

  it('rejects non-finite bounds and empty navigate urls', () => {
    expect(
      parseIpcCommand({
        method: 'browser.setBounds',
        params: { x: Number.NaN, y: 0, width: 1, height: 1 },
      }).success,
    ).toBe(false);
    expect(
      parseIpcCommand({
        method: 'browser.navigate',
        params: { url: '' },
      }).success,
    ).toBe(false);
  });
});
