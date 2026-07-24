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
import { DesktopDatabase } from '@pi-desktop/database';
import {
  IpcChannels,
  errResult,
  okResult,
  parseDesktopAgentEvent,
  parseIpcCommand,
  type IpcResult,
  type CheckpointRecoverySummary,
  type ModelInfo,
  type ProviderSetting,
  type ProjectSummary,
  type SessionSummary,
} from '@pi-desktop/protocol';

import { getWorkingTreeDiff } from './git/git-diff-service.js';
import {
  captureCheckpointBaseline,
  checkpointId,
} from './checkpoints/checkpoint-baseline-service.js';
import { CheckpointRecoveryService } from './checkpoints/checkpoint-recovery-service.js';
import { WriteSnapshotCoordinator } from './checkpoints/write-snapshot-coordinator.js';
import { ProviderSettingsStore } from './providers/provider-settings-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let runtime: AgentRuntime | null = null;
let desktopDb: DesktopDatabase | null = null;
let desktopDbInit: Promise<DesktopDatabase> | null = null;
let writeSnapshots: WriteSnapshotCoordinator | null = null;
let checkpointRecovery: CheckpointRecoveryService | null = null;
let providerSettings: ProviderSettingsStore | null = null;
let persistedProviderKeysApplied = false;
const RESOLVED_CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function getProviderSettings(): ProviderSettingsStore {
  providerSettings ??= new ProviderSettingsStore(
    path.join(app.getPath('userData'), 'provider-settings.enc'),
  );
  return providerSettings;
}

async function applyPersistedProviderKeys(agent: AgentRuntime): Promise<void> {
  if (persistedProviderKeysApplied || !agent.configureProvider) return;
  for (const { providerId, apiKey } of getProviderSettings().getApiKeys()) {
    await agent.configureProvider(providerId, apiKey);
  }
  persistedProviderKeysApplied = true;
}

async function getDb(): Promise<DesktopDatabase> {
  if (desktopDb) return desktopDb;
  if (desktopDbInit) return desktopDbInit;

  desktopDbInit = (async () => {
    const userData = app.getPath('userData');
    const dbPath = path.join(userData, 'pi-desktop.sqlite');
    const db = DesktopDatabase.open(dbPath);
    try {
      const migrated = await db.migrateLegacyJson(userData);
      if (migrated.sessions > 0 || migrated.projects > 0) {
        console.warn(
          `[main] migrated legacy JSON → SQLite (sessions=${migrated.sessions}, projects=${migrated.projects})`,
        );
      }
    } catch (error) {
      console.error('[main] legacy JSON migration failed', error);
    }
    desktopDb = db;
    return db;
  })();

  return desktopDbInit;
}

