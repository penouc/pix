import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { safeStorage } from 'electron';

import type { ModelRef } from '@pi-desktop/protocol';

interface StoredProvider {
  providerId: string;
  apiKey: string;
}

/** Behavioural flags the Settings screen owns and Main actually reads. */
export interface UiFlags {
  trustNewProjects: boolean;
  reopenLastProject: boolean;
  notifyApprovalRequired: boolean;
  notifyRunFinished: boolean;
  notifyAutomationOpenedTask: boolean;
  notifyPlaySound: boolean;
  notifyBadgeDock: boolean;
  notifyOnlyWhenBackground: boolean;
  defaultProjectsFolder: string;
}

const DEFAULT_UI_FLAGS: UiFlags = {
  trustNewProjects: false,
  reopenLastProject: true,
  // A paused run is the one thing that genuinely needs to interrupt you.
  notifyApprovalRequired: true,
  notifyRunFinished: true,
  notifyAutomationOpenedTask: false,
  notifyPlaySound: false,
  notifyBadgeDock: true,
  notifyOnlyWhenBackground: true,
  defaultProjectsFolder: '',
};

export type StoredApprovalMode = 'ask' | 'auto-reads' | 'read-only';

interface StoredSettings {
  providers: StoredProvider[];
  defaultModel?: ModelRef;
  uiFlags?: Partial<UiFlags>;
  defaultApprovalMode?: StoredApprovalMode;
}

export interface ProviderSettingSummary {
  providerId: string;
  configured: boolean;
}

/** Main-only encrypted provider credential store. */
export class ProviderSettingsStore {
  constructor(private readonly filePath: string) {}

  list(): ProviderSettingSummary[] {
    return this.read().providers.map(({ providerId }) => ({ providerId, configured: true }));
  }

  getApiKeys(): StoredProvider[] {
    return this.read().providers;
  }

  saveApiKey(providerId: string, apiKey: string): void {
    const settings = this.read();
    const providers = settings.providers.filter((entry) => entry.providerId !== providerId);
    providers.push({ providerId, apiKey });
    this.write({ ...settings, providers });
  }

  remove(providerId: string): void {
    const settings = this.read();
    this.write({
      ...settings,
      providers: settings.providers.filter((entry) => entry.providerId !== providerId),
    });
  }

  getDefaultModel(): ModelRef | undefined {
    return this.read().defaultModel;
  }

  getUiFlags(): UiFlags {
    return { ...DEFAULT_UI_FLAGS, ...(this.read().uiFlags ?? {}) };
  }

  getDefaultApprovalMode(): StoredApprovalMode {
    return this.read().defaultApprovalMode ?? 'auto-reads';
  }

  setDefaultApprovalMode(mode: StoredApprovalMode): void {
    const settings = this.read();
    settings.defaultApprovalMode = mode;
    this.write(settings);
  }

  setDefaultProjectsFolder(folder: string): void {
    const settings = this.read();
    settings.uiFlags = { ...(settings.uiFlags ?? {}), defaultProjectsFolder: folder };
    this.write(settings);
  }

  setUiFlag<K extends keyof UiFlags>(key: K, value: UiFlags[K]): void {
    const settings = this.read();
    settings.uiFlags = { ...(settings.uiFlags ?? {}), [key]: value };
    this.write(settings);
  }

  setDefaultModel(model: ModelRef | undefined): void {
    this.write({ ...this.read(), defaultModel: model });
  }

  private read(): StoredSettings {
    if (!existsSync(this.filePath)) return { providers: [] };
    try {
      const encrypted = Buffer.from(readFileSync(this.filePath, 'utf8'), 'base64');
      const value = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(value) as Partial<StoredSettings>;
      return {
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
        defaultModel: parsed.defaultModel,
      };
    } catch {
      return { providers: [] };
    }
  }

  private write(settings: StoredSettings): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS Keychain encryption is unavailable for Provider settings.');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(settings));
    writeFileSync(this.filePath, encrypted.toString('base64'), { mode: 0o600 });
  }
}
