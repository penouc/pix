import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import type {
  HistoryAgentId,
  HistoryAgentNav,
  HistoryNav,
  HistoryProjectNav,
  HistorySessionMeta,
  HistoryTranscript,
} from '@pi-desktop/protocol';
import { HISTORY_AGENT_DISPLAY } from '@pi-desktop/protocol';
import type { DesktopDatabase } from '@pi-desktop/database';

import { ClaudeHistoryAdapter } from './adapters/claude.js';
import { CodexHistoryAdapter } from './adapters/codex.js';
import { PiHistoryAdapter } from './adapters/pi.js';
import {
  isCredentialPath,
  normalizeProjectPath,
  projectNameOf,
  resolveProjectIdentities,
  resolveProjectIdentity,
  type HistoryAgentAdapter,
  type SessionFileRef,
} from './types.js';
import { detectAcpAgents } from '../acp/detect.js';

const RUNNABLE = new Set<HistoryAgentId>([
  'pix',
  'claude-code',
  'codex',
  'gemini',
  'opencode',
  'grok',
  'pi',
  'omp',
]);

export class HistoryService {
  private adapters: HistoryAgentAdapter[] = [];
  private watchers: FSWatcher[] = [];
  private scanning = false;
  private lastScanAt = 0;

  constructor(private readonly db: DesktopDatabase) {
    this.adapters = [
      new ClaudeHistoryAdapter(),
      new CodexHistoryAdapter(),
      PiHistoryAdapter.pi(),
      PiHistoryAdapter.omp(),
    ].filter((a) => a.detect());
  }

  startWatching(): void {
    this.stopWatching();
    for (const adapter of this.adapters) {
      for (const root of adapter.watchPaths()) {
        try {
          const w = watch(root, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const full = path.isAbsolute(filename) ? filename : path.join(root, String(filename));
            if (isCredentialPath(full)) return;
            if (!full.endsWith('.jsonl')) return;
            void this.scanFile(adapter, full);
          });
          this.watchers.push(w);
        } catch {
          /* recursive watch unsupported on some platforms */
        }
      }
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
  }

  async refresh(force = false): Promise<{ scanned: number; durationMs: number }> {
    if (this.scanning) return { scanned: 0, durationMs: 0 };
    if (!force && Date.now() - this.lastScanAt < 5_000) {
      return { scanned: 0, durationMs: 0 };
    }
    this.scanning = true;
    const started = Date.now();
    let scanned = 0;
    try {
      this.adapters = [
        new ClaudeHistoryAdapter(),
        new CodexHistoryAdapter(),
        PiHistoryAdapter.pi(),
        PiHistoryAdapter.omp(),
      ].filter((a) => a.detect());

      await this.projectPixSessions();
      this.mergeProjectPaths();
      const known = this.db.history.knownFiles();
      for (const adapter of this.adapters) {
        const files = await adapter.listSessionFiles();
        for (const ref of files) {
          if (isCredentialPath(ref.filePath)) continue;
          if (this.db.history.isTombstoned(ref.filePath)) continue;
          const prev = known.get(ref.filePath);
          // force=true re-parses everything so adapter fixes (e.g. Codex titles) land.
          // Also re-ingest Codex rows stuck as Untitled from the previous parser.
          const staleUntitled =
            prev &&
            adapter.agent() === 'codex' &&
            (!prev.title || prev.title === 'Untitled');
          if (!force && prev && prev.mtime === ref.mtimeMs && prev.size === ref.size && !staleUntitled) {
            continue;
          }
          const ok = await this.ingest(adapter, ref);
          if (ok) scanned += 1;
        }
      }
      this.lastScanAt = Date.now();
    } finally {
      this.scanning = false;
    }
    return { scanned, durationMs: Date.now() - started };
  }

