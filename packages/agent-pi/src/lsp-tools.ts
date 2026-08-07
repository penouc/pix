import path from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import {
  findReferences,
  getFileDiagnostics,
  renameSymbol,
  type TsDiagnosticEntry,
  type TsRenameResult,
} from './ts-language-service.js';

/*
 * #14 — LSP tools, self-built on TypeScript's in-process language service.
 *
 * Three tools, each gated by the permission pipeline:
 *
 *   - lsp_diagnostics — type + syntax errors for one file. Read-only → safe.
 *   - lsp_references   — every reference to a symbol across the project.
 *                        Read-only → safe.
 *   - lsp_rename       — rename a symbol everywhere it appears, writing the
 *                        affected files. Mutates the workspace → workspace-write,
 *                        so it requires approval in ask mode and is forbidden in
 *                        Plan Mode.
 *
 * The rename tool writes through node:fs. The `tool_call` hook snapshots the
 * primary file for checkpoints before execution (writeToolPath → 'lsp_rename');
 * other renamed files stay recoverable through the run-level baseline.
 */

const FILE_PATH = Type.String({ description: 'File to analyse, relative to the workspace root' });

const diagnosticsSchema = Type.Object({
  path: FILE_PATH,
});
type DiagnosticsParams = Static<typeof diagnosticsSchema>;

const referencesSchema = Type.Object({
  path: FILE_PATH,
  symbol: Type.String({ description: 'Identifier to find references for' }),
});
type ReferencesParams = Static<typeof referencesSchema>;

const renameSchema = Type.Object({
  path: FILE_PATH,
  symbol: Type.String({ description: 'Identifier to rename' }),
  newName: Type.String({ description: 'New identifier name (must be a valid identifier)' }),
});
type RenameParams = Static<typeof renameSchema>;

function resolvePath(rawPath: string, cwd: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

export function createLspDiagnosticsTool() {
  return defineTool({
    name: 'lsp_diagnostics',
    label: 'LSP diagnostics',
    description:
      'Return TypeScript syntax and type errors for a file. Each entry gives the file, line, column, error code and message. Use after an edit to verify the change is type-clean, or when a run fails on a compile error you cannot see.',
    promptSnippet: 'lsp_diagnostics — TypeScript syntax + type errors for a file',
    promptGuidelines: [
      'Use lsp_diagnostics after editing a TypeScript file to confirm there are no new errors.',
      'Fix errors by code: the code identifies the rule (e.g. 2322 is an assignment type mismatch).',
    ],
    parameters: diagnosticsSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: DiagnosticsParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ diagnostics: TsDiagnosticEntry[] }>> {
      const cwd = ctx?.cwd ?? process.cwd();
      const absolutePath = resolvePath(params.path, cwd);
      const diagnostics = getFileDiagnostics(cwd, absolutePath);
      const text = diagnostics.length
        ? diagnostics
            .map(
              (d) =>
                `${d.file}:${d.line}:${d.character} [${d.severity} ${d.code}] ${d.message}`,
            )
            .join('\n')
        : 'No TypeScript diagnostics for this file.';
      return {
        content: [{ type: 'text', text }],
        details: { diagnostics },
      };
    },
  });
}

export function createLspReferencesTool() {
  return defineTool({
    name: 'lsp_references',
    label: 'LSP references',
    description:
      'Find every reference to a symbol (variable, function, class, import) across the TypeScript project. Returns file, line, column and the referenced text for each occurrence. Use to understand what a rename or refactor would touch before doing it.',
    promptSnippet: 'lsp_references — all references to a symbol across the project',
    promptGuidelines: [
      'Use lsp_references before renaming or removing a symbol to see the blast radius.',
      'The first occurrence found in the file anchors the search; the symbol must appear in the given file.',
    ],
    parameters: referencesSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: ReferencesParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ references: Array<{ file: string; line: number; character: number; text: string }> }>> {
      const cwd = ctx?.cwd ?? process.cwd();
      const absolutePath = resolvePath(params.path, cwd);
      const { references, matched } = findReferences(cwd, absolutePath, params.symbol);
      if (!matched) {
        return {
          content: [{ type: 'text', text: `Symbol "${params.symbol}" not found in ${params.path}.` }],
          details: { references: [] },
        };
      }
      const text = references.length
        ? references
            .map((r) => `${r.file}:${r.line}:${r.character}  ${r.text}`)
            .join('\n')
        : `No references to "${params.symbol}" found.`;
      return {
        content: [{ type: 'text', text }],
        details: { references },
      };
    },
  });
}

export function createLspRenameTool() {
  return defineTool({
    name: 'lsp_rename',
    label: 'LSP rename',
    description:
      'Rename a TypeScript symbol across the whole project: the declaration, every usage, and imports. This REWRITES files — it requires approval in Ask mode and is blocked in Plan Mode. Prefer lsp_references first to review what will change.',
    promptSnippet: 'lsp_rename — rename a symbol across the project (writes files)',
    promptGuidelines: [
      'Run lsp_references first to see every location lsp_rename would touch.',
      'newName must be a valid JavaScript identifier; the tool applies the language-service rename, so strings and comments are left alone.',
    ],
    parameters: renameSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: RenameParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<TsRenameResult>> {
      const cwd = ctx?.cwd ?? process.cwd();
      const absolutePath = resolvePath(params.path, cwd);
      const result = renameSymbol(cwd, absolutePath, params.symbol, params.newName);
      const lines = [
        `Renamed "${params.symbol}" → "${params.newName}" across ${result.changedFiles.length} file(s):`,
        ...result.changedFiles.map((file) => `  - ${file}`),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: result,
      };
    },
  });
}
