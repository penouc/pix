import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  IndexContentHit,
  IndexPathHit,
  IndexRepository,
  IndexStateRecord,
} from '@pi-desktop/database';

const exec = promisify(execFile);

/** A project the indexer may touch. */
export interface IndexTarget {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  isGit: boolean;
}

export interface IndexProjectStatus {
  projectId: string;
  name: string;
  path: string;
  trusted: boolean;
  indexing: boolean;
  files: number;
  indexedBytes: number;
  skipped: number;
  /** null when this project has never been indexed. */
  updatedAt: number | null;
  durationMs: number | null;
}

interface ProjectLabel {
  projectName: string;
  projectPath: string;
}

export interface IndexSearchResult {
  paths: Array<IndexPathHit & ProjectLabel>;
  content: Array<IndexContentHit & ProjectLabel>;
}

/** Bodies above this are listed by path but not content-indexed. */
export const MAX_FILE_BYTES = 512 * 1024;
/** Per-project content budget. Paths are always indexed; bodies stop here. */
export const MAX_CONTENT_BYTES = 64 * 1024 * 1024;
/** Hard cap on files listed per project. */
export const MAX_FILES = 20_000;
/** Files per event-loop tick. `node:sqlite` is synchronous, so the indexer must
 *  hand the loop back or the window freezes while a large repo is read. */
const BATCH_SIZE = 96;
/** A refresh newer than this on open is left alone. */
const FRESH_MS = 60_000;

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  'Pods',
  '.pi-agent',
]);

/** Extensions with nothing to full-text search. */
const SKIP_EXTENSIONS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.avif','.bmp','.ico','.icns','.svgz',
  '.pdf','.zip','.gz','.tgz','.bz2','.xz','.7z','.rar','.jar','.war',
  '.mp3','.mp4','.mov','.avi','.mkv','.wav','.flac','.ogg',
  '.woff','.woff2','.ttf','.otf','.eot',
  '.so','.dylib','.dll','.exe','.bin','.wasm','.o','.a','.class','.pyc',
  '.sqlite','.db','.pack','.idx','.map',
]);

/** Filenames that are generated noise rather than source. */
const SKIP_NAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
]);

/**
 * The workspace index behind ⌘K's cross-project search.
 *
 * Pi Agent 0.82 ships no persistent index — its `grep`/`find` tools shell out to
 * ripgrep against one workspace root — so searching every project you have open
 * is something the desktop has to own. Two levels, both local:
 *
 * 1. **Paths** for every tracked file, so ⌘K can jump to a file in a project
 *    that is not the active one.
 * 2. **Bodies** in SQLite FTS5, so the same box does full-text search.
 *
 * Untrusted projects are never read. Trust is what gates content access
 * everywhere else in the app (plan §9), and an index is a durable copy of file
 * contents, so it would be the loudest possible place to break that rule.
 */
export class IndexService {
  private readonly running = new Set<string>();
  private readonly queued = new Map<string, Promise<IndexStateRecord | null>>();

  constructor(
    private readonly deps: {
      repo: IndexRepository;
      listProjects: () => IndexTarget[];
      onChanged?: (projectId: string) => void;
    },
  ) {}

  isIndexing(projectId: string): boolean {
    return this.running.has(projectId);
  }

  /** Refresh unless a recent pass already covered this project. */
  async refreshIfStale(projectId: string): Promise<IndexStateRecord | null> {
    const state = this.deps.repo.getState(projectId);
    if (state && Date.now() - state.updatedAt < FRESH_MS) return state;
    return this.refresh(projectId);
  }

  /**
   * Bring a project's index in line with disk. Incremental: a file whose size
   * and mtime are unchanged is not re-read, so a repeat pass over a large repo
   * costs a `git ls-files` plus a `stat` per file.
   */
  async refresh(projectId: string, options?: { force?: boolean }): Promise<IndexStateRecord | null> {
    const queued = this.queued.get(projectId);
    if (queued) return queued;
    const task = this.runRefresh(projectId, options?.force ?? false).finally(() => {
      this.queued.delete(projectId);
      this.running.delete(projectId);
      this.deps.onChanged?.(projectId);
    });
    this.queued.set(projectId, task);
    this.running.add(projectId);
    this.deps.onChanged?.(projectId);
    return task;
  }

  private async runRefresh(projectId: string, force: boolean): Promise<IndexStateRecord | null> {
    const project = this.deps.listProjects().find((entry) => entry.id === projectId);
    if (!project) return null;
    if (!project.trusted) {
      // Trust can be revoked after an index exists; drop what we hold rather
      // than serving search results from a project the user has locked down.
      this.deps.repo.deleteProject(projectId);
      return null;
    }

    const startedAt = Date.now();
    if (force) this.deps.repo.deleteProject(projectId);

    const known = force ? new Map() : this.deps.repo.listFiles(projectId);
    const seen = new Set<string>();
    const listing = await listProjectFiles(project);

    let files = 0;
    let indexedBytes = 0;
    let skipped = 0;
    let processed = 0;

    for (const relative of listing.paths) {
      processed += 1;
      if (processed % BATCH_SIZE === 0) await yieldToLoop();

      const absolute = path.join(project.path, relative);
      let size: number;
      let mtimeMs: number;
      try {
        const stats = await stat(absolute);
        if (!stats.isFile()) continue;
        size = stats.size;
        mtimeMs = Math.round(stats.mtimeMs);
      } catch {
        continue;
      }

      seen.add(relative);
      files += 1;

      const previous = known.get(relative);
      if (previous && previous.size === size && previous.mtimeMs === mtimeMs) {
        // Unchanged — keep the existing row, including its body.
        if (previous.contentRowid == null) skipped += 1;
        else indexedBytes += size;
        continue;
      }

      const wantsBody =
        size <= MAX_FILE_BYTES &&
        indexedBytes + size <= MAX_CONTENT_BYTES &&
        !isProbablyNotText(relative);

      let body: string | undefined;
      if (wantsBody) {
        try {
          const buffer = await readFile(absolute);
          if (looksBinary(buffer)) {
            body = undefined;
          } else {
            body = buffer.toString('utf8');
          }
        } catch {
          body = undefined;
        }
      }

      if (body == null) skipped += 1;
      else indexedBytes += size;

      this.deps.repo.upsertFile(
        body == null
          ? { projectId, path: relative, size, mtimeMs }
          : { projectId, path: relative, size, mtimeMs, body },
      );
    }

    // Anything indexed before and absent now has been deleted or ignored.
    for (const relative of known.keys()) {
      if (!seen.has(relative)) this.deps.repo.deleteFile(projectId, relative);
    }

    const state: IndexStateRecord = {
      projectId,
      head: listing.head,
      files,
      indexedBytes,
      skipped: skipped + listing.truncated,
      updatedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    };
    this.deps.repo.putState(state);
    return state;
  }

