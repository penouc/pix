import { mkdtemp, rm } from 'node:fs/promises';
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
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => userData,
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
    shell: { openExternal: vi.fn() },
  };
});

vi.mock('electron', () => electron);

let userData = '';

beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'pi-desktop-main-ipc-'));
  electron.setUserData(userData);
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true });
});

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
      expect(listed).toMatchObject({ ok: true, data: [expect.objectContaining({ id: expect.any(String) })] });
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  }, 30_000);
});
