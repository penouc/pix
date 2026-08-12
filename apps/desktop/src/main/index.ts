import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createAgentRuntime,
  deriveSessionTitle,
  describeAuthSources,
  PI_SDK_PACKAGES,
  sanitizeSessionTitle,
  type ProviderAuthSummary,
} from '@pi-desktop/agent-pi';
import type { AgentRuntime } from '@pi-desktop/agent-domain';
import { DesktopDatabase } from '@pi-desktop/database';
import {
  IpcChannels,
  errResult,
  modelSelectionFromRef,
  okResult,
  parseDesktopAgentEvent,
  parseIpcCommand,
  type IpcResult,
  type CheckpointRecoverySummary,
  type ModelInfo,
  type ProviderSetting,
  type ProjectSummary,
  type SessionSummary,
  type StoredMessage,
} from '@pi-desktop/protocol';

import { describeProtectedPaths } from '@pi-desktop/security';

import {
  BrowserPreviewError,
  BrowserPreviewService,
} from './browser/browser-preview-service.js';

// Dock / taskbar should say PiX, but userData must stay on the historical folder.
// `productName` / `app.setName` alone would move Application Support to "PiX" and
// orphan projects, sessions, and settings under `@pi-desktop/desktop`.
app.setPath('userData', path.join(app.getPath('appData'), '@pi-desktop', 'desktop'));
app.setName('PiX');
if (process.platform === 'win32') {
  app.setAppUserModelId('dev.pi.agent.desktop');
}

import { getWorkingTreeDiff } from './git/git-diff-service.js';
import {
  captureCheckpointBaseline,
  checkpointId,
} from './checkpoints/checkpoint-baseline-service.js';
import { CheckpointRecoveryService } from './checkpoints/checkpoint-recovery-service.js';
import { WriteSnapshotCoordinator } from './checkpoints/write-snapshot-coordinator.js';
import { ProviderSettingsStore } from './providers/provider-settings-store.js';
import { ProviderLoginService } from './providers/provider-login-service.js';
import { DesktopLogger } from './observability/logger.js';
import { RunMetricsStore } from './observability/run-metrics-store.js';
import { SessionLogSyncService } from './observability/session-log-sync.js';
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
import { UpdateService } from './updates/update-service.js';
import { runPreflight } from './platform/environment.js';
import {
  windowChromeOptions,
  windowsTitleBarOverlay,
} from './platform/window-chrome.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const browserPreview = new BrowserPreviewService(() => mainWindow);
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
let providerLogins: ProviderLoginService | null = null;
let updates: UpdateService | null = null;
let sessionLogSync: SessionLogSyncService | null = null;

function getSessionLogSync(): SessionLogSyncService {
  sessionLogSync ??= new SessionLogSyncService(
    path.join(app.getPath('userData'), 'pi-agent', 'desktop-sessions'),
    getDb,
  );
  return sessionLogSync;
}

function getProviderLogins(): ProviderLoginService {
  providerLogins ??= new ProviderLoginService({
    runtime: () => ensureRuntime(),
    openExternal: (url) => {
      // Second check on a URL that came from a network response. Pi already
      // requires https for a verification URI; this is the boundary that hands
      // it to the OS, so it verifies too rather than trusting upstream.
      if (!isExternallyOpenable(url)) {
        console.warn('[main] refused to open a non-http(s) login url');
        return;
      }
      void shell.openExternal(url);
    },
  });
  return providerLogins;
}

/**
 * Unnamed tasks waiting for a title after their first run. Value is a cheap
 * offline fallback derived from the first prompt; on a successful completion
 * we ask the session's current model first and only use this if that fails.
 */
const pendingSessionTitles = new Map<string, string>();

/** Names still considered "unnamed" and safe to replace. */
const DEFAULT_SESSION_TITLES = new Set(['New task', 'Session']);

/** Re-export for callers/tests that historically imported from main. */
export { deriveSessionTitle } from '@pi-desktop/agent-pi';

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

/** App-owned scratch workspace — not a user project folder. */
function playgroundDir(): string {
  return path.join(app.getPath('userData'), 'playground');
}

function isPlaygroundPath(projectPath: string): boolean {
  return path.resolve(projectPath) === path.resolve(playgroundDir());
}