  /** Per-project index state, including projects never indexed. */
  status(): IndexProjectStatus[] {
    const states = new Map(this.deps.repo.listStates().map((state) => [state.projectId, state]));
    return this.deps.listProjects().map((project) => {
      const state = states.get(project.id);
      return {
        projectId: project.id,
        name: project.name,
        path: project.path,
        trusted: project.trusted,
        indexing: this.running.has(project.id),
        files: state?.files ?? 0,
        indexedBytes: state?.indexedBytes ?? 0,
        skipped: state?.skipped ?? 0,
        updatedAt: state?.updatedAt ?? null,
        durationMs: state?.durationMs ?? null,
      };
    });
  }

  /**
   * Search paths and bodies at once. Scoped to trusted projects even if a stale
   * row survives, and to one project when `projectId` is given.
   */
  search(input: { query: string; projectId?: string; limit?: number }): IndexSearchResult {
    const trusted = this.deps.listProjects().filter((project) => project.trusted);
    const scoped = input.projectId
      ? trusted.filter((project) => project.id === input.projectId)
      : trusted;
    if (!scoped.length) return { paths: [], content: [] };

    const labels = new Map<string, ProjectLabel>(
      scoped.map((project) => [
        project.id,
        { projectName: project.name, projectPath: project.path },
      ]),
    );
    const labelFor = (projectId: string): ProjectLabel =>
      labels.get(projectId) ?? { projectName: projectId, projectPath: '' };
    const projectIds = scoped.map((project) => project.id);
    const limit = input.limit ?? 12;

    const paths = this.deps.repo
      .searchPaths({ query: input.query, projectIds, limit })
      .map((hit) => ({ ...hit, ...labelFor(hit.projectId) }));

    const pathSet = new Set(paths.map((hit) => `${hit.projectId}:${hit.path}`));
    const content = this.deps.repo
      .searchContent({ query: input.query, projectIds, limit: limit * 2 })
      // A file already listed by path does not need a second row for its body.
      .filter((hit) => !pathSet.has(`${hit.projectId}:${hit.path}`))
      .slice(0, limit)
      .map((hit) => ({ ...hit, ...labelFor(hit.projectId) }));

    return { paths, content };
  }

  forget(projectId: string): void {
    this.deps.repo.deleteProject(projectId);
    this.deps.onChanged?.(projectId);
  }
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Files to consider, respecting .gitignore where git can tell us. The non-git
 * walk is a fallback with a static skip list — less accurate, but a plain folder
 * is still worth searching.
 */
async function listProjectFiles(
  project: IndexTarget,
): Promise<{ paths: string[]; head: string | null; truncated: number }> {
  if (project.isGit) {
    try {
      const { stdout } = await exec(
        'git',
        ['ls-files', '--cached', '--other', '--exclude-standard'],
        { cwd: project.path, maxBuffer: 32 * 1024 * 1024 },
      );
      const all = stdout.split('\n').filter(Boolean);
      let head: string | null = null;
      try {
        const rev = await exec('git', ['rev-parse', 'HEAD'], {
          cwd: project.path,
          maxBuffer: 64 * 1024,
        });
        head = rev.stdout.trim() || null;
      } catch {
        head = null; // A repo with no commits yet.
      }
      return {
        paths: all.slice(0, MAX_FILES),
        head,
        truncated: Math.max(0, all.length - MAX_FILES),
      };
    } catch {
      // Fall through to the walk — a broken git invocation should not mean no index.
    }
  }

  const paths: string[] = [];
  let truncated = 0;
  async function walk(directory: string, prefix: string): Promise<void> {
    if (paths.length >= MAX_FILES) return;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        if (paths.length >= MAX_FILES) {
          truncated += 1;
          continue;
        }
        paths.push(relative);
      }
    }
  }
  await walk(project.path, '');
  return { paths, head: null, truncated };
}

function isProbablyNotText(relative: string): boolean {
  const base = relative.slice(relative.lastIndexOf('/') + 1);
  if (SKIP_NAMES.has(base)) return true;
  if (base.endsWith('.min.js') || base.endsWith('.min.css')) return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return SKIP_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

/** A NUL byte in the first 8KB is the same heuristic git and ripgrep use. */
function looksBinary(buffer: Buffer): boolean {
  const window = buffer.subarray(0, Math.min(buffer.length, 8192));
  return window.includes(0);
}
