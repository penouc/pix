import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
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

import { describeProtectedPaths } from '@pi-desktop/security';

import { getWorkingTreeDiff } from './git/git-diff-service.js';
import {
  captureCheckpointBaseline,
  checkpointId,
} from './checkpoints/checkpoint-baseline-service.js';
import { CheckpointRecoveryService } from './checkpoints/checkpoint-recovery-service.js';
import { WriteSnapshotCoordinator } from './checkpoints/write-snapshot-coordinator.js';
import { ProviderSettingsStore } from './providers/provider-settings-store.js';
import { DesktopLogger } from './observability/logger.js';
import { RunMetricsStore } from './observability/run-metrics-store.js';
import { NotificationService } from './observability/notification-service.js';
import { readCurrentBranch, searchProjectFiles } from './git/file-search-service.js';
import { IndexService } from './indexing/index-service.js';
import { SkillsService } from './skills/skills-service.js';
import {
  TerminalService,
  DEFAULT_TIMEOUT_MS as TERMINAL_TIMEOUT_MS,
  MAX_OUTPUT_BYTES as TERMINAL_OUTPUT_CAP_BYTES,
} from './terminal/terminal-service.js';
import { AutomationStore } from './automations/automation-store.js';
import { AutomationScheduler } from './automations/automation-scheduler.js';

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
let desktopLogger: DesktopLogger | null = null;
const runMetrics = new RunMetricsStore();
runMetrics.onFinished = (metrics) => {
  void getDb()
    .then((db) => db.runMetrics.record(metrics))
    .catch((error) => console.error('[main] persisting run metrics failed', error));
};
let skillsService: SkillsService | null = null;
let terminalService: TerminalService | null = null;
let automationStore: AutomationStore | null = null;
let automationScheduler: AutomationScheduler | null = null;
let notifications: NotificationService | null = null;

/**
 * Titles waiting to be applied, keyed by session. A task is created before its
 * first message exists, so it starts as "New task"; the first prompt is the
 * best description of it we have. Applied when the first run finishes rather
 * than on send, so a task that fails immediately keeps its neutral name.
 */
const pendingSessionTitles = new Map<string, string>();

/** Names still considered "unnamed" and safe to replace. */
const DEFAULT_SESSION_TITLES = new Set(['New task', 'Session']);

/**
 * Derive a task name from the first prompt. Deliberately not an LLM call: it
 * would cost a request and a round-trip per task for a sidebar label, and this
 * is both free and predictable.
 */
