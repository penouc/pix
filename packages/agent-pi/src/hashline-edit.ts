import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

/*
 * #13 — Hashline / anchored editing (移植思路 from OMP).
 *
 * Pi's built-in `edit` already matches oldText exactly-once and rejects
 * stale/ambiguous blocks. This custom `edit` keeps that contract (so every
 * existing model behaviour keeps working) and layers the hashline idea on top:
 *
 *  1. `lineHash` anchors — target a line by the sha256 of its text. A hash
 *     identifies one line even when the same text repeats elsewhere in the
 *     file, and it survives the whitespace / smart-quote drift that breaks
 *     exact-text matching. `hash_lines` surfaces the hashes to the model.
 *  2. `oldHash` staleness — sha256 of the WHOLE FILE as the model last read
 *     it. When present, the edit is rejected if the file changed anywhere
 *     since that read, so the model can never silently edit a file whose view
 *     it no longer holds.
 *  3. All-or-nothing — every edit is validated against the ORIGINAL file
 *     before anything is written; one bad anchor rejects the whole call with
 *     no partial write. Original line endings and the trailing newline are
 *     preserved.
 *
 * Registered under the name `edit` (extension tools override built-ins of the
 * same name — verified in the SDK's tool-registry merge), so checkpoints
 * (writeToolPath → 'edit'), the permission pipeline (workspace-write) and
 * Plan Mode gating keep working unchanged.
 */

const MAX_EDITS = 50;
const HASH_LINES_LIMIT = 200;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 12-char prefix is plenty to anchor on and keeps tool output compact. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

export interface HashLineEntry {
  /** 1-based line number. */
  line: number;
  /** sha256 hex (full) of the line's text without its line ending. */
  hash: string;
  text: string;
}

/** Per-line hashes for a file, for `hash_lines` and tests. */
export function buildLineHashes(content: string): { entries: HashLineEntry[]; fileHash: string } {
  const lf = content.replace(/\r\n/g, '\n');
  const lines = lf.split('\n');
  const entries: HashLineEntry[] = [];
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!;
    // The split on a trailing newline produces a final empty line that is not
    // part of the file; skip it so line numbers stay honest.
    if (index === lines.length - 1 && text === '') break;
    entries.push({ line: index + 1, hash: sha256Hex(text), text });
  }
  return { entries, fileHash: sha256Hex(lf) };
}

export interface AnchoredEdit {
  newText: string;
  /** Exact unique block anchor (mutually exclusive with lineHash). */
  oldText?: string;
  /** sha256 hex of the WHOLE FILE as the model last read it (staleness). */
  oldHash?: string;
  /** sha256 hex of the exact line to replace (mutually exclusive with oldText). */
  lineHash?: string;
}

const anchoredEditItemSchema = Type.Object({
  oldText: Type.Optional(Type.String({ description: 'Exact text to replace' })),
  newText: Type.String({ description: 'Replacement text' }),
  oldHash: Type.Optional(
    Type.String({ description: 'sha256 of the whole file as you last read it' }),
  ),
  lineHash: Type.Optional(Type.String({ description: 'sha256 of the exact line to replace' })),
});

export const editToolSchema = Type.Object({
  path: Type.String({ description: 'File to edit, relative to the workspace root' }),
  edits: Type.Array(anchoredEditItemSchema, { description: 'Targeted replacements' }),
});

export type AnchoredEditInput = Static<typeof editToolSchema>;

export interface AppliedEdit {
  index: number;
  mode: 'oldText' | 'lineHash';
  /** 1-based line of the first changed line in the NEW content. */
  line: number;
}

export class AnchorEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnchorEditError';
  }
}

/** Normalize a block the model may have copied without its final newline. */
function normalizeAnchor(text: string): string {
  let value = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (value.endsWith('\n')) value = value.slice(0, -1);
  return value;
}

interface Replacement {
  start: number;
  end: number;
  newText: string;
  edit: AppliedEdit;
}

