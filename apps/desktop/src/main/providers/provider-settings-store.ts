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
  /**
   * `provider/model` keys pinned to the top of the model picker.
   *
   * These *order* the picker, they do not filter it. An earlier version used the
   * same list to hide everything unselected, which made one starred model hide
   * the other eighty-eight — a pin and a filter are different things and only
   * one of them is what "favourite" means. The picker reaches every runnable
   * model through provider drill-down and search regardless of this list.
   */
  favoriteModels?: string[];
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

  getFavoriteModels(): string[] {
    return this.read().favoriteModels ?? [];
  }

  setFavoriteModels(keys: string[]): void {
    const settings = this.read();
    // De-duplicated and sorted so the stored list is stable to diff and read.
    settings.favoriteModels = [...new Set(keys)].sort();
    this.write(settings);
  }

  private read(): StoredSettings {
    if (!existsSync(this.filePath)) return { providers: [] };
    try {
      const encrypted = Buffer.from(readFileSync(this.filePath, 'utf8'), 'base64');
      const value = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(value) as Partial<StoredSettings>;
      /*
       * Every field has to be carried through. This used to return only
       * `providers` and `defaultModel`, so `uiFlags`, `defaultApprovalMode` and
       * `favoriteModels` were dropped on every read — which meant not only that
       * they never survived a restart, but that any *other* setting being written
       * silently reset them, because a write starts from `read()`.
       */
      return {
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
        ...(parsed.defaultModel ? { defaultModel: parsed.defaultModel } : {}),
        ...(parsed.uiFlags ? { uiFlags: parsed.uiFlags } : {}),
        ...(parsed.defaultApprovalMode
          ? { defaultApprovalMode: parsed.defaultApprovalMode }
          : {}),
        // `visibleModels` is the previous name for this list; read it so a
        // selection made before the rename is not silently discarded.
        ...(Array.isArray(parsed.favoriteModels)
          ? { favoriteModels: parsed.favoriteModels }
          : Array.isArray((parsed as { visibleModels?: string[] }).visibleModels)
            ? { favoriteModels: (parsed as { visibleModels?: string[] }).visibleModels }
            : {}),
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
