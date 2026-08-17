import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentRuntime } from '@pi-desktop/agent-domain';
import type { IpcResult, ProjectSummary } from '@pi-desktop/protocol';

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
      isDestroyed = () => false;
      setTitleBarOverlay = vi.fn();
    },
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: { handle: vi.fn() },
    nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => true })) },
    nativeTheme: {
      shouldUseDarkColors: false,
      on: vi.fn(),
      removeListener: vi.fn(),
    },
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

const agentPi = vi.hoisted(() => ({
  createAgentRuntime: vi.fn(),
}));

vi.mock('electron', () => electron);

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

vi.mock('@pi-desktop/agent-pi', () => ({
  createAgentRuntime: agentPi.createAgentRuntime,
  deriveSessionTitle: (text: string) => text,
  describeAuthSources: () => 'none',
  PI_SDK_PACKAGES: { codingAgent: '@earendil-works/pi-coding-agent', version: 'test' },
  sanitizeSessionTitle: (text: string) => text,
}));

function mockAgent(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    subscribe: vi.fn(),
    setApprovalMode: vi.fn(async () => undefined),
    configureProvider: vi.fn(async () => undefined),
    listModels: vi.fn(async () => []),
    getAuthStatus: vi.fn(async () => []),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  } as AgentRuntime;
}

function expectOk<T>(result: IpcResult, match?: unknown): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok IPC result');
  if (match !== undefined) expect(result.data).toMatchObject(match as object);
  return result.data as T;
}

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

let userData = '';
let handleInvoke: (raw: unknown) => Promise<IpcResult>;

beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'pi-desktop-main-ipc-gate-'));
  electron.setUserData(userData);
  agentPi.createAgentRuntime.mockImplementation(() => mockAgent());
  ({ handleInvoke } = await import('./index.js'));
});

afterAll(async () => {
  electron.emitApp('before-quit');
  await removeWithRetry(userData);
});

describe('Main IPC skips AgentRuntime for first-paint DB commands', () => {
  it('lists recent projects without constructing AgentRuntime', async () => {
    const listed = await handleInvoke({ method: 'project.listRecent' });
    expect(expectOk<ProjectSummary[]>(listed)).toEqual([]);
    expect(agentPi.createAgentRuntime).not.toHaveBeenCalled();
  });

  it('decorates playground projects without constructing AgentRuntime', async () => {
    const opened = await handleInvoke({ method: 'project.openPlayground' });
    const playground = expectOk<ProjectSummary>(opened);
    expect(playground.isPlayground).toBe(true);
    expect(playground.name).toBe('Scratch playground');
    expect(playground.trusted).toBe(true);

    const listed = await handleInvoke({ method: 'project.listRecent' });
    const recent = expectOk<ProjectSummary[]>(listed);
    expect(recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: playground.id,
          isPlayground: true,
          name: 'Scratch playground',
        }),
      ]),
    );
    expect(agentPi.createAgentRuntime).not.toHaveBeenCalled();
  });

  it('does not let settings.get onboarding auth evidence block listRecent', async () => {
    let releaseAuth!: () => void;
    const authGate = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    let enteredAuth = false;
    agentPi.createAgentRuntime.mockImplementation(() =>
      mockAgent({
        getAuthStatus: vi.fn(async () => {
          enteredAuth = true;
          await authGate;
          return [{ providerId: 'openai', hasAuth: true, source: 'env' }];
        }),
      }),
    );

    const settingsPromise = handleInvoke({ method: 'settings.get' });
    await vi.waitFor(() => expect(enteredAuth).toBe(true));

    const started = Date.now();
    const listed = await handleInvoke({ method: 'project.listRecent' });
    expectOk<ProjectSummary[]>(listed);
    expect(Date.now() - started).toBeLessThan(250);

    releaseAuth();
    const settings = await settingsPromise;
    const data = expectOk<{ onboarding: { hasConfiguredAuth: boolean; completed: boolean } }>(
      settings,
    );
    expect(data.onboarding.hasConfiguredAuth).toBe(true);
    expect(data.onboarding.completed).toBe(true);
    expect(agentPi.createAgentRuntime).toHaveBeenCalled();
  });

  it('keeps Workspace Trust closed on project.open without constructing AgentRuntime', async () => {
    const createdBefore = agentPi.createAgentRuntime.mock.calls.length;
    const projectPath = await mkdtemp(path.join(tmpdir(), 'pi-desktop-untrusted-'));
    try {
      await writeFile(path.join(projectPath, 'README.md'), 'hello\n');
      const opened = await handleInvoke({
        method: 'project.open',
        params: { path: projectPath },
      });
      const project = expectOk<ProjectSummary>(opened);
      expect(project.trusted).toBe(false);
      expect(project.isPlayground).toBe(false);

      const listed = await handleInvoke({ method: 'project.listRecent' });
      const recent = expectOk<ProjectSummary[]>(listed);
      expect(recent.some((item) => item.id === project.id && item.trusted === false)).toBe(true);
      expect(agentPi.createAgentRuntime.mock.calls.length).toBe(createdBefore);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it('still constructs AgentRuntime for agent.listModels', async () => {
    const listed = await handleInvoke({ method: 'agent.listModels' });
    expectOk(listed, []);
    expect(agentPi.createAgentRuntime).toHaveBeenCalled();
  });
});

describe('saved provider keys do not block project.listRecent', () => {
  let isolatedHandle: (raw: unknown) => Promise<IpcResult>;

  beforeAll(async () => {
    electron.emitApp('before-quit');
    vi.resetModules();
    agentPi.createAgentRuntime.mockReset();
    ({ handleInvoke: isolatedHandle } = await import('./index.js'));
    // index.ts appends `@pi-desktop/desktop` onto getPath('appData') at load;
    // write keys where the new module actually reads them.
    writeFileSync(
      path.join(electron.app.getPath(), 'provider-settings.enc'),
      Buffer.from(
        JSON.stringify({ providers: [{ providerId: 'openai', apiKey: 'sk-test' }] }),
        'utf8',
      ).toString('base64'),
    );
  });

  it('returns listRecent while configureProvider is still hydrating the catalog', async () => {
    let releaseHydration!: () => void;
    const hydration = new Promise<void>((resolve) => {
      releaseHydration = resolve;
    });
    let hydrating = false;
    const configureProvider = vi.fn(async () => {
      hydrating = true;
      await hydration;
    });
    agentPi.createAgentRuntime.mockImplementation(() =>
      mockAgent({
        configureProvider,
        listModels: vi.fn(async () => []),
      }),
    );

    const modelsPromise = isolatedHandle({ method: 'agent.listModels' });
    await vi.waitFor(() => expect(hydrating).toBe(true));

    const started = Date.now();
    const listed = await isolatedHandle({ method: 'project.listRecent' });
    expectOk<ProjectSummary[]>(listed);
    expect(Date.now() - started).toBeLessThan(250);

    releaseHydration();
    expectOk(await modelsPromise);
    expect(configureProvider).toHaveBeenCalled();
  });
});