function findExactOnce(text: string, oldText: string): number {
  const target = normalizeAnchor(oldText);
  const first = text.indexOf(target);
  if (first === -1) {
    throw new AnchorEditError(
      'Could not find the exact text in the file. The old text must match exactly including all whitespace and newlines. Re-read the file and retry.',
    );
  }
  const second = text.indexOf(target, first + 1);
  if (second !== -1) {
    throw new AnchorEditError(
      'Found multiple occurrences of the text. Each oldText must be unique — add surrounding context lines to disambiguate.',
    );
  }
  return first;
}

function lineOffsetAt(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i]!.length + 1;
  return offset;
}

/**
 * Apply anchored edits to the ORIGINAL content. Validation happens for every
 * edit before any modification, so a failing edit never leaves a partial
 * write. Line endings (CRLF vs LF) and a trailing newline are preserved.
 */
export function applyAnchoredEdits(
  content: string,
  edits: AnchoredEdit[],
): { content: string; applied: AppliedEdit[] } {
  if (edits.length > MAX_EDITS) {
    throw new AnchorEditError(`Too many edits: ${edits.length} (max ${MAX_EDITS}) in one call.`);
  }

  const ending = content.includes('\r\n') ? '\r\n' : '\n';
  let text = content.replace(/\r\n/g, '\n');
  const hadTrailingNewline = text.endsWith('\n');
  if (hadTrailingNewline) text = text.slice(0, -1);
  const lines = text.split('\n');

  // Whole-file staleness gate applies to every edit in the call.
  const currentFileHash = sha256Hex(text);
  for (const edit of edits) {
    if (edit.oldHash && edit.oldHash !== currentFileHash) {
      throw new AnchorEditError(
        'oldHash does not match the current file — the file changed after you read it. Re-read the file (or use hash_lines) and retry.',
      );
    }
  }

  const replacements: Replacement[] = [];
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]!;
    const hasText = typeof edit.oldText === 'string' && edit.oldText.trim().length > 0;
    const hasHash = typeof edit.lineHash === 'string' && edit.lineHash.length > 0;
    if (hasText && hasHash) {
      throw new AnchorEditError(
        `edits[${index}] provides both oldText and lineHash — use exactly one anchor per edit.`,
      );
    }
    if (!hasText && !hasHash) {
      throw new AnchorEditError(
        `edits[${index}] has no anchor — provide oldText (or lineHash) plus newText.`,
      );
    }

    if (hasText) {
      const start = findExactOnce(text, edit.oldText!);
      const end = start + normalizeAnchor(edit.oldText!).length;
      replacements.push({
        start,
        end,
        newText: normalizeAnchor(edit.newText),
        edit: { index, mode: 'oldText', line: 0 },
      });
    } else {
      const matches: number[] = [];
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (sha256Hex(lines[lineIndex]!) === edit.lineHash) matches.push(lineIndex);
      }
      if (matches.length === 0) {
        throw new AnchorEditError(
          `No line matches lineHash ${shortHash(edit.lineHash!)} — the file changed since the hash was computed. Re-run hash_lines and retry.`,
        );
      }
      if (matches.length > 1) {
        throw new AnchorEditError(
          `lineHash ${shortHash(edit.lineHash!)} matches ${matches.length} identical lines; use oldText with surrounding context instead.`,
        );
      }
      const lineIndex = matches[0]!;
      const start = lineOffsetAt(lines, lineIndex);
      replacements.push({
        start,
        end: start + lines[lineIndex]!.length,
        newText: normalizeAnchor(edit.newText),
        edit: { index, mode: 'lineHash', line: lineIndex + 1 },
      });
    }
  }

  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      throw new AnchorEditError(
        'Edits overlap in the file. Merge nearby changes into one edit instead of emitting overlapping edits.',
      );
    }
  }

  let result = text;
  for (const replacement of sorted.slice().reverse()) {
    result =
      result.slice(0, replacement.start) + replacement.newText + result.slice(replacement.end);
  }

  const newLines = result.split('\n');
  const applied = sorted.map((replacement) => {
    let line = 1;
    let offset = 0;
    for (let i = 0; i < newLines.length; i++) {
      if (offset >= replacement.start) break;
      offset += newLines[i]!.length + 1;
      line = i + 2;
    }
    return { ...replacement.edit, line };
  });

  let final = result;
  if (hadTrailingNewline) final += '\n';
  if (ending === '\r\n') final = final.replace(/\n/g, '\r\n');

  return { content: final, applied };
}

