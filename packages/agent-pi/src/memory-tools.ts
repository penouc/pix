import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

/*
 * #20 — project-scoped memory + learn→skill (self-built, no cloud).
 *
 * `memory` gives the agent a durable per-project scratchpad:
 *
 *   - retain   — save a note (project convention, discovered constraint,
 *                lesson, decision) under a key
 *   - recall   — read notes (all, or by key / fuzzy match)
 *   - forget   — drop a note
 *
 * Notes live in `<project>/.pi-desktop/agent/memory.json` — gitignored (the
 * repo ignores `.pi-desktop/`), project-scoped, and plain JSON so it
 * survives restarts with zero infrastructure.
 *
 * `learn` writes a skill: `<project>/.pi/skills/<name>/SKILL.md`. That is the
 * exact directory Pi's DefaultResourceLoader and the desktop SkillsService
 * scan for project skills, so a written skill shows up in the `$` picker and
 * is loaded by the runtime on the next session. This is the "可选把教训写成
 * skill" half of #20.
 *
 * Risk classification: recall is `safe`; retain/forget/learn write files
 * under the workspace → `workspace-write` (approval-gated in Ask mode,
 * blocked in Plan Mode).
 */

export interface MemoryNote {
  key: string;
  value: string;
  updatedAt: number;
}

const MAX_MEMORY_BYTES = 256 * 1024;

function memoryPath(projectPath: string): string {
  return path.join(projectPath, '.pi-desktop', 'agent', 'memory.json');
}

export function loadMemory(projectPath: string): MemoryNote[] {
  try {
    const raw = readFileSync(memoryPath(projectPath), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is MemoryNote =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as MemoryNote).key === 'string' &&
          typeof (entry as MemoryNote).value === 'string',
      )
      .map((entry) => ({
        key: entry.key,
        value: entry.value,
        updatedAt: Number(entry.updatedAt) || 0,
      }));
  } catch {
    return [];
  }
}