/** Tag playground projects at the IPC boundary (not persisted in SQLite). */
function decorateProject(project: ProjectSummary): ProjectSummary {
  const playground = isPlaygroundPath(project.path);
  return {
    ...project,
    ...(playground
      ? {
          isPlayground: true,
          // Keep the sidebar / picker label honest even if an older row stored "playground".
          name: project.name === 'playground' ? 'Scratch playground' : project.name,
        }
      : { isPlayground: false }),
  };
}

async function resolveOnboardingState() {
  const store = getProviderSettings();
  // After the one-shot upgrade write, skip DB/runtime evidence gathering.
  if (store.hasOnboardingRecord()) {
    return store.getOnboarding();
  }
  const db = await getDb();
  const projects = db.projects.listRecent(100);
  const hasRealProject = projects.some((project) => !isPlaygroundPath(project.path));
  let hasAuth = store.list().length > 0;
  if (!hasAuth) {
    try {
      hasAuth = (await readAuthStatus(await ensureRuntime())).some((entry) => entry.hasAuth);
    } catch {
      // Runtime may not be ready on the very first prefs read; saved keys alone
      // are enough to treat an upgrade as experienced.
    }
  }
  const hasSession = db.sessions.listAll().length > 0;
  return store.ensureOnboardingMigrated({
    hasRealProject,
    hasAuth,
    hasSession,
  });
}

