import { describe, expect, it } from 'vitest';

import { ipcMethodNeedsRuntime } from './ipc-runtime-gate.js';

describe('ipcMethodNeedsRuntime', () => {
  it('skips AgentRuntime for first-paint DB and settings commands', () => {
    expect(ipcMethodNeedsRuntime('project.listRecent')).toBe(false);
    expect(ipcMethodNeedsRuntime('project.open')).toBe(false);
    expect(ipcMethodNeedsRuntime('project.openPlayground')).toBe(false);
    expect(ipcMethodNeedsRuntime('project.setTrust')).toBe(false);
    expect(ipcMethodNeedsRuntime('session.list')).toBe(false);
    expect(ipcMethodNeedsRuntime('settings.get')).toBe(false);
    expect(ipcMethodNeedsRuntime('settings.getOnboarding')).toBe(false);
    expect(ipcMethodNeedsRuntime('settings.getFavoriteModels')).toBe(false);
    expect(ipcMethodNeedsRuntime('provider.list')).toBe(false);
    expect(ipcMethodNeedsRuntime('update.getStatus')).toBe(false);
  });

  it('still requires AgentRuntime for agent, auth, and session.create', () => {
    expect(ipcMethodNeedsRuntime('agent.listModels')).toBe(true);
    expect(ipcMethodNeedsRuntime('agent.sendMessage')).toBe(true);
    expect(ipcMethodNeedsRuntime('session.create')).toBe(true);
    expect(ipcMethodNeedsRuntime('session.messages')).toBe(true);
    expect(ipcMethodNeedsRuntime('provider.saveApiKey')).toBe(true);
    expect(ipcMethodNeedsRuntime('provider.listAvailable')).toBe(true);
    expect(ipcMethodNeedsRuntime('app.getInfo')).toBe(true);
    expect(ipcMethodNeedsRuntime('automation.runNow')).toBe(true);
    expect(ipcMethodNeedsRuntime('permissions.listRemembered')).toBe(true);
  });
});