export function saveMemory(projectPath: string, notes: MemoryNote[]): void {
  const file = memoryPath(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(notes, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_MEMORY_BYTES) {
    throw new Error('Memory store exceeds 256 KB; forget some notes before retaining more.');
  }
  writeFileSync(file, json, 'utf8');
}

/** Pure store ops. Exported for tests. */
export function applyMemoryOp(
  notes: MemoryNote[],
  op:
    | { action: 'retain'; key: string; value: string }
    | { action: 'forget'; key: string },
): MemoryNote[] {
  switch (op.action) {
    case 'retain': {
      const key = op.key.trim();
      if (!key) return notes;
      const value = op.value.trim();
      if (!value) return notes;
      const next = notes.filter((note) => note.key !== key);
      next.push({ key, value: value.slice(0, 4000), updatedAt: Date.now() });
      return next;
    }
    case 'forget': {
      const key = op.key.trim();
      if (!key) return notes;
      return notes.filter((note) => note.key !== key);
    }
    default:
      return notes;
  }
}

const memorySchema = Type.Object({
  action: Type.Union([
    Type.Literal('retain', { description: 'Save a note under a key' }),
    Type.Literal('recall', { description: 'Read saved notes' }),
    Type.Literal('forget', { description: 'Drop a note by key' }),
  ]),
  /** retain/forget: the note key. recall: optional filter. */
  key: Type.Optional(Type.String({ description: 'Note key' })),
  /** retain: the note body. recall: optional fuzzy match. */
  value: Type.Optional(Type.String({ description: 'Note body (retain) or search text (recall)' })),
});
type MemoryParams = Static<typeof memorySchema>;

const learnSchema = Type.Object({
  name: Type.String({ description: 'Skill name (kebab-case, e.g. test-failure-triage)' }),
  description: Type.String({ description: 'One-line description shown in the $ picker' }),
  /** Markdown body of SKILL.md (without frontmatter). */
  body: Type.String({ description: 'Markdown instructions for the skill' }),
});
type LearnParams = Static<typeof learnSchema>;

export function createMemoryTool() {
  return defineTool({
    name: 'memory',
    label: 'Project memory',
    description:
      'A durable per-project scratchpad. retain saves a note (a convention, constraint, lesson, or decision) under a key; recall reads notes; forget drops one. Notes persist across sessions in .pi-desktop/agent/memory.json. Writing is approval-gated.',
    promptSnippet: 'memory — project-scoped retain/recall notes',
    promptGuidelines: [
      'retain project conventions, constraints and hard-won lessons so future sessions do not re-discover them.',
      'recall before starting work that depends on prior decisions.',
      'Keep values concise and factual; do not store secrets.',
    ],
    parameters: memorySchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: MemoryParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ notes: MemoryNote[] }>> {
      const projectPath = ctx?.cwd ?? process.cwd();
      const notes = loadMemory(projectPath);

      if (params.action === 'recall') {
        const filter = params.value?.trim().toLowerCase();
        const key = params.key?.trim().toLowerCase();
        const matched = notes.filter((note) => {
          if (key && note.key.toLowerCase() !== key) return false;
          if (filter && !`${note.key} ${note.value}`.toLowerCase().includes(filter)) return false;
          return true;
        });
        const text = matched.length
          ? matched.map((note) => `${note.key}: ${note.value}`).join('\n')
          : 'No matching notes.';
        return {
          content: [{ type: 'text', text }],
          details: { notes: matched },
        };
      }

      if (params.action === 'retain') {
        const next = applyMemoryOp(notes, {
          action: 'retain',
          key: params.key ?? '',
          value: params.value ?? '',
        });
        try {
          saveMemory(projectPath, next);
        } catch (error) {
          return {
            content: [
              { type: 'text', text: `Memory write failed: ${error instanceof Error ? error.message : String(error)}` },
            ],
            details: { notes },
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Retained "${params.key ?? ''}" (${next.length} note${next.length === 1 ? '' : 's'}).`,
            },
          ],
          details: { notes: next },
        };
      }

      if (params.action === 'forget') {
        const next = applyMemoryOp(notes, {
          action: 'forget',
          key: params.key ?? '',
        });
        try {
          saveMemory(projectPath, next);
        } catch (error) {
          return {
            content: [
              { type: 'text', text: `Memory write failed: ${error instanceof Error ? error.message : String(error)}` },
            ],
            details: { notes },
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Forgot "${params.key ?? ''}" (${next.length} note${next.length === 1 ? '' : 's'} remaining).`,
            },
          ],
          details: { notes: next },
        };
      }

      return { content: [{ type: 'text', text: 'Unknown memory action.' }], details: { notes } };
    },
  });
}

export function createLearnSkillTool() {
  return defineTool({
    name: 'learn',
    label: 'Learn as skill',
    description:
      'Write a reusable skill to .pi/skills/<name>/SKILL.md so it appears in the $ picker and loads on future sessions. Use when a lesson is worth packaging as a repeatable procedure. Writes a file — approval-gated, blocked in Plan Mode.',
    promptSnippet: 'learn — write a lesson as a reusable project skill',
    promptGuidelines: [
      'Package only genuinely repeatable procedures, not one-off fixes.',
      'name must be kebab-case; description is the one-liner shown in the picker.',
      'The body should be step-by-step instructions the agent can follow directly.',
    ],
    parameters: learnSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: LearnParams,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: ExtensionContext,
    ): Promise<AgentToolResult<{ path: string }>> {
      const projectPath = ctx?.cwd ?? process.cwd();
      const name = params.name.trim().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      if (!name) {
        return { content: [{ type: 'text', text: 'Skill name must not be empty.' }], details: { path: '' } };
      }
      const dir = path.join(projectPath, '.pi', 'skills', name);
      const file = path.join(dir, 'SKILL.md');
      mkdirSync(dir, { recursive: true });
      const description = params.description.trim().slice(0, 400);
      const body = params.body.trim();
      const frontmatter = [
        '---',
        `name: ${name}`,
        `description: ${description.replace(/^['"]|['"]$/g, '')}`,
        '---',
        '',
      ].join('\n');
      writeFileSync(file, `${frontmatter}${body}\n`, 'utf8');
      return {
        content: [
          { type: 'text', text: `Skill written to .pi/skills/${name}/SKILL.md (command /skill:${name}).` },
        ],
        details: { path: file },
      };
    },
  });
}