function resolveEditPath(rawPath: string, cwd: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

function buildDiff(original: string, updated: string): string {
  const a = original.split('\n');
  const b = updated.split('\n');
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left !== undefined) lines.push(`- ${left}`);
    if (right !== undefined) lines.push(`+ ${right}`);
  }
  return lines.length ? lines.join('\n') : '(no change)';
}

/**
 * The hashline-capable `edit` tool, registered under the name `edit`,
 * replacing Pi's built-in for our sessions.
 */
export function createAnchoredEditTool() {
  return defineTool({
    name: 'edit',
    label: 'Edit file',
    description:
      'Make precise edits to a file using anchored text replacement. Each edit matches against the original file: provide oldText (exact and unique) plus newText, or anchor by lineHash (sha256 of the exact line from hash_lines). Optionally pass oldHash (sha256 of the whole file as you last read it) to have the tool verify the file has not changed since your read. All edits are validated before anything is written: a stale, missing, or ambiguous anchor rejects the whole call with nothing written.',
    promptSnippet: 'edit — precise anchored edits (oldText or lineHash; optional oldHash staleness)',
    promptGuidelines: [
      'Use edit for precise changes. oldText must match exactly and uniquely — add surrounding lines to disambiguate.',
      'When a previous edit failed with "multiple occurrences" or whitespace drift, call hash_lines first, then anchor with lineHash.',
      'Pass oldHash (sha256 of the whole file from your last read or hash_lines) when you want a stale-anchor guarantee.',
    ],
    parameters: editToolSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: AnchoredEditInput,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ diff: string; applied: AppliedEdit[] }>> {
      const cwd = ctx?.cwd ?? process.cwd();
      const absolutePath = resolveEditPath(params.path, cwd);
      const original = await readFile(absolutePath, 'utf8');
      const { content: updated, applied } = applyAnchoredEdits(original, params.edits);
      // Nothing above wrote anything; only now persist.
      await writeFile(absolutePath, updated, 'utf8');
      return {
        content: [
          {
            type: 'text',
            text: `Successfully replaced ${applied.length} block(s) in ${params.path}.`,
          },
        ],
        details: { diff: buildDiff(original, updated), applied },
      };
    },
  });
}

/**
 * `hash_lines` — surface line hashes to the model so it can anchor edits
 * precisely (#13). Read-only and safe: never enters the approval queue.
 */
export function createHashLinesTool() {
  return defineTool({
    name: 'hash_lines',
    label: 'Hash file lines',
    description:
      'Return the sha256 hash of every line of a file, plus the sha256 of the whole file. Use with the edit tool: anchor a single-line replacement by lineHash, or pass the whole-file hash as oldHash to guard against stale edits. Output is truncated to the first 200 lines.',
    promptSnippet: 'hash_lines — line hashes for precise anchored edits',
    parameters: Type.Object({
      path: Type.String({ description: 'File to hash, relative to the workspace root' }),
    }),
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: { path: string },
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ entries: HashLineEntry[]; fileHash: string }>> {
      const cwd = ctx?.cwd ?? process.cwd();
      const absolutePath = resolveEditPath(params.path, cwd);
      const content = await readFile(absolutePath, 'utf8');
      const { entries, fileHash } = buildLineHashes(content);
      const shown = entries.slice(0, HASH_LINES_LIMIT);
      const lines = shown.map(
        (entry) => `${entry.line}: ${shortHash(entry.hash)}  ${entry.text}`,
      );
      if (entries.length > shown.length) {
        lines.push(`… (${entries.length - shown.length} more lines)`);
      }
      lines.push(`file sha256: ${fileHash}`);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { entries, fileHash },
      };
    },
  });
}