export function deriveSessionTitle(text: string): string | null {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    // Skip fences, quotes and headings — the first prose line is the intent.
    .find((line) => line.length > 0 && !/^([`>#\-*]|\d+\.)/.test(line));
  if (!firstLine) return null;

  const cleaned = firstLine
    // Drop inline markdown emphasis/code markers without touching the words.
    .replace(/[`*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 3) return null;

  const capped = cleaned.length > 72 ? `${cleaned.slice(0, 71).trimEnd()}…` : cleaned;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function getNotifications(): NotificationService {
  notifications ??= new NotificationService(() => getProviderSettings().getUiFlags());
  return notifications;
}

// M8-1: Message delta batching (§14.1) — coalesce rapid streaming deltas
// to reduce IPC pressure without adding noticeable latency.
const DELTA_FLUSH_INTERVAL_MS = 16;
const MAX_BUFFERED_DELTAS = 500;
let deltaBuffer: unknown[] = [];
let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushDeltaBuffer(): void {
  deltaFlushTimer = null;
  if (deltaBuffer.length === 0) return;
  const events = deltaBuffer;
  deltaBuffer = [];
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    for (const ev of events) {
      win.webContents.send(IpcChannels.event, ev);
    }
  }
}

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

/**
 * Count local audit events for the Permissions tab. There are two writers: the
 * agent pipeline (agentDir/security-audit.jsonl) and the Terminal panel's own
 * pipeline (userData/audit/terminal.ndjson), so both are summed.
 */
async function readAuditSummary(): Promise<{
  path: string;
  events: number;
  approvals: number;
  exists: boolean;
}> {
  const targets = [
    path.join(app.getPath('userData'), 'pi-agent', 'security-audit.jsonl'),
    path.join(app.getPath('userData'), 'audit', 'terminal.ndjson'),
  ];

  let events = 0;
  let approvals = 0;
  let exists = false;

  for (const target of targets) {
    let contents: string;
    try {
      contents = await fsp.readFile(target, 'utf8');
    } catch {
      continue;
    }
    exists = true;
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      events += 1;
      if (line.includes('"kind":"approval"')) approvals += 1;
    }
  }

  return { path: targets[0]!, events, approvals, exists };
}

/**
 * In development the dock shows Electron's own icon because there is no bundle
 * to read Info.plist from. Packaged builds get it from build/icon.icns via
 * electron-builder, so this only runs unpackaged.
 */
function applyDevDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin' || !app.dock) return;
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  } catch (error) {
    console.warn('[main] could not set the dev dock icon', error);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'Pi Agent Desktop',
    // Organic ground (--color-bg) — avoids a flash of a different colour on show.
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Never a new Electron window — and only schemes the OS should be handed.
    // The Browser panel can frame remote pages now, so an unvalidated url here
    // would let a framed page hand the OS a file:// or an app-registered scheme.
    if (isExternallyOpenable(url)) void shell.openExternal(url);
    else console.warn('[main] refused to open non-http(s) url');
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

/** http/https only. Shared by the window-open handler and `system.openExternal`. */
export function isExternallyOpenable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function broadcastEvent(event: unknown): void {
  const parsed = parseDesktopAgentEvent(event);
  if (!parsed.success) {
    console.error('[main] dropping invalid agent event', parsed.error.flatten());
    return;
  }
  const data = parsed.data;

  // Observe event for run metrics tracking before any buffering.
  runMetrics.observe(data);
  getNotifications().observe(data);

  // Written files change what search should return, so the index follows them.
  if (data.type === 'files.changed' && data.paths.length) {
    scheduleIndexRefresh(data.projectId);
  }

  if (data.type === 'message.delta') {
    // Buffer streaming deltas; flush every 16ms to reduce IPC overhead.
    if (deltaBuffer.length < MAX_BUFFERED_DELTAS) {
      deltaBuffer.push(data);
    }
    if (!deltaFlushTimer) {
      deltaFlushTimer = setTimeout(flushDeltaBuffer, DELTA_FLUSH_INTERVAL_MS);
    }
    return;
  }

  // Non-delta event: flush pending deltas first to preserve ordering.
  if (deltaBuffer.length > 0) {
    flushDeltaBuffer();
  }

  // An approval raised by an automation-started run is answered by the
  // scheduler per that automation's mode; only unanswered ones reach the user.
  if (data.type === 'approval.requested' && automationScheduler) {
    void automationScheduler
      .handleApproval({
        runId: data.runId,
        sessionId: data.sessionId,
        requestId: data.requestId,
        summary: data.summary,
      })
      .then((handled) => {
        if (handled) return;
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.event, data);
        }
      })
      .catch((error) => {
        console.error('[main] automation approval handling failed', error);
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IpcChannels.event, data);
        }
      });
    return;
  }

  if (
    data.type === 'run.completed' ||
    data.type === 'run.failed' ||
    data.type === 'run.cancelled'
  ) {
    void applyPendingSessionTitle(data.sessionId);
    void automationScheduler
      ?.handleRunFinished({
        runId: data.runId,
        projectId: data.projectId,
        outcome:
          data.type === 'run.completed'
            ? 'completed'
            : data.type === 'run.failed'
              ? 'failed'
              : 'cancelled',
      })
      .catch((error) => console.error('[main] automation run-finished handling failed', error));
  }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.event, data);
  }
}

let indexService: IndexService | null = null;

function getIndexService(db: DesktopDatabase): IndexService {
  indexService ??= new IndexService({
    repo: db.index,
    listProjects: () =>
      db.projects.listRecent(100).map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        trusted: project.trusted,
        isGit: project.isGit,
      })),
  });
  return indexService;
}

/**
 * Re-index after a run touches files, coalesced per project. A run can write
 * dozens of files in a burst, and each `files.changed` event would otherwise
 * queue its own pass over the whole project.
 */
const indexRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const INDEX_REFRESH_DEBOUNCE_MS = 4_000;

function scheduleIndexRefresh(projectId: string): void {
  const existing = indexRefreshTimers.get(projectId);
  if (existing) clearTimeout(existing);
  indexRefreshTimers.set(
    projectId,
    setTimeout(() => {
      indexRefreshTimers.delete(projectId);
      void getDb()
        .then((db) => getIndexService(db).refresh(projectId))
        .catch((error) => console.error('[main] index refresh failed', error));
    }, INDEX_REFRESH_DEBOUNCE_MS),
  );
}