  async nav(): Promise<HistoryNav> {
    // Only scan on first open — archive/star/list should read SQLite immediately.
    if (!this.lastScanAt) {
      await this.refresh(true);
    }
    const counts = this.db.history.agentCounts();
    const acp = await detectAcpAgents();
    const acpById = new Map(acp.map((a) => [a.id, a]));

    const agentIds: HistoryAgentId[] = [
      'pix',
      'claude-code',
      'codex',
      'pi',
      'omp',
      'gemini',
      'opencode',
      'grok',
      'copilot',
    ];
    const agents: HistoryAgentNav[] = [];
    for (const id of agentIds) {
      const count = counts.get(id) ?? 0;
      const detected =
        id === 'pix' ||
        this.adapters.some((a) => a.agent() === id) ||
        Boolean(acpById.get(id)?.available);
      if (!detected && count === 0) continue;
      agents.push({
        agent: id,
        displayName: HISTORY_AGENT_DISPLAY[id],
        count,
        detected,
        runnable: RUNNABLE.has(id) && (id === 'pix' || Boolean(acpById.get(id)?.available)),
      });
    }

    const pixProjects = this.db.projects.listRecent(50);
    const pixByPath = new Map(
      pixProjects.map((p) => [normalizeProjectPath(p.path) || p.path, p.id] as const),
    );
    const archivedPaths = this.db.history.archivedProjectPaths();
    const archivedMeta = new Map(
      this.db.history.listArchivedProjects().map((p) => {
        const key = normalizeProjectPath(p.path) || p.path;
        return [key, { ...p, path: key }] as const;
      }),
    );

    const byPath = new Map<string, HistoryProjectNav>();
    for (const p of this.db.history.projectCounts()) {
      const pathKey = normalizeProjectPath(p.path) || p.path;
      const prev = byPath.get(pathKey);
      if (prev) {
        byPath.set(pathKey, {
          ...prev,
          count: prev.count + p.count,
          lastActive: Math.max(prev.lastActive, p.lastActive),
          name: prev.name || p.name || projectNameOf(pathKey),
          archived: prev.archived || archivedPaths.has(pathKey),
          ...(prev.pixProjectId || pixByPath.get(pathKey)
            ? { pixProjectId: prev.pixProjectId ?? pixByPath.get(pathKey) }
            : {}),
        });
        continue;
      }
      byPath.set(pathKey, {
        path: pathKey,
        name: p.name || projectNameOf(pathKey),
        count: p.count,
        lastActive: p.lastActive,
        archived: archivedPaths.has(pathKey),
        ...(pixByPath.get(pathKey) ? { pixProjectId: pixByPath.get(pathKey) } : {}),
      });
    }
    for (const item of pixProjects) {
      const pathKey = normalizeProjectPath(item.path) || item.path;
      const existing = byPath.get(pathKey);
      if (existing) {
        if (!existing.pixProjectId) {
          byPath.set(pathKey, { ...existing, pixProjectId: item.id });
        }
        continue;
      }
      byPath.set(pathKey, {
        path: pathKey,
        name: item.name,
        count: 0,
        lastActive: item.lastOpenedAt ?? 0,
        archived: archivedPaths.has(pathKey),
        pixProjectId: item.id,
      });
    }
    // Keep archived-only rows that no longer have sessions / recent entries.
    for (const [rawPath, meta] of archivedMeta) {
      const pathKey = normalizeProjectPath(rawPath) || rawPath;
      if (byPath.has(pathKey)) continue;
      byPath.set(pathKey, {
        path: pathKey,
        name: meta.name,
        count: 0,
        lastActive: meta.archivedAt,
        archived: true,
        ...(pixByPath.get(pathKey) ? { pixProjectId: pixByPath.get(pathKey) } : {}),
      });
    }

    const projects = [...byPath.values()].sort((a, b) => b.lastActive - a.lastActive);

    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return { agents, projects, total };
  }

  setProjectArchived(path: string, archived: boolean, name?: string): HistoryProjectNav {
    const known = [
      ...this.db.history.distinctProjectPaths(),
      ...this.db.projects.listRecent(100).map((p) => p.path),
    ];
    const resolved = resolveProjectIdentity(path, known) || normalizeProjectPath(path);
    this.db.history.setProjectArchived(resolved, archived, name ?? '');
    const counts = this.db.history
      .projectCounts()
      .find((p) => (resolveProjectIdentity(p.path, known) || normalizeProjectPath(p.path)) === resolved);
    const pix = this.db.projects.getByPath(resolved);
    return {
      path: resolved,
      name: name || counts?.name || pix?.name || projectNameOf(resolved),
      count: counts?.count ?? 0,
      lastActive: counts?.lastActive ?? pix?.lastOpenedAt ?? Date.now(),
      archived,
      ...(pix ? { pixProjectId: pix.id } : {}),
    };
  }

  setSessionArchived(key: string, archived: boolean): HistorySessionMeta | null {
    const meta = this.db.history.get(key);
    if (!meta) return null;
    this.db.history.setSessionArchived(key, archived, meta);
    if (meta.origin === 'pix' && meta.pixSessionId) {
      void this.db.sessions.archive(meta.pixSessionId, archived).catch((err) => {
        console.error('[history] syncing PiX session archive failed', err);
      });
    }
    return { ...meta, favorite: meta.favorite };
  }

  listArchived(): {
    projects: Array<{ path: string; name: string; archivedAt: number }>;
    sessions: Array<{
      key: string;
      title: string;
      agent: string;
      projectPath: string;
      projectName: string;
      archivedAt: number;
    }>;
  } {
    return {
      projects: this.db.history.listArchivedProjects(),
      sessions: this.db.history.listArchivedSessions(),
    };
  }

  list(filter: {
    agent?: string;
    projectPath?: string;
    favoriteOnly?: boolean;
    titleQuery?: string;
    limit?: number;
    offset?: number;
  }): { sessions: HistorySessionMeta[]; total: number } {
    return this.db.history.list({
      agent: filter.agent as HistoryAgentId | undefined,
      projectPath: filter.projectPath,
      favoriteOnly: filter.favoriteOnly,
      titleQuery: filter.titleQuery,
      limit: filter.limit,
      offset: filter.offset,
    });
  }

