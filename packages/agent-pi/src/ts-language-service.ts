import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

/*
 * #14 — LSP tools via TypeScript's in-process language service.
 *
 * No external LSP server binary is needed: the TypeScript compiler ships the
 * same language-service engine (diagnostics, references, rename) that powers
 * editors, and it runs in-process. This module owns the LanguageServiceHost
 * (file discovery, versions, snapshots) and exposes three operations that the
 * lsp_* tools call:
 *
 *   - getFileDiagnostics  → syntactic + semantic errors for one file
 *   - findReferences      → every reference to a symbol, across files
 *   - renameSymbol        → compute rename locations and apply the text edits
 *
 * The host is cached per workspace root; file versions come from mtime so a
 * rename (or any external change) invalidates the right files automatically.
 */

export interface TsDiagnosticEntry {
  file: string;
  line: number;
  character: number;
  code: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface TsReferenceEntry {
  file: string;
  line: number;
  character: number;
  /** The referenced symbol's text. */
  text: string;
}

export interface TsRenameResult {
  /** Project-relative file paths that were rewritten. */
  changedFiles: string[];
  locations: Array<{ file: string; line: number; character: number; text: string }>;
  newName: string;
}

/** Skip scanning directories that would explode the program. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  allowJs: true,
  checkJs: false,
  skipLibCheck: true,
  noEmit: true,
  resolveJsonModule: true,
  esModuleInterop: true,
};

interface HostEntry {
  host: ts.LanguageServiceHost;
  service: ts.LanguageService;
}

const hosts = new Map<string, HostEntry>();

function collectSourceFiles(rootPath: string, seen = new Set<string>()): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        const real = full;
        if (seen.has(real)) continue;
        seen.add(real);
        files.push(full);
      }
    }
  };
  walk(rootPath);
  return files.sort();
}

function fileVersion(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function createHost(rootPath: string): HostEntry {
  // Always re-collect on demand: a rename may add or remove files between
  // calls, and the program is rebuilt lazily from this list anyway.
  const listFiles = () => collectSourceFiles(rootPath);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => listFiles(),
    getScriptVersion: (fileName) => fileVersion(fileName),
    getScriptSnapshot: (fileName) => {
      if (!path.isAbsolute(fileName)) return undefined;
      try {
        const text = readFileSync(fileName, 'utf8');
        return ts.ScriptSnapshot.fromString(text);
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => rootPath,
    getCompilationSettings: () => ({ ...DEFAULT_COMPILER_OPTIONS }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    // Deliberately NOT `ts.sys.*`: TypeScript's node sys initializer reads
    // `__filename`, which the ESM bundle of the Electron main process cannot
    // resolve. Pure node:fs implementations avoid that code path entirely.
    fileExists: (fileName) => existsSync(fileName),
    readFile: (fileName) => readFileSync(fileName, 'utf8'),
    directoryExists: (dirName) => existsSync(dirName) && statSync(dirName).isDirectory(),
    getDirectories: (dirName) =>
      readdirSync(dirName, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
  };
  const service = ts.createLanguageService(host);
  return { host, service };
}

function getService(rootPath: string): HostEntry {
  const key = path.resolve(rootPath);
  let entry = hosts.get(key);
  if (!entry) {
    entry = createHost(key);
    hosts.set(key, entry);
  }
  return entry;
}

function toProjectPath(rootPath: string, fileName: string): string {
  const rel = path.relative(rootPath, fileName);
  return rel ? rel.split(path.sep).join('/') : fileName;
}

function positionOf(fileContent: string, line: number, character: number): number {
  const lines = fileContent.split('\n');
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i]!.length + 1;
  }
  return offset + character;
}

function lineColumnOf(fileContent: string, offset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset; i++) {
    if (fileContent[i] === '\n') {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
  }
  return { line, character };
}

/** Find the first position of a bare identifier in the file. */
function findIdentifierPosition(filePath: string, symbol: string): number | null {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`);
  const match = regex.exec(content);
  if (!match) return null;
  return match.index;
}

/** Strip the first line (the "→ " prefix LSP diagnostics carry) if present. */
function cleanDiagnosticMessage(message: string): string {
  const idx = message.indexOf(' ');
  if (idx === -1) return message;
  const firstWord = message.slice(0, idx);
  if (/^[a-zA-Z]+$/.test(firstWord) && firstWord.length <= 20) return message;
  return message;
}

export function getFileDiagnostics(rootPath: string, filePath: string): TsDiagnosticEntry[] {
  const { service } = getService(rootPath);
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootPath, filePath);
  const raw = [
    ...service.getSyntacticDiagnostics(absolute),
    ...service.getSemanticDiagnostics(absolute),
  ];
  return raw
    .filter((diagnostic) => diagnostic.start !== undefined && diagnostic.length !== undefined)
    .map((diagnostic) => {
      const content = readFileSync(absolute, 'utf8');
      const position = lineColumnOf(content, diagnostic.start!);
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      return {
        file: toProjectPath(rootPath, absolute),
        line: position.line + 1,
        character: position.character,
        code: typeof diagnostic.code === 'number' ? diagnostic.code : 0,
        message: cleanDiagnosticMessage(message),
        severity: (diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error') as
          | 'error'
          | 'warning',
      };
    });
}

export function findReferences(
  rootPath: string,
  filePath: string,
  symbol: string,
): { references: TsReferenceEntry[]; matched: boolean } {
  const { service } = getService(rootPath);
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootPath, filePath);
  const offset = findIdentifierPosition(absolute, symbol);
  if (offset === null) return { references: [], matched: false };
  const content = readFileSync(absolute, 'utf8');
  const position = lineColumnOf(content, offset);
  const entries = service.findReferences(absolute, positionOf(content, position.line, position.character)) ?? [];
  const references: TsReferenceEntry[] = [];
  for (const entry of entries) {
    for (const reference of entry.references) {
      const refContent = readFileSync(reference.fileName, 'utf8');
      const refPosition = lineColumnOf(refContent, reference.textSpan.start);
      references.push({
        file: toProjectPath(rootPath, reference.fileName),
        line: refPosition.line + 1,
        character: refPosition.character,
        text: refContent.slice(reference.textSpan.start, reference.textSpan.start + reference.textSpan.length),
      });
    }
  }
  return { references, matched: true };
}

export function renameSymbol(
  rootPath: string,
  filePath: string,
  symbol: string,
  newName: string,
): TsRenameResult {
  const entry = getService(rootPath);
  const { service } = entry;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootPath, filePath);
  const offset = findIdentifierPosition(absolute, symbol);
  if (offset === null) {
    throw new Error(`Could not find symbol "${symbol}" in ${filePath}.`);
  }
  const content = readFileSync(absolute, 'utf8');
  const position = lineColumnOf(content, offset);
  const locations = service.findRenameLocations(
    absolute,
    positionOf(content, position.line, position.character),
    false,
    false,
  );
  if (!locations || locations.length === 0) {
    throw new Error(`No rename locations found for "${symbol}" in ${filePath}.`);
  }

  // Apply text changes grouped by file (LSP-style), then persist.
  const byFile = new Map<string, ts.TextChange[]>();
  for (const location of locations) {
    const list = byFile.get(location.fileName) ?? [];
    list.push({ span: location.textSpan, newText: newName });
    byFile.set(location.fileName, list);
  }

  const changedFiles: string[] = [];
  for (const [fileName, changes] of byFile) {
    const original = readFileSync(fileName, 'utf8');
    const sorted = [...changes].sort((a, b) => b.span.start - a.span.start);
    let updated = original;
    for (const change of sorted) {
      updated =
        updated.slice(0, change.span.start) + change.newText + updated.slice(change.span.start + change.span.length);
    }
    if (updated !== original) {
      writeFileSync(fileName, updated, 'utf8');
      changedFiles.push(toProjectPath(rootPath, fileName));
    }
  }

  return {
    changedFiles,
    locations: locations.map((location) => {
      const locContent = readFileSync(location.fileName, 'utf8');
      const locPos = lineColumnOf(locContent, location.textSpan.start);
      return {
        file: toProjectPath(rootPath, location.fileName),
        line: locPos.line + 1,
        character: locPos.character,
        text: locContent.slice(location.textSpan.start, location.textSpan.start + location.textSpan.length),
      };
    }),
    newName,
  };
}

/** Drop cached hosts (used by tests to avoid cross-test contamination). */
export function resetLanguageServiceCache(): void {
  hosts.clear();
}