function getSkillsService(): SkillsService {
  skillsService ??= new SkillsService();
  return skillsService;
}

function getTerminalService(): TerminalService {
  terminalService ??= new TerminalService({
    auditFilePath: path.join(app.getPath('userData'), 'audit', 'terminal.ndjson'),
    requestApproval: ({ requestId, draft, projectId, sessionId, runId }) => {
      // Reuse the agent approval channel so the Renderer needs one UI for both.
      broadcastEvent({
        type: 'approval.requested',
        projectId,
        sessionId,
        runId,
        sequence: nextTerminalSequence(),
        timestamp: Date.now(),
        requestId,
        toolName: draft.toolName,
        summary: draft.summary,
        command: draft.command,
        affectedPaths: draft.affectedPaths,
        riskLevel: draft.riskLevel,
        reasons: draft.reasons,
        rememberable: draft.rememberable,
      });
    },
  });
  return terminalService;
}

let terminalSequence = 0;
function nextTerminalSequence(): number {
  return (terminalSequence += 1);
}

function getAutomationStore(): AutomationStore {
  automationStore ??= new AutomationStore();
  return automationStore;
}

/**
 * Automations can start runs with no one watching. See
 * docs/decisions/0003-unattended-automations.md for the risk this accepts and
 * the floor it keeps: policy-engine denials are never auto-approved, because a
 * denial is not an approval request.
 */
function getAutomationScheduler(): AutomationScheduler {
  if (automationScheduler) return automationScheduler;
  const store = getAutomationStore();
  automationScheduler = new AutomationScheduler(store, {
    startRun: async (automation, claimSession) => {
      const agent = ensureRuntime();
      const db = await getDb();
      const project = db.projects.get(automation.projectId);
      if (!project) throw new Error(`Project ${automation.projectId} not found`);
      if (!project.trusted) {
        throw new Error('Project is not trusted; automations do not bypass Workspace Trust.');
      }
      const runtimeSession = await agent.createSession({
        projectId: project.id,
        projectPath: project.path,
        title: `Automation: ${automation.name}`,
        model: getProviderSettings().getDefaultModel(),
      });
      await db.sessions.put({
        id: runtimeSession.id,
        projectId: runtimeSession.projectId,
        title: runtimeSession.title,
        createdAt: runtimeSession.createdAt,
        updatedAt: runtimeSession.updatedAt,
        archived: false,
      });
      // Claim before sending: the first turn can raise an approval before
      // sendMessage resolves, and it must be auto-decided, not shown to nobody.
      claimSession(runtimeSession.id);
      const ref = await agent.sendMessage(runtimeSession.id, { text: automation.prompt });
      return { sessionId: runtimeSession.id, runId: ref.runId };
    },
    decide: async (requestId, decision) => {
      await ensureRuntime().approve(requestId, decision);
    },
    recordAudit: (entry) => {
      desktopLogger?.write('info', '[automations] auto-approval', {
        automationId: entry.automationId,
        mode: entry.mode,
        decision: entry.decision,
        summary: entry.summary,
      });
    },
    log: (message, meta) => desktopLogger?.write('info', message, meta ?? {}),
  });
  return automationScheduler;
}

/**
 * Rename an auto-named task once its first run finishes, and push the new
 * summary to the Renderer so the sidebar updates without a poll.
 */
