import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgentRuntime,
  describeAuthSources,
  PI_SDK_PACKAGES,
  type ProviderAuthSummary,
} from '@pi-desktop/agent-pi';
import type { AgentRuntime } from '@pi-desktop/agent-domain';
import {
  IpcChannels,
  errResult,
  okResult,
  parseDesktopAgentEvent,
  parseIpcCommand,
  type IpcResult,
  type ModelInfo,
  type ProjectSummary,
  type SessionSummary,
} from '@pi-desktop/protocol';

import { ProjectStore } from './project-store.js';
import { SessionStore } from './session-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runtime: AgentRuntime | null = null;
let projectStore: ProjectStore | null = null;
let sessionStore: SessionStore | null = null;

function getProjectStore(): ProjectStore {
  if (!projectStore) {
    projectStore = new ProjectStore(path.join(app.getPath('userData'), 'recent-projects.json'));
  }
  return projectStore;
}

function getSessionStore(): SessionStore {
  if (!sessionStore) {
    sessionStore = new SessionStore(path.join(app.getPath('userData'), 'sessions.json'));
  }
  return sessionStore;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'Pi Agent Desktop',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['VITE_DEV_SERVER_URL']) {
    void mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function broadcastEvent(event: unknown): void {
  const parsed = parseDesktopAgentEvent(event);
  if (!parsed.success) {
    console.error('[main] dropping invalid agent event', parsed.error.flatten());
    return;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.event, parsed.data);
  }
}

function ensureRuntime(): AgentRuntime {
  if (!runtime) {
    const agentDir = path.join(app.getPath('userData'), 'pi-agent');
    runtime = createAgentRuntime({
      agentDir,
      allowModelNetwork: false,
      forceFake: process.env['PI_DESKTOP_FAKE_RUNTIME'] === '1',
    });
    runtime.subscribe((event) => broadcastEvent(event));
    console.warn(
      `[main] AgentRuntime ready (Pi ${PI_SDK_PACKAGES.codingAgent}@${PI_SDK_PACKAGES.version}, agentDir=${agentDir})`,
    );
  }
  return runtime;
}

async function handleInvoke(raw: unknown): Promise<IpcResult> {
  const parsed = parseIpcCommand(raw);
  if (!parsed.success) {
    return errResult('INVALID_COMMAND', parsed.error.message);
  }

  const cmd = parsed.data;
  const agent = ensureRuntime();
  const projects = getProjectStore();
  const sessions = getSessionStore();
  await projects.init();
  await sessions.init();

  try {
    switch (cmd.method) {
      case 'app.getInfo': {
        const auth = await readAuthStatus(agent);
        return okResult({
          name: 'Pi Agent Desktop',
          version: app.getVersion(),
          platform: process.platform,
          electron: process.versions.electron,
          piSdk: `${PI_SDK_PACKAGES.codingAgent}@${PI_SDK_PACKAGES.version}`,
          runtimeMode:
            process.env['PI_DESKTOP_FAKE_RUNTIME'] === '1' ? 'fake' : 'pi',
          authProviders: describeAuthSources(auth),
        });
      }
      case 'project.open': {
        const project = await projects.open(cmd.params.path);
        return okResult(project satisfies ProjectSummary);
      }
      case 'project.pickFolder': {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory', 'createDirectory'],
              title: 'Open project folder',
            })
          : await dialog.showOpenDialog({
              properties: ['openDirectory', 'createDirectory'],
              title: 'Open project folder',
            });
        if (result.canceled || !result.filePaths[0]) {
          return errResult('CANCELLED', 'Folder picker cancelled');
        }
        const project = await projects.open(result.filePaths[0]);
        return okResult(project satisfies ProjectSummary);
      }
      case 'project.listRecent': {
        return okResult(projects.listRecent());
      }
      case 'project.setTrust': {
        const project = await projects.setTrust(cmd.params.projectId, cmd.params.trusted);
        return okResult(project);
      }
      case 'session.create': {
        const project = projects.get(cmd.params.projectId);
        if (!project) {
          return errResult('PROJECT_NOT_FOUND', `Project ${cmd.params.projectId} not found`);
        }
        if (!project.trusted) {
          return errResult(
            'PROJECT_UNTRUSTED',
            'Project is not trusted. Confirm Workspace Trust before creating a session.',
          );
        }
        let model = cmd.params.model;
        if (!model && typeof agent.pickDefaultModel === 'function') {
          model = (await agent.pickDefaultModel()) ?? undefined;
        }
        const runtimeSession = await agent.createSession({
          projectId: project.id,
          projectPath: project.path,
          title: cmd.params.title,
          model,
        });
        const summary = await sessions.put({
          id: runtimeSession.id,
          projectId: runtimeSession.projectId,
          title: runtimeSession.title,
          createdAt: runtimeSession.createdAt,
          updatedAt: runtimeSession.updatedAt,
          archived: false,
        });
        return okResult(summary satisfies SessionSummary);
      }
      case 'session.list': {
        return okResult(sessions.listByProject(cmd.params.projectId));
      }
      case 'session.rename': {
        const summary = await sessions.rename(cmd.params.sessionId, cmd.params.title);
        return okResult(summary);
      }
      case 'session.archive': {
        const summary = await sessions.archive(cmd.params.sessionId, cmd.params.archived);
        return okResult(summary);
      }
      case 'agent.sendMessage': {
        const meta = sessions.get(cmd.params.sessionId);
        if (meta) {
          const project = projects.get(meta.projectId);
          if (project && !project.trusted) {
            return errResult('PROJECT_UNTRUSTED', 'Project is not trusted.');
          }
        }
        const ref = await agent.sendMessage(cmd.params.sessionId, {
          text: cmd.params.text,
          model: cmd.params.model,
        });
        await sessions.touch(cmd.params.sessionId);
        return okResult(ref);
      }
      case 'agent.abort': {
        await agent.abort(cmd.params.runId);
        return okResult({ aborted: true });
      }
      case 'agent.setModel': {
        await agent.setModel(cmd.params.sessionId, cmd.params.model);
        return okResult({ ok: true });
      }
      case 'agent.resolveApproval': {
        await agent.approve(cmd.params.requestId, cmd.params.decision);
        return okResult({ ok: true });
      }
      case 'agent.listModels': {
        return okResult((await agent.listModels()) as ModelInfo[]);
      }
      case 'agent.authStatus': {
        return okResult(await readAuthStatus(agent));
      }
      default: {
        const _exhaustive: never = cmd;
        return errResult('UNHANDLED', `Unhandled command ${JSON.stringify(_exhaustive)}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'INTERNAL';
    return errResult(code, message);
  }
}

app.whenReady().then(() => {
  ipcMain.handle(IpcChannels.invoke, async (_event, raw: unknown) => handleInvoke(raw));
  void getProjectStore().init();
  void getSessionStore().init();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void runtime?.dispose();
  runtime = null;
});

async function readAuthStatus(agent: AgentRuntime): Promise<ProviderAuthSummary[]> {
  if (typeof agent.getAuthStatus === 'function') {
    const rows = await agent.getAuthStatus();
    return rows.map((r) => ({
      providerId: r.providerId,
      hasAuth: r.hasAuth,
      source: (r.source as ProviderAuthSummary['source']) ?? 'none',
    }));
  }
  return [];
}
