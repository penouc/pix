import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const safeStorage = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => {
      const token = Buffer.from(value, 'utf8').toString('base64');
      store.set(token, value);
      return Buffer.from(token, 'utf8');
    },
    decryptString: (buf: Buffer) => {
      const token = buf.toString('utf8');
      const value = store.get(token);
      if (value == null) throw new Error('unknown ciphertext');
      return value;
    },
    _store: store,
  };
});

vi.mock('electron', () => ({ safeStorage }));

import { ProviderSettingsStore } from './provider-settings-store.js';

describe('ProviderSettingsStore', () => {
  let dir: string;
  let encPath: string;
  let prefsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pix-settings-'));
    encPath = path.join(dir, 'provider-settings.enc');
    prefsPath = path.join(dir, 'app-preferences.json');
    safeStorage._store.clear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps API keys encrypted and preferences in plain JSON', () => {
    const store = new ProviderSettingsStore(encPath);
    store.saveApiKey('openai', 'sk-test');
    store.setUiFlag('autoUpdate', false);
    store.setDefaultModel({ providerId: 'openai', modelId: 'gpt-4.1' });

    const encRaw = readFileSync(encPath, 'utf8');
    expect(encRaw).not.toContain('sk-test');
    expect(encRaw).not.toContain('autoUpdate');

    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8')) as {
      uiFlags: { autoUpdate: boolean };
      defaultModel: { providerId: string; modelId: string };
    };
    expect(prefs.uiFlags.autoUpdate).toBe(false);
    expect(prefs.defaultModel).toEqual({ providerId: 'openai', modelId: 'gpt-4.1' });

    const reloaded = new ProviderSettingsStore(encPath);
    expect(reloaded.getApiKeys()).toEqual([{ providerId: 'openai', apiKey: 'sk-test' }]);
    expect(reloaded.getUiFlags().autoUpdate).toBe(false);
    expect(reloaded.getDefaultModel()).toEqual({ providerId: 'openai', modelId: 'gpt-4.1' });
  });

  it('reads uiFlags without requiring the encrypted blob', () => {
    writeFileSync(
      prefsPath,
      JSON.stringify({ uiFlags: { autoUpdate: false, notifyBadgeDock: false } }),
      'utf8',
    );
    const store = new ProviderSettingsStore(encPath);
    expect(store.getUiFlags().autoUpdate).toBe(false);
    expect(store.getUiFlags().notifyBadgeDock).toBe(false);
    // Defaults still fill the rest.
    expect(store.getUiFlags().trustNewProjects).toBe(false);
    expect(store.getUiFlags().reopenLastProject).toBe(false);
    expect(existsSync(encPath)).toBe(false);
  });

  it('migrates legacy encrypted blobs that mixed secrets and prefs', () => {
    const legacy = {
      providers: [{ providerId: 'anthropic', apiKey: 'sk-legacy' }],
      uiFlags: { autoUpdate: false },
      defaultApprovalMode: 'ask' as const,
      favoriteModels: ['anthropic/claude'],
    };
    const token = safeStorage.encryptString(JSON.stringify(legacy)).toString('utf8');
    writeFileSync(encPath, Buffer.from(token, 'utf8').toString('base64'), 'utf8');

    const store = new ProviderSettingsStore(encPath);
    expect(store.getApiKeys()).toEqual([{ providerId: 'anthropic', apiKey: 'sk-legacy' }]);
    expect(store.getUiFlags().autoUpdate).toBe(false);
    expect(store.getDefaultApprovalMode()).toBe('ask');
    expect(store.getFavoriteModels()).toEqual(['anthropic/claude']);

    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8')) as {
      uiFlags: { autoUpdate: boolean };
      favoriteModels: string[];
    };
    expect(prefs.uiFlags.autoUpdate).toBe(false);
    expect(prefs.favoriteModels).toEqual(['anthropic/claude']);

    // Encrypted file is secrets-only after migration.
    const reDecrypted = safeStorage.decryptString(
      Buffer.from(readFileSync(encPath, 'utf8'), 'base64'),
    );
    const body = JSON.parse(reDecrypted) as Record<string, unknown>;
    expect(body.providers).toEqual([{ providerId: 'anthropic', apiKey: 'sk-legacy' }]);
    expect(body.uiFlags).toBeUndefined();
    expect(body.favoriteModels).toBeUndefined();
  });
});