async function applyPendingSessionTitle(sessionId: string): Promise<void> {
  const title = pendingSessionTitles.get(sessionId);
  if (!title) return;
  pendingSessionTitles.delete(sessionId);
  try {
    const db = await getDb();
    const existing = db.sessions.get(sessionId);
    // Respect a name the user set while the run was in flight.
    if (!existing || !DEFAULT_SESSION_TITLES.has(existing.title)) return;
    const renamed = await db.sessions.rename(sessionId, title);
    getNotifications().setSessionTitle(sessionId, renamed.title);
    // No bespoke event: the Renderer already refetches the session list on the
    // run's terminal event, and inventing one would mean an unvalidated event
    // type on a channel that is Zod-checked end to end (§4.1 A2).
  } catch (error) {
    console.error('[main] auto-naming the task failed', error);
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
    // Restore the approval mode the user chose in Settings.
    const storedMode = getProviderSettings().getDefaultApprovalMode();
    void runtime.setApprovalMode?.(storedMode);
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
          paths: {
            database: path.join(app.getPath('userData'), 'pi-desktop.sqlite'),
            logs: app.getPath('logs'),
            audit: path.join(app.getPath('userData'), 'audit'),
            userData: app.getPath('userData'),
          },
          policy: {
            ...(() => {
              const described = describeProtectedPaths();
              return {
                protectedBasenames: described.basenames,
                protectedDirectories: described.directories,
              };
            })(),
            resolvedCheckpointRetentionDays: Math.round(
              RESOLVED_CHECKPOINT_RETENTION_MS / (24 * 60 * 60 * 1000),
            ),
            terminalTimeoutSeconds: TERMINAL_TIMEOUT_MS / 1000,
            terminalOutputCapBytes: TERMINAL_OUTPUT_CAP_BYTES,
          },
        });
      }
      case 'project.open': {
        let project = await projects.open(cmd.params.path);
        // Settings → Projects & trust: "Trust new projects automatically".
        if (!project.trusted && getProviderSettings().getUiFlags().trustNewProjects) {
          project = await projects.setTrust(project.id, true);
        }
        // Index in the background: opening a project must not wait on it.
        if (project.trusted) {
          void getIndexService(db)
            .refreshIfStale(project.id)
            .catch((error) => console.error('[main] index refresh failed', error));
        }
        return okResult(project satisfies ProjectSummary);
      }
      case 'project.pickFolder': {
        const configuredRoot = getProviderSettings().getUiFlags().defaultProjectsFolder;
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              defaultPath: configuredRoot || undefined,
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
      case 'project.openPlayground': {
        // A scratch workspace so "New task" works before you have picked a
        // folder. It lives under userData rather than in the user's home: we
        // create it, so we should not be putting directories where they keep
        // their own work. Auto-trusted for the same reason — it is our own empty
        // directory, not something of theirs we are claiming permission over.
        const dir = path.join(app.getPath('userData'), 'playground');
        await fsp.mkdir(dir, { recursive: true });
        let playground = await projects.open(dir);
        if (!playground.trusted) {
          playground = await projects.setTrust(playground.id, true);
        }
        return okResult(playground satisfies ProjectSummary);
      }
      case 'project.setTrust': {
        const project = await projects.setTrust(cmd.params.projectId, cmd.params.trusted);
        // Revoking trust drops the index: it is a stored copy of file contents,
        // and it must not outlive permission to read them.
        if (project.trusted) {
          void getIndexService(db)
            .refresh(project.id)
            .catch((error) => console.error('[main] index refresh failed', error));
        } else {
          getIndexService(db).forget(project.id);
        }
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
        return okResult({
          defaultModel: getProviderSettings().getDefaultModel(),
          uiFlags: getProviderSettings().getUiFlags(),
        });
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
        getNotifications().setSessionTitle(summary.id, summary.title);
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
      case 'session.delete': {
        // Soft delete only. Checkpoints, snapshots and audit rows are left
        // intact so a deleted task's writes stay revertable and an unresolved
        // checkpoint keeps surfacing in the recovery banner (plan §11 / M7).
        const summary = await sessions.setDeleted(cmd.params.sessionId, cmd.params.deleted);
        return okResult(summary satisfies SessionSummary);
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
        // Queue an auto-name if this task is still called "New task".
        if (DEFAULT_SESSION_TITLES.has(meta.title)) {
          const derived = deriveSessionTitle(cmd.params.text);
          if (derived) pendingSessionTitles.set(meta.id, derived);
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
        // The Terminal panel raises approvals through its own pipeline; try it
        // first so one Renderer UI can answer both sources.
        if (terminalService?.resolveApproval(cmd.params.requestId, cmd.params.decision)) {
          return okResult({ ok: true });
        }
        await agent.approve(cmd.params.requestId, cmd.params.decision);
        return okResult({ ok: true });
      }
      case 'agent.listModels': {
        return okResult((await agent.listModels()) as ModelInfo[]);
      }
      case 'settings.getVisibleModels': {
        return okResult({ keys: getProviderSettings().getVisibleModels() });
      }
      case 'settings.setVisibleModels': {
        getProviderSettings().setVisibleModels(cmd.params.keys);
        return okResult({ keys: getProviderSettings().getVisibleModels() });
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
      case 'git.getBranch': {
        const project = projects.get(cmd.params.projectId);
        if (!project?.trusted || !project.isGit) return okResult({ branch: null });
        return okResult({ branch: await readCurrentBranch(project.path) });
      }
      case 'project.searchFiles': {
        const project = projects.get(cmd.params.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        if (!project.trusted) return errResult('PROJECT_UNTRUSTED', 'Project is not trusted.');
        return okResult(
          await searchProjectFiles(project.path, cmd.params.query, cmd.params.limit ?? 40),
        );
      }
      case 'index.search': {
        return okResult(
          getIndexService(db).search({
            query: cmd.params.query,
            ...(cmd.params.projectId ? { projectId: cmd.params.projectId } : {}),
            ...(cmd.params.limit ? { limit: cmd.params.limit } : {}),
          }),
        );
      }
      case 'index.status': {
        return okResult(getIndexService(db).status());
      }
      case 'index.tree': {
        const project = projects.get(cmd.params.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        // Same gate as the index itself: an untrusted project is not readable,
        // and that includes reading its shape.
        if (!project.trusted) return errResult('PROJECT_UNTRUSTED', 'Project is not trusted.');
        return okResult(db.index.listChildren(project.id, cmd.params.prefix ?? ''));
      }
      case 'system.openExternal': {
        // Anything but http/https could hand the OS a file:// or a custom scheme
        // registered by another app.
        if (!isExternallyOpenable(cmd.params.url)) {
          return errResult('UNSUPPORTED_SCHEME', 'Only http and https links can be opened.');
        }
        await shell.openExternal(cmd.params.url);
        return okResult({ ok: true });
      }
      case 'index.rebuild': {
        const project = projects.get(cmd.params.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        if (!project.trusted) return errResult('PROJECT_UNTRUSTED', 'Project is not trusted.');
        await getIndexService(db).refresh(project.id, { force: cmd.params.force ?? true });
        return okResult(getIndexService(db).status());
      }
      case 'index.forget': {
        getIndexService(db).forget(cmd.params.projectId);
        return okResult(getIndexService(db).status());
      }
      case 'skills.list': {
        const projectId = cmd.params?.projectId;
        const project = projectId ? projects.get(projectId) : undefined;
        return okResult(await getSkillsService().list({ projectId, projectPath: project?.path }));
      }
      case 'skills.setEnabled': {
        await getSkillsService().setEnabled(cmd.params);
        const project = cmd.params.projectId ? projects.get(cmd.params.projectId) : undefined;
        return okResult(
          await getSkillsService().list({
            projectId: cmd.params.projectId,
            projectPath: project?.path,
          }),
        );
      }
      case 'skills.reveal': {
        shell.showItemInFolder(cmd.params.path);
        return okResult({ ok: true });
      }
      case 'terminal.exec': {
        const project = projects.get(cmd.params.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        if (!project.trusted) {
          return errResult('PROJECT_UNTRUSTED', 'Trust the project before running commands.');
        }
        return okResult(
          await getTerminalService().exec({
            projectId: project.id,
            workspaceRoot: project.path,
            projectTrusted: project.trusted,
            command: cmd.params.command,
            cwd: cmd.params.cwd,
            sessionId: cmd.params.sessionId,
          }),
        );
      }
      case 'terminal.changeDirectory': {
        const project = projects.get(cmd.params.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        if (!project.trusted) {
          return errResult('PROJECT_UNTRUSTED', 'Trust the project before running commands.');
        }
        return okResult(
          await getTerminalService().changeDirectory({
            workspaceRoot: project.path,
            ...(cmd.params.cwd ? { cwd: cmd.params.cwd } : {}),
            target: cmd.params.target,
          }),
        );
      }
      case 'automation.list': {
        const list = await getAutomationStore().list(cmd.params?.projectId);
        return okResult(
          list.map((automation) => ({
            ...automation,
            projectName: projects.get(automation.projectId)?.name,
          })),
        );
      }
      case 'automation.save': {
        const project = projects.get(cmd.params.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        const saved = await getAutomationStore().save(cmd.params);
        getAutomationScheduler().start();
        return okResult({ ...saved, projectName: project.name });
      }
      case 'automation.delete': {
        await getAutomationStore().remove(cmd.params.id);
        return okResult({ ok: true });
      }
      case 'automation.setEnabled': {
        const saved = await getAutomationStore().setEnabled(cmd.params.id, cmd.params.enabled);
        if (cmd.params.enabled) getAutomationScheduler().start();
        return okResult({
          ...saved,
          projectName: projects.get(saved.projectId)?.name,
        });
      }
      case 'automation.runNow': {
        const handle = await getAutomationScheduler().runNow(cmd.params.id);
        return okResult({
          automationId: cmd.params.id,
          sessionId: handle.sessionId,
          runId: handle.runId,
        });
      }
      case 'agent.setApprovalMode': {
        await agent.setApprovalMode?.(cmd.params.mode, cmd.params.sessionId);
        // Read-only must mean read-only everywhere, including the Terminal panel.
        if (!cmd.params.sessionId) {
          getProviderSettings().setDefaultApprovalMode(cmd.params.mode);
          getTerminalService().setApprovalMode(cmd.params.mode);
        }
        return okResult({ mode: cmd.params.mode });
      }
      case 'agent.getApprovalMode': {
        const mode =
          (await agent.getApprovalMode?.(cmd.params?.sessionId)) ??
          getProviderSettings().getDefaultApprovalMode();
        return okResult({ mode });
      }
      case 'permissions.listRemembered': {
        return okResult((await agent.listRememberedDecisions?.()) ?? []);
      }
      case 'permissions.clearRemembered': {
        const cleared = (await agent.clearRememberedDecisions?.(cmd.params)) ?? 0;
        return okResult({ cleared });
      }
      case 'usage.summary': {
        const days = cmd.params?.days ?? 365;
        const to = Date.now();
        const from = to - days * 24 * 60 * 60 * 1000;
        return okResult(
          db.runMetrics.summary({
            from,
            to,
            ...(cmd.params?.projectId ? { projectId: cmd.params.projectId } : {}),
          }),
        );
      }
      case 'audit.summary': {
        return okResult(await readAuditSummary());
      }
      case 'system.revealPath': {
        shell.showItemInFolder(cmd.params.path);
        return okResult({ ok: true });
      }
      case 'settings.setDefaultProjectsFolder': {
        getProviderSettings().setDefaultProjectsFolder(cmd.params.path);
        return okResult(getProviderSettings().getUiFlags());
      }
      case 'settings.pickProjectsFolder': {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory', 'createDirectory'],
              defaultPath: getProviderSettings().getUiFlags().defaultProjectsFolder || undefined,
            })
          : { canceled: true, filePaths: [] as string[] };
        if (result.canceled || !result.filePaths[0]) {
          return errResult('CANCELLED', 'Folder selection cancelled');
        }
        getProviderSettings().setDefaultProjectsFolder(result.filePaths[0]);
        return okResult(getProviderSettings().getUiFlags());
      }
      case 'settings.setUiFlag': {
        getProviderSettings().setUiFlag(cmd.params.key, cmd.params.value);
        return okResult(getProviderSettings().getUiFlags());
      }
      case 'diagnostics.export': {
        return okResult(exportDiagnostics());
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

function exportDiagnostics(): { logPath: string; recentMetrics: unknown[] } {
  return {
    logPath: desktopLogger?.getLogPath() ?? '',
    recentMetrics: runMetrics.listCompleted(),
  };
}

app.whenReady().then(() => {
  // M8-2: Install structured logger before any other log calls.
  desktopLogger = new DesktopLogger(app.getPath('logs'));
  desktopLogger.install();

  ipcMain.handle(IpcChannels.invoke, async (_event, raw: unknown) => handleInvoke(raw));
  void initializeCheckpointRecovery().catch((error) => {
    console.error('[main] checkpoint recovery initialization failed', error);
  });

  // Start the automation scheduler only if something is actually enabled, and
  // never fire on boot — see docs/decisions/0003-unattended-automations.md.
  void getAutomationStore()
    .list()
    .then((automations) => {
      if (automations.some((automation) => automation.enabled)) {
        getAutomationScheduler().start();
      }
    })
    .catch((error) => console.error('[main] automation scheduler start failed', error));

  applyDevDockIcon();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (deltaFlushTimer) {
    clearTimeout(deltaFlushTimer);
    deltaFlushTimer = null;
  }
  deltaBuffer = [];
  void runtime?.dispose();
  runtime = null;
  desktopDb?.close();
  desktopDb = null;
  desktopDbInit = null;
  providerSettings = null;
  persistedProviderKeysApplied = false;
  desktopLogger = null;
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
