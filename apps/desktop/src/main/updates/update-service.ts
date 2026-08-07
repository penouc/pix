import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { AppUpdater, UpdateInfo } from 'electron-updater';

import type { UpdateState } from '@pi-desktop/protocol';

/** Lazy: accessing `autoUpdater` constructs ElectronAppAdapter and needs a real Electron `app`. */
function getAutoUpdater(): AppUpdater {
  // electron-updater is CJS with a lazy getter; ESM named imports fail at runtime.
  return electronUpdater.autoUpdater;
}

/** Main-process boundary for release updates. */
export class UpdateService {
  private state: UpdateState = {
    status: app.isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
  };
  private readonly listeners = new Set<(state: UpdateState) => void>();

  constructor() {
    const autoUpdater = getAutoUpdater();
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => this.setState(this.availableState(info)));
    autoUpdater.on('update-not-available', () => this.setState({ status: 'not-available' }));
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      // Skip no-op repeats so the renderer is not flooded at high tick rates.
      if (this.state.status === 'downloading' && this.state.progress === percent) return;
      this.setState({ status: 'downloading', progress: percent });
    });
    autoUpdater.on('update-downloaded', (info) =>
      this.setState({ ...this.availableState(info), status: 'downloaded', progress: 100 }),
    );
    autoUpdater.on('error', (error) => {
      console.error('[updates]', error);
      this.setState({ status: 'error', error: error.message });
    });
  }

  /** Push live status (incl. download %) to the renderer. */
  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  configure(autoDownload: boolean): void {
    const autoUpdater = getAutoUpdater();
    autoUpdater.autoDownload = autoDownload;
    autoUpdater.autoInstallOnAppQuit = autoDownload;
  }

  getState(): UpdateState {
    return this.state;
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return this.setState({ status: 'unsupported' });
    await getAutoUpdater().checkForUpdates();
    return this.state;
  }

  async download(): Promise<UpdateState> {
    if (!app.isPackaged) return this.setState({ status: 'unsupported' });
    // Emit immediately so Settings can show 0% before the first progress tick.
    this.setState({ status: 'downloading', progress: this.state.progress ?? 0 });
    await getAutoUpdater().downloadUpdate();
    return this.state;
  }

  install(): void {
    if (this.state.status === 'downloaded') getAutoUpdater().quitAndInstall(false, true);
  }

  private availableState(info: UpdateInfo): Omit<UpdateState, 'currentVersion'> {
    return {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
  }

  private setState(next: Omit<UpdateState, 'currentVersion'>): UpdateState {
    // Download ticks only send status+progress — keep version/notes from
    // update-available. Terminal statuses drop the previous release payload.
    const keepReleaseMeta =
      next.status === 'downloading' ||
      next.status === 'downloaded' ||
      next.status === 'available';

    this.state = {
      currentVersion: app.getVersion(),
      ...(keepReleaseMeta
        ? {
            version: this.state.version,
            releaseDate: this.state.releaseDate,
            releaseNotes: this.state.releaseNotes,
            progress: this.state.progress,
          }
        : {}),
      ...next,
      error: next.status === 'error' ? next.error : undefined,
    };
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }
}