async function initializeCheckpointRecovery(): Promise<void> {
  const db = await getDb();
  checkpointRecovery ??= new CheckpointRecoveryService(db.checkpoints);
  const recoverable = checkpointRecovery.listRecoverable();
  if (recoverable.length > 0) {
    console.warn(`[main] ${recoverable.length} unresolved checkpoint(s) available for recovery`);
  }
  const cleanup = await checkpointRecovery.cleanupResolved(
    Date.now() - RESOLVED_CHECKPOINT_RETENTION_MS,
  );
  if (cleanup.deletedCheckpoints > 0) {
    console.warn(`[main] removed ${cleanup.deletedCheckpoints} expired resolved checkpoint(s)`);
  }
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

/**
 * Pi SDK sessions are intentionally in-memory. Rebuild the SDK-side session
 * lazily from the SQLite record after a desktop restart, retaining the
 * Desktop session id so all subsequent IPC/events keep the persisted scope.
 */
async function ensurePersistedRuntimeSession(
  agent: AgentRuntime,
  session: SessionSummary,
  projectPath: string,
): Promise<void> {
  try {
    await agent.resumeSession(session.id);
    return;
  } catch {
    // This is expected after Main restarts; do not surface an internal SDK
    // implementation detail to the renderer.
  }
  await agent.createSession({
    id: session.id,
    projectId: session.projectId,
    projectPath,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

export async function handleInvoke(raw: unknown): Promise<IpcResult> {
  const parsed = parseIpcCommand(raw);
  if (!parsed.success) {
    return errResult('INVALID_COMMAND', parsed.error.message);
  }

  const cmd = parsed.data;
  const agent = ensureRuntime();
  await applyPersistedProviderKeys(agent);
  const db = await getDb();
  const projects = db.projects;
  const sessions = db.sessions;
  checkpointRecovery ??= new CheckpointRecoveryService(db.checkpoints);

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
          runtimeMode: process.env['PI_DESKTOP_FAKE_RUNTIME'] === '1' ? 'fake' : 'pi',
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
      case 'git.getWorkingTreeDiff': {
        const project = projects.get(cmd.params.projectId);
        if (!project) {
          return errResult('PROJECT_NOT_FOUND', `Project ${cmd.params.projectId} not found`);
        }
        if (!project.trusted) {
          return errResult('PROJECT_UNTRUSTED', 'Trust the project before reviewing its diff.');
        }
        if (!project.isGit) {
          return errResult('PROJECT_NOT_GIT', 'The selected project is not a Git repository.');
        }
        return okResult(await getWorkingTreeDiff(project.id, project.path));
      }
      case 'provider.list': {
        return okResult(getProviderSettings().list() satisfies ProviderSetting[]);
      }
      case 'provider.saveApiKey': {
        getProviderSettings().saveApiKey(cmd.params.providerId, cmd.params.apiKey);
        await agent.configureProvider?.(cmd.params.providerId, cmd.params.apiKey);
        return okResult({ configured: true });
      }
      case 'provider.remove': {
        getProviderSettings().remove(cmd.params.providerId);
        await agent.removeProviderConfiguration?.(cmd.params.providerId);
        return okResult({ configured: false });
      }
      case 'settings.get': {
        return okResult({ defaultModel: getProviderSettings().getDefaultModel() });
      }
      case 'settings.setDefaultModel': {
        getProviderSettings().setDefaultModel(cmd.params.model);
        return okResult({ defaultModel: cmd.params.model });
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
        let model = cmd.params.model ?? getProviderSettings().getDefaultModel();
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
        if (!meta) {
          return errResult('SESSION_NOT_FOUND', `Session ${cmd.params.sessionId} not found`);
        }
        const project = projects.get(meta.projectId);
        if (!project) {
          return errResult('PROJECT_NOT_FOUND', `Project ${meta.projectId} not found`);
        }
        if (!project.trusted) {
          return errResult('PROJECT_UNTRUSTED', 'Project is not trusted.');
        }
        await ensurePersistedRuntimeSession(agent, meta, project.path);
        const baseline = await captureCheckpointBaseline(project.path);
        const checkpoint = await db.checkpoints.createBaseline({
          ...baseline,
          id: checkpointId(),
          projectId: project.id,
          sessionId: meta.id,
        });
        writeSnapshots ??= new WriteSnapshotCoordinator(db.checkpoints);
        agent.setBeforeWriteToolHandler?.(({ runId, path: toolPath }) =>
          writeSnapshots!.snapshotBeforeWrite(runId, toolPath).then(() => undefined),
        );
        agent.setAfterWriteToolHandler?.(({ runId, path: toolPath }) =>
          writeSnapshots!.recordExpectedStateAfterWrite(runId, toolPath),
        );
        let ref;
        try {
          ref = await agent.sendMessage(cmd.params.sessionId, {
            text: cmd.params.text,
            model: cmd.params.model,
          });
        } catch (error) {
          await db.checkpoints.discard(checkpoint.id);
          throw error;
        }
        writeSnapshots.associateRun(ref.runId, checkpoint.id, project.path);
        await db.checkpoints.attachRun({
          checkpointId: checkpoint.id,
          runId: ref.runId,
          projectId: project.id,
          sessionId: meta.id,
        });
        await sessions.touch(cmd.params.sessionId);
        return okResult(ref);
      }
      case 'agent.steer': {
        await agent.steer(cmd.params.runId, { text: cmd.params.text });
        return okResult({ ok: true });
      }
      case 'agent.followUp': {
        const meta = sessions.get(cmd.params.sessionId);
        if (!meta) {
          return errResult('SESSION_NOT_FOUND', `Session ${cmd.params.sessionId} not found`);
        }
        const project = projects.get(meta.projectId);
        if (!project) {
          return errResult('PROJECT_NOT_FOUND', `Project ${meta.projectId} not found`);
        }
        if (!project.trusted) {
          return errResult('PROJECT_UNTRUSTED', 'Project is not trusted.');
        }
        await ensurePersistedRuntimeSession(agent, meta, project.path);
        await agent.followUp(cmd.params.sessionId, {
          text: cmd.params.text,
          model: cmd.params.model,
        });
        await sessions.touch(cmd.params.sessionId);
        return okResult({ ok: true });
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
      case 'checkpoint.listRecoverable': {
        return okResult(
          checkpointRecovery.listRecoverable().flatMap((checkpoint) =>
            checkpoint.runId
              ? [
                  {
                    runId: checkpoint.runId,
                    projectId: checkpoint.projectId,
                    sessionId: checkpoint.sessionId,
                    workspacePath: checkpoint.workspacePath,
                    createdAt: checkpoint.createdAt,
                  } satisfies CheckpointRecoverySummary,
                ]
              : [],
          ),
        );
      }
      case 'checkpoint.review': {
        return okResult(await checkpointRecovery.review(cmd.params.runId));
      }
      case 'checkpoint.keep': {
        await checkpointRecovery.keep(cmd.params.runId);
        return okResult({ outcome: 'kept' });
      }
      case 'checkpoint.continue': {
        await checkpointRecovery.continue(cmd.params.runId);
        return okResult({ outcome: 'continued' });
      }
      case 'checkpoint.revertFile': {
        return okResult(await checkpointRecovery.revertFile(cmd.params.runId, cmd.params.path));
      }
      case 'checkpoint.revertAll': {
        return okResult(await checkpointRecovery.revertAll(cmd.params.runId));
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
  void initializeCheckpointRecovery().catch((error) => {
    console.error('[main] checkpoint recovery initialization failed', error);
  });
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
  desktopDb?.close();
  desktopDb = null;
  desktopDbInit = null;
  providerSettings = null;
  persistedProviderKeysApplied = false;
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