  async transcript(key: string): Promise<HistoryTranscript | null> {
    const meta = this.db.history.get(key);
    if (!meta) return null;
    let messages = this.db.history.listMessages(key);
    if (meta.origin === 'external' && meta.filePath) {
      const adapter = this.adapters.find((a) => a.agent() === meta.agent);
      if (adapter) {
        const ref: SessionFileRef = {
          agent: meta.agent,
          nativeId: meta.nativeId,
          filePath: meta.filePath,
          mtimeMs: meta.updatedAt,
          size: 0,
        };
        const live = await adapter.parseTranscript(ref);
        if (live) messages = live.messages;
      }
    }
    return { meta, messages };
  }

  setFavorite(key: string, favorite: boolean): HistorySessionMeta | null {
    this.db.history.setFavorite(key, favorite);
    return this.db.history.get(key);
  }

  delete(key: string): void {
    this.db.history.removeSession(key, true);
  }

  /**
   * Collapse cwd variants into one Projects row:
   * normalize → git root → roll up into shortest non-broad ancestor path.
   */
  private mergeProjectPaths(): void {
    const raw = [
      ...this.db.history.distinctProjectPaths(),
      ...this.db.projects.listRecent(200).map((p) => p.path),
    ];
    const identities = resolveProjectIdentities(raw);
    // Map every raw DB value (including pre-normalize forms) onto the identity.
    const mapping = new Map<string, string>();
    for (const from of this.db.history.distinctProjectPaths()) {
      const normalized = normalizeProjectPath(from) || from;
      const to = identities.get(normalized) ?? resolveProjectIdentity(from, raw);
      if (to && to !== from) mapping.set(from, to);
    }
    if (mapping.size) this.db.history.remapProjectPaths(mapping);
  }

  private async projectPixSessions(): Promise<void> {
    const sessions = this.db.sessions.listAll();
    for (const session of sessions) {
      if (session.deletedAt) continue;
      const project = this.db.projects.get(session.projectId);
      const known = [
        ...this.db.history.distinctProjectPaths(),
        ...this.db.projects.listRecent(100).map((p) => p.path),
      ];
      const projectPath = resolveProjectIdentity(project?.path ?? '', known);
      const messages = this.db.sessionMessages.list(session.id);
      const units = messages.map((entry, seq) => {
        if (entry.kind === 'message') {
          return {
            seq,
            role: entry.role,
            kind: 'text' as const,
            text: entry.text,
            timestamp: session.updatedAt,
          };
        }
        if (entry.kind === 'thinking') {
          return {
            seq,
            role: 'assistant' as const,
            kind: 'thinking' as const,
            text: entry.content,
            thinking: entry.content,
            timestamp: session.updatedAt,
          };
        }
        return {
          seq,
          role: 'assistant' as const,
          kind: 'tool' as const,
          text: entry.inputSummary ?? '',
          toolName: entry.toolName,
          timestamp: session.updatedAt,
        };
      });
      const meta: HistorySessionMeta = {
        key: `pix:${session.id}`,
        agent: 'pix',
        nativeId: session.id,
        title: session.title,
        projectPath,
        projectName: project?.name ?? projectNameOf(projectPath),
        filePath: `pix://${session.id}`,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: messages.filter((m) => m.kind === 'message').length,
        model: null,
        tokensUsed: null,
        favorite: false,
        origin: 'pix',
        pixSessionId: session.id,
        pixProjectId: session.projectId,
      };
      this.db.history.writeSession({
        meta,
        fileMtime: session.updatedAt,
        fileSize: units.length,
        units,
      });
    }
  }

  private async scanFile(adapter: HistoryAgentAdapter, filePath: string): Promise<void> {
    if (isCredentialPath(filePath) || !filePath.endsWith('.jsonl')) return;
    if (this.db.history.isTombstoned(filePath)) return;
    try {
      const { stat } = await import('node:fs/promises');
      const st = await stat(filePath);
      const stem = path.basename(filePath).replace(/\.jsonl$/i, '');
      const ref: SessionFileRef = {
        agent: adapter.agent(),
        nativeId: stem,
        filePath,
        mtimeMs: st.mtimeMs,
        size: st.size,
      };
      await this.ingest(adapter, ref);
    } catch {
      /* ignore */
    }
  }

  private async ingest(adapter: HistoryAgentAdapter, ref: SessionFileRef): Promise<boolean> {
    try {
      const parsed = await adapter.parseSession(ref);
      if (!parsed) return false;
      const known = [
        ...this.db.history.distinctProjectPaths(),
        ...this.db.projects.listRecent(100).map((p) => p.path),
      ];
      const projectPath = resolveProjectIdentity(parsed.meta.projectPath, known);
      this.db.history.writeSession({
        meta: {
          ...parsed.meta,
          projectPath,
          projectName: projectPath
            ? projectNameOf(projectPath) || parsed.meta.projectName
            : parsed.meta.projectName,
        },
        fileMtime: ref.mtimeMs,
        fileSize: ref.size,
        units: parsed.units,
      });
      return true;
    } catch (err) {
      console.warn(
        `[history] ingest failed ${adapter.agent()} ${ref.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }
}
