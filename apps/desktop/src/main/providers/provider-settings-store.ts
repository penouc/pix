import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  autoUpdate: boolean;
  defaultProjectsFolder: string;
}

const DEFAULT_UI_FLAGS: UiFlags = {
  trustNewProjects: false,
  // Opening a previous folder on launch would touch the user's disk (and can
  // surface OS folder prompts) before they have done anything. Stay dark until
  // they pick a project.
  reopenLastProject: false,
  // A paused run is the one thing that genuinely needs to interrupt you.
  notifyApprovalRequired: true,
  notifyRunFinished: true,
  notifyAutomationOpenedTask: false,
  notifyPlaySound: false,
  notifyBadgeDock: true,
  notifyOnlyWhenBackground: true,
  autoUpdate: true,
  defaultProjectsFolder: '',
};

export type StoredApprovalMode = 'ask' | 'auto-reads' | 'read-only';

/** Secrets only — never mixed with plain preferences. */
interface EncryptedSettings {
  providers: StoredProvider[];
}

/**
 * Non-secret preferences. Kept as plain JSON so cold start (auto-update flag,
 * approval defaults, model pin list) never has to open the Keychain-backed
 * safeStorage blob just to draw the window.
 */
interface PlainPreferences {
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

/** Legacy shape: secrets + prefs were one encrypted blob. */
interface LegacyStoredSettings extends EncryptedSettings, PlainPreferences {}

export interface ProviderSettingSummary {
  providerId: string;
  configured: boolean;
}

/** Main-only provider credentials (encrypted) + plain app preferences. */
export class ProviderSettingsStore {
  private readonly prefsPath: string;

  constructor(private readonly filePath: string) {
    // Sit next to the encrypted blob so uninstall still means "delete one folder".
    this.prefsPath = path.join(path.dirname(filePath), 'app-preferences.json');
  }

  list(): ProviderSettingSummary[] {
    return this.readEncrypted().providers.map(({ providerId }) => ({
      providerId,
      configured: true,
    }));
  }

  getApiKeys(): StoredProvider[] {
    return this.readEncrypted().providers;
  }

  saveApiKey(providerId: string, apiKey: string): void {
    const settings = this.readEncrypted();
    const providers = settings.providers.filter((entry) => entry.providerId !== providerId);
    providers.push({ providerId, apiKey });
    this.writeEncrypted({ providers });
  }

  remove(providerId: string): void {
    const settings = this.readEncrypted();
    this.writeEncrypted({
      providers: settings.providers.filter((entry) => entry.providerId !== providerId),
    });
  }

  getDefaultModel(): ModelRef | undefined {
    return this.readPrefs().defaultModel;
  }

  getUiFlags(): UiFlags {
    return { ...DEFAULT_UI_FLAGS, ...(this.readPrefs().uiFlags ?? {}) };
  }

  getDefaultApprovalMode(): StoredApprovalMode {
    return this.readPrefs().defaultApprovalMode ?? 'auto-reads';
  }

  setDefaultApprovalMode(mode: StoredApprovalMode): void {
    const prefs = this.readPrefs();
    prefs.defaultApprovalMode = mode;
    this.writePrefs(prefs);
  }

  setDefaultProjectsFolder(folder: string): void {
    const prefs = this.readPrefs();
    prefs.uiFlags = { ...(prefs.uiFlags ?? {}), defaultProjectsFolder: folder };
    this.writePrefs(prefs);
  }

  setUiFlag<K extends keyof UiFlags>(key: K, value: UiFlags[K]): void {
    const prefs = this.readPrefs();
    prefs.uiFlags = { ...(prefs.uiFlags ?? {}), [key]: value };
    this.writePrefs(prefs);
  }

  setDefaultModel(model: ModelRef | undefined): void {
    const prefs = this.readPrefs();
    if (model) prefs.defaultModel = model;
    else delete prefs.defaultModel;
    this.writePrefs(prefs);
  }

  getFavoriteModels(): string[] {
    return this.readPrefs().favoriteModels ?? [];
  }

