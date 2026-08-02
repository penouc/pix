import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

import type { UpdateState } from '@pi-desktop/protocol';

/** Main-process boundary for release updates. */
export class UpdateService {
  private state: UpdateState = {
    status: app.isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
  };

  constructor() {
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => this.setState(this.availableState(info)));
    autoUpdater.on('update-not-available', () => this.setState({ status: 'not-available' }));
    autoUpdater.on('download-progress', (progress) =>
      this.setState({ status: 'downloading', progress: Math.round(progress.percent) }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.setState({ ...this.availableState(info), status: 'downloaded', progress: 100 }),
    );
    autoUpdater.on('error', (error) => {
      console.error('[updates]', error);
      this.setState({ status: 'error', error: error.message });
    });
  }

  configure(autoDownload: boolean): void {
    autoUpdater.autoDownload = autoDownload;
    autoUpdater.autoInstallOnAppQuit = autoDownload;
  }

  getState(): UpdateState {
    return this.state;
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return this.setState({ status: 'unsupported' });
    await autoUpdater.checkForUpdates();
    return this.state;
  }

  async download(): Promise<UpdateState> {
    if (!app.isPackaged) return this.setState({ status: 'unsupported' });
    await autoUpdater.downloadUpdate();
    return this.state;
  }

  install(): void {
    if (this.state.status === 'downloaded') autoUpdater.quitAndInstall(false, true);
  }

  private availableState(info: UpdateInfo): UpdateState {
    return {
      status: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    };
  }

  private setState(next: Omit<UpdateState, 'currentVersion'>): UpdateState {
    this.state = { currentVersion: app.getVersion(), ...next };
    return this.state;
  }
}
