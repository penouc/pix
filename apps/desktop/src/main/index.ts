import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAgentRuntime, PI_SDK_PACKAGES } from '@pi-desktop/agent-pi';
import type { AgentRuntime } from '@pi-desktop/agent-domain';
import {
  IpcChannels,
  errResult,
  okResult,
  parseDesktopAgentEvent,
  parseIpcCommand,
  type IpcResult,
  type ProjectSummary,
  type SessionSummary,
} from '@pi-desktop/protocol';

import { ProjectStore } from './project-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runtime: AgentRuntime | null = null;
const projectStore = new ProjectStore();
/** Maps desktop session id -> project path for runtime create. */
const sessionProjectPath = new Map<string, string>();
const sessionRecords = new Map<string, SessionSummary>();

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
    // Real Pi by default (M1). Set PI_DESKTOP_FAKE_RUNTIME=1 for offline UI.
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

  try {
    switch (cmd.method) {
      case 'app.getInfo': {
        return okResult({
          name: 'Pi Agent Desktop',
          version: app.getVersion(),
          platform: process.platform,
          electron: process.versions.electron,
          piSdk: `${PI_SDK_PACKAGES.codingAgent}@${PI_SDK_PACKAGES.version}`,
          runtimeMode:
            process.env['PI_DESKTOP_FAKE_RUNTIME'] === '1' ? 'fake' : 'pi',
        });
      }
      case 'project.open': {
        const project = await projectStore.open(cmd.params.path);
        return okResult(project satisfies ProjectSummary);
      }
      case 'project.listRecent': {
        return okResult(projectStore.listRecent());
      }
      case 'session.create': {
        const project = projectStore.get(cmd.params.projectId);
        if (!project) {
          return errResult('PROJECT_NOT_FOUND', `Project ${cmd.params.projectId} not found`);
        }
        const session = await agent.createSession({
          projectId: project.id,
          projectPath: project.path,
          title: cmd.params.title,
          model: cmd.params.model,
        });
        const summary: SessionSummary = {
          id: session.id,
          projectId: session.projectId,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          archived: false,
        };
        sessionRecords.set(session.id, summary);
        sessionProjectPath.set(session.id, project.path);
        return okResult(summary);
      }
      case 'session.list': {
        const list = [...sessionRecords.values()].filter(
          (s) => s.projectId === cmd.params.projectId && !s.archived,
        );
        return okResult(list);
      }
      case 'agent.sendMessage': {
        const ref = await agent.sendMessage(cmd.params.sessionId, {
          text: cmd.params.text,
          model: cmd.params.model,
        });
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
        return okResult(await agent.listModels());
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
