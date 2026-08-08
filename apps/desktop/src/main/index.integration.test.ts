import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

interface TestWindow {
  webContents: { send: ReturnType<typeof vi.fn> };
}

const electron = vi.hoisted(() => {
  let userData = '';
  const windows: TestWindow[] = [];
  const callbacks = new Map<string, () => void>();
  return {
    setUserData: (value: string) => {
      userData = value;
    },
    /** Fire a registered `app.on` listener (tests use this to close SQLite). */
    emitApp: (event: string) => {
      callbacks.get(event)?.();
    },
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => userData,
      getAppPath: () => userData,
      isPackaged: true,
      setPath: (_name: string, value: string) => {
        userData = value;
      },
      setName: vi.fn(),
      setAppUserModelId: vi.fn(),
      getVersion: () => 'test',
      on: (event: string, callback: () => void) => callbacks.set(event, callback),
    },
    BrowserWindow: class {
      static getAllWindows(): TestWindow[] {
        return windows;
      }
      webContents = {
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        openDevTools: vi.fn(),
      };
      constructor() {
        windows.push(this);
      }
      loadFile = vi.fn();
      loadURL = vi.fn();
      on = vi.fn();
    },
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: { handle: vi.fn() },
    nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => true })) },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    session: {
      defaultSession: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8'),
    },
  };
});

vi.mock('electron', () => electron);

// electron-updater's CJS require('electron') bypasses the Vitest mock and crashes
// without a real Electron app; stub the updater for Main IPC integration tests.
vi.mock('electron-updater', () => {
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  };
  return { default: { autoUpdater }, autoUpdater };
});

let userData = '';

beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'pi-desktop-main-ipc-'));
  electron.setUserData(userData);
});

afterAll(async () => {
  // Close the Main-process SQLite handle before deleting userData. On Windows
  // an open DatabaseSync keeps pi-desktop.sqlite locked (EBUSY on unlink).
  electron.emitApp('before-quit');
  await removeWithRetry(userData);
});

/** Retry removal: Windows can hold file handles for a tick after close(). */
async function removeWithRetry(target: string, attempts = 16): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (attempt >= attempts - 1 || (code !== 'EBUSY' && code !== 'EPERM')) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

describe('Main IPC with real Pi runtime (offline)', () => {
  it('creates a Pi-backed session through typed IPC without a provider request', async () => {
    const { handleInvoke } = await import('./index.js');

    const projectPath = await mkdtemp(path.join(tmpdir(), 'pi-desktop-project-'));
    try {
      const opened = await handleInvoke({ method: 'project.open', params: { path: projectPath } });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const project = opened.data as { id: string };

      const trusted = await handleInvoke({
        method: 'project.setTrust',
        params: { projectId: project.id, trusted: true },
      });
      expect(trusted).toMatchObject({ ok: true, data: { trusted: true } });

      const created = await handleInvoke({
        method: 'session.create',
        params: { projectId: project.id, title: 'Offline Pi IPC' },
      });
      expect(created).toMatchObject({
        ok: true,
        data: { projectId: project.id, title: 'Offline Pi IPC', archived: false },
      });

      const listed = await handleInvoke({
        method: 'session.list',
        params: { projectId: project.id },
      });
      expect(listed).toMatchObject({
        ok: true,
        data: [expect.objectContaining({ id: expect.any(String) })],
      });
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  }, 30_000);

  it('serves the file tree only for a trusted project', async () => {
    const { handleInvoke } = await import('./index.js');

    const projectPath = await mkdtemp(path.join(tmpdir(), 'pi-desktop-tree-'));
    try {
      await writeFile(path.join(projectPath, 'a.ts'), 'const a = 1;\n');
      const opened = await handleInvoke({ method: 'project.open', params: { path: projectPath } });
      if (!opened.ok) throw new Error('project.open failed');
      const project = opened.data as { id: string; trusted: boolean };

      // Untrusted is the default, and the shape of the project is as private as
      // its contents.
      if (!project.trusted) {
        const refused = await handleInvoke({
          method: 'index.tree',
          params: { projectId: project.id },
        });
        expect(refused).toMatchObject({ ok: false, error: { code: 'PROJECT_UNTRUSTED' } });
      }

      await handleInvoke({
        method: 'project.setTrust',
        params: { projectId: project.id, trusted: true },
      });
      await handleInvoke({
        method: 'index.rebuild',
        params: { projectId: project.id, force: true },
      });

      const tree = await handleInvoke({ method: 'index.tree', params: { projectId: project.id } });
      expect(tree).toMatchObject({ ok: true, data: { files: ['a.ts'], directories: [] } });
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  }, 30_000);

  it('opens only http(s) links externally', async () => {
    const { handleInvoke, isExternallyOpenable } = await import('./index.js');

    expect(isExternallyOpenable('https://example.com')).toBe(true);
    expect(isExternallyOpenable('http://localhost:5173/x')).toBe(true);
    // A framed page must not be able to hand the OS one of these.
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'zoommtg://x', 'not a url']) {
      expect(isExternallyOpenable(url), url).toBe(false);
    }

    const refused = await handleInvoke({
      method: 'system.openExternal',
      params: { url: 'file:///etc/passwd' },
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_SCHEME' } });
  });
});