function getUpdates(): UpdateService {
  if (!updates) {
    updates = new UpdateService();
    updates.onChange((state) => {
      broadcastEvent({ type: 'update.status', ...state, timestamp: Date.now() });
    });
  }
  return updates;
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
    void getSessionLogSync()
      .sync()
      .then(({ imported }) => {
        if (imported > 0) {
          console.warn(`[main] session log backfill imported ${imported} usage row(s)`);
        }
      })
      .catch((error) => console.error('[main] session log sync failed', error));
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
 * Mascot artwork lives in `build/icon-source.png`; run `pnpm icon:generate` for
 * `icon.png` / `icon.icns`. Dev has no Info.plist, so we load those files here.
 */
function resolveAppIconPath(): string | undefined {
  const roots = [path.join(__dirname, '..', '..'), app.getAppPath()];
  for (const root of roots) {
    for (const name of ['build/icon.png', 'build/icon.icns']) {
      const candidate = path.join(root, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function applyDevDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin' || !app.dock) return;
  const iconPath = resolveAppIconPath();
  if (!iconPath) return;
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  } catch (error) {
    console.warn('[main] could not set the dev dock icon', error);
  }
}

function createWindow(): void {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'PiX',
    ...(iconPath ? { icon: iconPath } : {}),
    // Organic ground (--color-bg) — avoids a flash of a different colour on show.
    backgroundColor: '#f8faf8',
    // macOS: hiddenInset + traffic lights. Windows: single custom title bar with
    // Window Controls Overlay (no stacked native title bar). See ADR-0004 §5.
    ...windowChromeOptions(process.platform, {
      dark: nativeTheme.shouldUseDarkColors,
    }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let syncWindowsOverlay: (() => void) | null = null;
  if (process.platform === 'win32') {
    syncWindowsOverlay = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setTitleBarOverlay(windowsTitleBarOverlay(nativeTheme.shouldUseDarkColors));
    };
    nativeTheme.on('updated', syncWindowsOverlay);
  }

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
    if (syncWindowsOverlay) {
      nativeTheme.removeListener('updated', syncWindowsOverlay);
      syncWindowsOverlay = null;
    }
    browserPreview.detach();
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

function browserPreviewErrorResult(error: unknown): IpcResult<never> {
  if (error instanceof BrowserPreviewError) {
    return errResult(error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errResult('BROWSER_ERROR', message || 'Browser preview failed.');
}

function persistTranscriptEntry(sessionId: string, entry: StoredMessage, id?: string): void {
  const entryId =
    id ?? (entry.kind === 'thinking' || entry.kind === 'tool' ? entry.id : randomUUID());
  void getDb()
    .then((db) =>
      db.sessionMessages.append({
        id: entryId,
        sessionId,
        entry,
      }),
    )
    .catch((error) => console.error('[main] persisting session transcript failed', error));
}

function persistSessionMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  text: string,
  messageId?: string,
  images?: Array<{ name: string; mimeType: string; size: number }>,
): void {
  const trimmed = text.trim();
  if (!trimmed && !images?.length) return;
  persistTranscriptEntry(
    sessionId,
    { kind: 'message', role, text: trimmed, ...(images?.length ? { images } : {}) },
    messageId,
  );
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

  if (data.type === 'message.completed' && data.role !== 'system') {
    // Desktop-owned transcript: Pi's jsonl writer only flushes once an assistant
    // turn completes, so failed or partial runs left nothing on disk.
    persistSessionMessage(data.sessionId, data.role, data.content, data.messageId);
  }

  if (data.type === 'thinking.completed' && data.content.trim()) {
    // Thinking shares the assistant messageId in the live stream; prefix so it
    // does not collide with the persisted message row.
    persistTranscriptEntry(
      data.sessionId,
      { kind: 'thinking', id: data.messageId, content: data.content.trim() },
      `think-${data.messageId}`,
    );
  }

  if (data.type === 'tool.requested') {
    persistTranscriptEntry(
      data.sessionId,
      {
        kind: 'tool',
        id: data.toolCallId,
        toolName: data.toolName,
        inputSummary: data.inputSummary,
        status: 'running',
      },
      data.toolCallId,
    );
  }

  if (data.type === 'tool.completed') {
    persistTranscriptEntry(
      data.sessionId,
      {
        kind: 'tool',
        id: data.toolCallId,
        toolName: data.toolName,
        // Repository merges with the tool.requested row so inputSummary is kept.
        inputSummary: '',
        outputSummary: data.outputSummary,
        ok: data.ok,
        status: data.ok ? 'completed' : 'failed',
      },
      data.toolCallId,
    );
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
    const outcome =
      data.type === 'run.completed'
        ? 'completed'
        : data.type === 'run.failed'
          ? 'failed'
          : 'cancelled';
    void applyPendingSessionTitle(data.sessionId, data.projectId, outcome);
    void automationScheduler
      ?.handleRunFinished({
        runId: data.runId,
        projectId: data.projectId,
        outcome,
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
        autoModel: getProviderSettings().getAutoModelConfig(),
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
 * Rename an auto-named task once its first run finishes.
 *
 * On a successful completion, ask the session's current model for a short
 * title; fall back to the offline derivation from the first prompt on failure
 * or cancelled/failed runs so we never leave "New task" stuck forever after a
 * useful exchange, and never block the run path on the naming call.
 */
async function applyPendingSessionTitle(
  sessionId: string,
  projectId: string,
  outcome: 'completed' | 'failed' | 'cancelled',
): Promise<void> {
  const fallback = pendingSessionTitles.get(sessionId);
  if (!fallback) return;
  // Claim immediately so a second terminal event cannot double-rename.
  pendingSessionTitles.delete(sessionId);
  try {
    const db = await getDb();
    const existing = db.sessions.get(sessionId);
    // Respect a name the user set while the run was in flight.
    if (!existing || !DEFAULT_SESSION_TITLES.has(existing.title)) return;

    let title: string | null = null;
    if (outcome === 'completed') {
      try {
        const agent = ensureRuntime();
        if (agent.generateSessionTitle) {
          title = sanitizeSessionTitle(await agent.generateSessionTitle(sessionId));
        }
      } catch (error) {
        console.warn('[main] model title generation failed; using fallback', error);
      }
    }
    title = title ?? sanitizeSessionTitle(fallback) ?? fallback;
    if (!title || DEFAULT_SESSION_TITLES.has(title)) return;

    const renamed = await db.sessions.rename(sessionId, title);
    getNotifications().setSessionTitle(sessionId, renamed.title);
    // LLM naming finishes after run.completed already refreshed the list, so
    // push a dedicated (Zod-validated) event the sidebar can react to.
    broadcastEvent({
      type: 'session.updated',
      projectId,
      sessionId,
      title: renamed.title,
      timestamp: Date.now(),
    });
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
      // #11: durable todo checklists — the runtime calls back into SQLite on
      // every change and at first read, so the sidebar survives restarts.
      todoPersistence: {
        load: async (sessionId) => {
          const db = await getDb();
          return db.todos.load(sessionId);
        },
        save: async (sessionId, items) => {
          const db = await getDb();
          db.todos.save(sessionId, items);
        },
      },
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
 * Rebuild the SDK-side session lazily from the SQLite record after a restart,
 * keeping the desktop session id so all subsequent IPC and events stay in the
 * persisted scope — and so the runtime finds that id's stored transcript.
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
          name: 'PiX',
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
          preflight: await runPreflight(),
        });
      }
      case 'update.getStatus':
        return okResult(getUpdates().getState());
      case 'update.check':
        return okResult(await getUpdates().check());
      case 'update.download':
        return okResult(await getUpdates().download());
      case 'update.install':
        getUpdates().install();
        return okResult(getUpdates().getState());
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
        if (!isPlaygroundPath(project.path)) {
          getProviderSettings().patchOnboarding({ hasOpenedProject: true });
        }
        return okResult(decorateProject(project) satisfies ProjectSummary);
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
        let project = await projects.open(result.filePaths[0]);
        if (!project.trusted && getProviderSettings().getUiFlags().trustNewProjects) {
          project = await projects.setTrust(project.id, true);
        }
        if (project.trusted) {
          void getIndexService(db)
            .refreshIfStale(project.id)
            .catch((error) => console.error('[main] index refresh failed', error));
        }
        if (!isPlaygroundPath(project.path)) {
          getProviderSettings().patchOnboarding({ hasOpenedProject: true });
        }
        return okResult(decorateProject(project) satisfies ProjectSummary);
      }
      case 'project.listRecent': {
        return okResult(projects.listRecent().map(decorateProject));
      }
      case 'project.openPlayground': {
        // A scratch workspace so "New task" works before you have picked a
        // folder. It lives under userData rather than in the user's home: we
        // create it, so we should not be putting directories where they keep
        // their own work. Auto-trusted for the same reason — it is our own empty
        // directory, not something of theirs we are claiming permission over.
        const dir = playgroundDir();
        await fsp.mkdir(dir, { recursive: true });
        let playground = await projects.open(dir);
        if (!playground.trusted) {
          playground = await projects.setTrust(playground.id, true);
        }
        if (playground.name === 'playground') {
          playground = await projects.put({ ...playground, name: 'Scratch playground' });
        }
        return okResult(decorateProject(playground) satisfies ProjectSummary);
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
        return okResult(decorateProject(project));
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
        getProviderSettings().patchOnboarding({ hasConfiguredAuth: true });
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
          onboarding: await resolveOnboardingState(),
        });
      }
      case 'settings.setDefaultModel': {
        getProviderSettings().setDefaultModel(cmd.params.model);
        return okResult({ defaultModel: cmd.params.model });
      }
      case 'settings.getAutoModel': {
        return okResult(getProviderSettings().getAutoModelConfig());
      }
      case 'settings.setAutoModel': {
        getProviderSettings().setAutoModelConfig(cmd.params.config);
        return okResult(cmd.params.config);
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
          const fallback = await agent.pickDefaultModel();
          if (fallback) model = modelSelectionFromRef(fallback);
        }
        const runtimeSession = await agent.createSession({
          projectId: project.id,
          projectPath: project.path,
          title: cmd.params.title,
          model,
          autoModel: getProviderSettings().getAutoModelConfig(),
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
        return okResult(
          cmd.params.projectId ? sessions.listByProject(cmd.params.projectId) : sessions.listAll(),
        );
      }
      case 'session.messages': {
        const session = sessions.get(cmd.params.sessionId);
        if (!session) return errResult('SESSION_NOT_FOUND', 'Session not found');
        const stored = db.sessionMessages.list(session.id);
        if (stored.length > 0) {
          return okResult(stored);
        }
        const project = projects.get(session.projectId);
        if (!project) return errResult('PROJECT_NOT_FOUND', 'Project not found');
        if (!agent.listMessages) return okResult([]);
        await ensurePersistedRuntimeSession(agent, session, project.path);
        const fromPi = await agent.listMessages(session.id);
        if (fromPi.length > 0) {
          await db.sessionMessages.backfill(session.id, fromPi);
        }
        return okResult(fromPi);
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
            images: cmd.params.images,
            model: cmd.params.model,
            autoModel: getProviderSettings().getAutoModelConfig(),
          });
        } catch (error) {
          await db.checkpoints.discard(checkpoint.id);
          throw error;
        }
        persistSessionMessage(
          cmd.params.sessionId,
          'user',
          cmd.params.text,
          undefined,
          cmd.params.images?.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
        );
        // Queue an auto-name if this task is still called "New task". The model
        // title is requested after the first completed turn; this string is only
        // the offline fallback.
        if (DEFAULT_SESSION_TITLES.has(meta.title) && !pendingSessionTitles.has(meta.id)) {
          const derived =
            deriveSessionTitle(cmd.params.text) ??
            sanitizeSessionTitle(cmd.params.text) ??
            cmd.params.text.trim().slice(0, 72);
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
        // First successful send completes onboarding step 3 (run started).
        getProviderSettings().patchOnboarding({ hasFirstRun: true });
        return okResult(ref);
      }
      case 'agent.steer': {
        await agent.steer(cmd.params.runId, {
          text: cmd.params.text,
          images: cmd.params.images,
        });
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
          images: cmd.params.images,
          model: cmd.params.model,
          autoModel: getProviderSettings().getAutoModelConfig(),
        });
        persistSessionMessage(
          cmd.params.sessionId,
          'user',
          cmd.params.text,
          undefined,
          cmd.params.images?.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
        );
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
      case 'provider.login': {
        const providers = agent.listProviders ? await agent.listProviders() : [];
        const entry = providers.find((provider) => provider.id === cmd.params.providerId);
        if (!entry) return errResult('PROVIDER_UNKNOWN', 'That provider is not in the catalogue.');
        // Only offer what the provider actually declares, so a login can never be
        // started against a method the SDK would reject anyway.
        if (cmd.params.type === 'oauth' && !entry.oauthLabel) {
          return errResult('PROVIDER_NO_OAUTH', `${entry.name} has no subscription login.`);
        }
        try {
          return okResult(
            getProviderLogins().start({
              providerId: cmd.params.providerId,
              type: cmd.params.type,
            }),
          );
        } catch (error) {
          return errResult(
            'LOGIN_UNAVAILABLE',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      case 'provider.loginStatus': {
        const state = getProviderLogins().status(cmd.params.loginId);
        if (!state) return errResult('LOGIN_UNKNOWN', 'That login is no longer active.');
        return okResult(state);
      }
      case 'provider.loginSubmit': {
        const ok = getProviderLogins().submit(cmd.params.loginId, cmd.params.value);
        if (!ok) return errResult('LOGIN_NOT_WAITING', 'That login is not waiting for input.');
        return okResult({ ok: true });
      }
      case 'provider.loginCancel': {
        getProviderLogins().cancel(cmd.params.loginId);
        getProviderLogins().forget(cmd.params.loginId);
        return okResult({ ok: true });
      }
      case 'provider.logout': {
        if (!agent.logoutProvider) {
          return errResult('LOGOUT_UNAVAILABLE', 'This runtime cannot sign out of providers.');
        }
        await agent.logoutProvider(cmd.params.providerId);
        // A stored API key would otherwise be re-applied on the next start and
        // silently undo the sign-out.
        getProviderSettings().remove(cmd.params.providerId);
        return okResult({ ok: true });
      }
      case 'provider.listAvailable': {
        // Straight from Pi's registry — the Settings list used to be sixteen
        // hand-written ids against the thirty-seven Pi actually knows.
        if (!agent.listProviders) return okResult([]);
        return okResult(await agent.listProviders());
      }
      case 'settings.getFavoriteModels': {
        return okResult({ keys: getProviderSettings().getFavoriteModels() });
      }
      case 'settings.setFavoriteModels': {
        getProviderSettings().setFavoriteModels(cmd.params.keys);
        return okResult({ keys: getProviderSettings().getFavoriteModels() });
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
            ...(cmd.params.excludeProtected ? { excludeProtected: true } : {}),
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
      case 'browser.attach':
        return okResult(browserPreview.attach());
      case 'browser.detach': {
        browserPreview.detach();
        return okResult({ ok: true });
      }
      case 'browser.navigate': {
        try {
          return okResult(await browserPreview.navigate(cmd.params.url));
        } catch (error) {
          return browserPreviewErrorResult(error);
        }
      }
      case 'browser.setBounds':
        return okResult(browserPreview.setBounds(cmd.params));
      case 'browser.setVisible':
        return okResult(browserPreview.setVisible(cmd.params.visible));
      case 'browser.reload': {
        try {
          return okResult(browserPreview.reload());
        } catch (error) {
          return browserPreviewErrorResult(error);
        }
      }
      case 'browser.goBack': {
        try {
          return okResult(browserPreview.goBack());
        } catch (error) {
          return browserPreviewErrorResult(error);
        }
      }
      case 'browser.goForward': {
        try {
          return okResult(browserPreview.goForward());
        } catch (error) {
          return browserPreviewErrorResult(error);
        }
      }
      case 'browser.getState':
        return okResult(browserPreview.getState());
      case 'browser.startPicker': {
        try {
          return okResult(await browserPreview.startPicker());
        } catch (error) {
          return browserPreviewErrorResult(error);
        }
      }
      case 'browser.cancelPicker':
        return okResult(await browserPreview.cancelPicker());
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
        // Project skills are executable instructions. Never read or advertise
        // them before Workspace Trust; global skills remain available.
        return okResult(
          await getSkillsService().list({
            projectId,
            projectPath: project?.trusted ? project.path : undefined,
          }),
        );
      }
      case 'skills.setEnabled': {
        await getSkillsService().setEnabled(cmd.params);
        const project = cmd.params.projectId ? projects.get(cmd.params.projectId) : undefined;
        return okResult(
          await getSkillsService().list({
            projectId: cmd.params.projectId,
            projectPath: project?.trusted ? project.path : undefined,
          }),
        );
      }
      case 'skills.installExample': {
        await getSkillsService().installExample(cmd.params.id);
        const project = cmd.params.projectId ? projects.get(cmd.params.projectId) : undefined;
        return okResult(
          await getSkillsService().list({
            projectId: cmd.params.projectId,
            projectPath: project?.trusted ? project.path : undefined,
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
      case 'agent.setSessionMode': {
        if (cmd.params.sessionId) {
          const meta = sessions.get(cmd.params.sessionId);
          if (!meta) {
            return errResult('SESSION_NOT_FOUND', `Session ${cmd.params.sessionId} not found`);
          }
          const project = projects.get(meta.projectId);
          if (!project) {
            return errResult('PROJECT_NOT_FOUND', `Project ${meta.projectId} not found`);
          }
          await ensurePersistedRuntimeSession(agent, meta, project.path);
        }
        await agent.setSessionMode?.(cmd.params.mode, cmd.params.sessionId);
        return okResult({ mode: cmd.params.mode });
      }
      case 'agent.getSessionMode': {
        if (cmd.params?.sessionId) {
          const meta = sessions.get(cmd.params.sessionId);
          if (meta) {
            const project = projects.get(meta.projectId);
            if (project) {
              await ensurePersistedRuntimeSession(agent, meta, project.path);
            }
          }
        }
        const mode = (await agent.getSessionMode?.(cmd.params?.sessionId)) ?? 'build';
        return okResult({ mode });
      }
      case 'agent.setThinkingLevel': {
        if (!cmd.params.sessionId) {
          return errResult('INVALID_INPUT', 'sessionId is required');
        }
        await agent.setThinkingLevel?.(cmd.params.sessionId, cmd.params.level);
        return okResult({ level: cmd.params.level });
      }
      case 'agent.getThinkingLevel': {
        if (!cmd.params?.sessionId) {
          return errResult('INVALID_INPUT', 'sessionId is required');
        }
        const state = await agent.getThinkingLevel?.(cmd.params.sessionId);
        if (!state) {
          return errResult('NOT_SUPPORTED', 'Thinking level is not available');
        }
        return okResult(state);
      }
      case 'agent.getContextUsage': {
        const usage = await agent.getContextUsage?.(cmd.params.sessionId);
        return okResult(usage ?? null);
      }
      case 'agent.compact': {
        if (!agent.compact) {
          return errResult('NOT_SUPPORTED', 'Compaction is not available');
        }
        const result = await agent.compact(cmd.params.sessionId, cmd.params.customInstructions);
        return okResult(result);
      }
      case 'agent.forkPoints': {
        const points = (await agent.forkPoints?.(cmd.params.sessionId)) ?? [];
        return okResult({ points });
      }
      case 'agent.forkSession': {
        if (!agent.forkSession) {
          return errResult('NOT_SUPPORTED', 'Session fork is not available');
        }
        const result = await agent.forkSession(cmd.params.sessionId, cmd.params.entryId);
        // The stored transcript rows describe the abandoned branch; drop them
        // so `session.messages` refetches from the rewound Pi branch.
        await db.sessionMessages.deleteBySession(cmd.params.sessionId);
        return okResult(result);
      }
      case 'agent.setAutoCompaction': {
        await agent.setAutoCompactionEnabled?.(cmd.params.enabled, cmd.params.sessionId);
        return okResult({ enabled: cmd.params.enabled });
      }
      case 'agent.getAutoCompaction': {
        const enabled = (await agent.getAutoCompactionEnabled?.(cmd.params?.sessionId)) ?? true;
        return okResult({ enabled });
      }
      case 'agent.abortCompaction': {
        await agent.abortCompaction?.(cmd.params.sessionId);
        return okResult({ ok: true });
      }
      case 'agent.listTodos': {
        const meta = sessions.get(cmd.params.sessionId);
        if (!meta) return errResult('SESSION_NOT_FOUND', 'Session not found');
        // A session that has not been hydrated yet has no runtime record; fall
        // back to the persisted checklist so the sidebar is never empty-wrong.
        if (!agent.listTodos) return okResult({ items: db.todos.load(cmd.params.sessionId) });
        try {
          return okResult({ items: await agent.listTodos(cmd.params.sessionId) });
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code: unknown }).code)
              : '';
          if (code === 'SESSION_NOT_FOUND') {
            return okResult({ items: db.todos.load(cmd.params.sessionId) });
          }
          throw error;
        }
      }
      case 'agent.answerAsk': {
        if (!agent.answerAsk) {
          return errResult('NOT_SUPPORTED', 'Structured asks are not available in this runtime');
        }
        await agent.answerAsk(cmd.params.askId, cmd.params.answer);
        return okResult({ ok: true });
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
        await getSessionLogSync().sync();
        return okResult(
          db.runMetrics.summary({
            from,
            to,
            ...(cmd.params?.projectId ? { projectId: cmd.params.projectId } : {}),
          }),
        );
      }
      case 'usage.projects': {
        // Projects that actually recorded runs in the window, so the usage tab
        // can filter by project without guessing from recently opened folders.
        const days = cmd.params?.days ?? 365;
        const to = Date.now();
        const from = to - days * 24 * 60 * 60 * 1000;
        await getSessionLogSync().sync();
        const rows = db.runMetrics.projects({ from, to });
        const byId = new Map(db.projects.listRecent(100).map((p) => [p.id, p]));
        return okResult(
          rows.map((row) => ({
            projectId: row.projectId,
            projectName: byId.get(row.projectId)?.name ?? row.projectId,
            projectPath: byId.get(row.projectId)?.path ?? undefined,
            lastUsedAt: row.lastUsedAt,
            runs: row.runs,
          })),
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
        if (cmd.params.key === 'autoUpdate') getUpdates().configure(cmd.params.value);
        return okResult(getProviderSettings().getUiFlags());
      }
      case 'settings.getOnboarding': {
        return okResult(await resolveOnboardingState());
      }
      case 'settings.patchOnboarding': {
        return okResult(getProviderSettings().patchOnboarding(cmd.params));
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

/**
 * Chromium permission surface. PiX is a coding workbench — it never needs the
 * camera, mic, geolocation, or screen capture. Denying here means a preview
 * page or a future renderer bug cannot pop an OS permission dialog on a cold
 * start. Clipboard + notifications stay allowed (paste into the composer; run
 * finished alerts). Fullscreen is harmless chrome.
 *
 * Page screenshots for browser Select use Main `webContents.capturePage()`, not
 * the session screen-capture permission.
 */
function installSessionPermissionGates(): void {
  const allowed = new Set([
    'clipboard-read',
    'clipboard-sanitized-write',
    'notifications',
    'fullscreen',
  ]);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

app.whenReady().then(() => {
  // M8-2: Install structured logger before any other log calls.
  desktopLogger = new DesktopLogger(app.getPath('logs'));
  desktopLogger.install();
  installSessionPermissionGates();

  ipcMain.handle(IpcChannels.invoke, async (_event, raw: unknown) => handleInvoke(raw));

  applyDevDockIcon();
  // Window first. Everything else is background work that must not race the
  // first paint or trigger Keychain / network before the user sees UI.
  createWindow();

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

  // Preferences are plain JSON now, so this does not open safeStorage. Still
  // defer the network check until after the window exists.
  setImmediate(() => {
    try {
      const autoUpdate = getProviderSettings().getUiFlags().autoUpdate;
      getUpdates().configure(autoUpdate);
      if (autoUpdate) void getUpdates().check();
    } catch (error) {
      console.error('[main] auto-update setup failed', error);
    }
  });

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
  updates = null;
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