  setFavoriteModels(keys: string[]): void {
    const prefs = this.readPrefs();
    // De-duplicated and sorted so the stored list is stable to diff and read.
    prefs.favoriteModels = [...new Set(keys)].sort();
    this.writePrefs(prefs);
  }

  private readEncrypted(): EncryptedSettings {
    this.migrateLegacyIfNeeded();
    if (!existsSync(this.filePath)) return { providers: [] };
    try {
      const encrypted = Buffer.from(readFileSync(this.filePath, 'utf8'), 'base64');
      const value = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(value) as Partial<LegacyStoredSettings>;
      return {
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      };
    } catch {
      return { providers: [] };
    }
  }

  private writeEncrypted(settings: EncryptedSettings): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS Keychain encryption is unavailable for Provider settings.');
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify({ providers: settings.providers }));
    writeFileSync(this.filePath, encrypted.toString('base64'), { mode: 0o600 });
  }

  private readPrefs(): PlainPreferences {
    this.migrateLegacyIfNeeded();
    if (!existsSync(this.prefsPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.prefsPath, 'utf8')) as Partial<PlainPreferences>;
      return {
        ...(parsed.defaultModel ? { defaultModel: parsed.defaultModel } : {}),
        ...(parsed.uiFlags ? { uiFlags: parsed.uiFlags } : {}),
        ...(parsed.defaultApprovalMode
          ? { defaultApprovalMode: parsed.defaultApprovalMode }
          : {}),
        ...(Array.isArray(parsed.favoriteModels)
          ? { favoriteModels: parsed.favoriteModels }
          : Array.isArray((parsed as { visibleModels?: string[] }).visibleModels)
            ? { favoriteModels: (parsed as { visibleModels?: string[] }).visibleModels }
            : {}),
      };
    } catch {
      return {};
    }
  }

  private writePrefs(prefs: PlainPreferences): void {
    mkdirSync(path.dirname(this.prefsPath), { recursive: true });
    writeFileSync(this.prefsPath, `${JSON.stringify(prefs, null, 2)}\n`, { mode: 0o600 });
  }

  /**
   * One-shot: older builds stored uiFlags / defaultModel / favorites inside the
   * encrypted blob. Pull non-secrets into the plain prefs file and rewrite the
   * blob as secrets-only, so subsequent cold starts never touch safeStorage.
   */
  private migrateLegacyIfNeeded(): void {
    if (!existsSync(this.filePath) || existsSync(this.prefsPath)) return;
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const encrypted = Buffer.from(readFileSync(this.filePath, 'utf8'), 'base64');
      const value = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(value) as Partial<LegacyStoredSettings>;
      const hasPlain =
        parsed.defaultModel != null ||
        parsed.uiFlags != null ||
        parsed.defaultApprovalMode != null ||
        Array.isArray(parsed.favoriteModels) ||
        Array.isArray((parsed as { visibleModels?: string[] }).visibleModels);
      if (!hasPlain) {
        // Secrets-only already (or empty). Still write an empty prefs file so we
        // do not re-enter migrate on every read.
        this.writePrefs({});
        return;
      }

      const prefs: PlainPreferences = {
        ...(parsed.defaultModel ? { defaultModel: parsed.defaultModel } : {}),
        ...(parsed.uiFlags ? { uiFlags: parsed.uiFlags } : {}),
        ...(parsed.defaultApprovalMode
          ? { defaultApprovalMode: parsed.defaultApprovalMode }
          : {}),
        ...(Array.isArray(parsed.favoriteModels)
          ? { favoriteModels: parsed.favoriteModels }
          : Array.isArray((parsed as { visibleModels?: string[] }).visibleModels)
            ? { favoriteModels: (parsed as { visibleModels?: string[] }).visibleModels }
            : {}),
      };
      this.writePrefs(prefs);
      this.writeEncrypted({
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      });
    } catch {
      // Leave the blob alone; read paths already fall back to empty.
    }
  }
}
