import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import type { SavedMemory } from '@pi-desktop/protocol';

/*
 * #20 — project-scoped memory + learn→skill (self-built, no cloud).
 * Phase-1 ChatGPT-style: optional `scope: "user"` talks to SQLite saved
 * memories (injected store), also injected into the system prompt.
 *
 * `memory` gives the agent a durable scratchpad:
 *
 *   - retain   — save a note under a key (project) or as free-text (user)
 *   - recall   — read notes
 *   - forget   — drop a note
 *
 * Project notes live in `<project>/.pi-desktop/agent/memory.json`.
 * User saved memories live in the app SQLite DB (Settings → Memory).
 */

export interface MemoryNote {
  key: string;
  value: string;
  updatedAt: number;
}

/** App-owned user saved memories. Wired from Main → PiAgentRuntime. */
export interface UserMemoryPersistence {
  list(): Promise<SavedMemory[]>;
  add(content: string, source?: SavedMemory['source']): Promise<SavedMemory>;
  /** Forget by id or content substring. */
  forget(keyOrContent: string): Promise<boolean>;
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

/** System-prompt block for ChatGPT-style always-on saved memories. */
export function formatSavedMemoriesPrompt(memories: SavedMemory[]): string {
  if (!memories.length) return '';
  const lines = memories.map((m) => `- ${m.content}`);
  return [
    '## Saved memories',
    'Durable facts about the user across projects. Prefer these over guessing. When the user asks to remember or forget something about themselves, use the memory tool with scope="user". Do not store secrets.',
    ...lines,
  ].join('\n');
}

const memorySchema = Type.Object({
  action: Type.Union([
    Type.Literal('retain', { description: 'Save a note under a key' }),
    Type.Literal('recall', { description: 'Read saved notes' }),
    Type.Literal('forget', { description: 'Drop a note by key' }),
  ]),
  /**
   * project (default) — per-repo JSON scratchpad.
   * user — ChatGPT-style saved memories in the app database.
   */
  scope: Type.Optional(
    Type.Union([Type.Literal('project'), Type.Literal('user')], {
      description: 'project = repo notes; user = cross-project saved memories',
    }),
  ),
  /** retain/forget: the note key (project) or id/snippet (user). recall: optional filter. */
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

export function createMemoryTool(options?: {
  userStore?: UserMemoryPersistence | null;
  /** Temporary chats block user-scope memory. */
  userDisabled?: boolean;
}) {
  const userStore = options?.userStore ?? null;
  const userDisabled = Boolean(options?.userDisabled);

  return defineTool({
    name: 'memory',
    label: 'Memory',
    description:
      'Durable notes. scope=project (default): per-repo scratchpad in .pi-desktop/agent/memory.json. scope=user: cross-project saved memories (also listed in Settings → Memory). retain / recall / forget. Do not store secrets.',
    promptSnippet: 'memory — project or user saved notes (retain/recall/forget)',
    promptGuidelines: [
      'Use scope="user" when the user asks you to remember something about them across projects (preferences, name, constraints).',
      'Use scope="project" (default) for repo conventions, decisions, and hard-won lessons.',
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
      const scope = params.scope === 'user' ? 'user' : 'project';

      if (scope === 'user') {
        if (userDisabled) {
          return {
            content: [
              {
                type: 'text',
                text: 'User memory is disabled in Temporary chat. Start a normal task to save memories.',
              },
            ],
            details: { notes: [] },
          };
        }
        if (!userStore) {
          return {
            content: [{ type: 'text', text: 'User memory store is not available.' }],
            details: { notes: [] },
          };
        }

        if (params.action === 'recall') {
          const all = await userStore.list();
          const filter = (params.value ?? params.key ?? '').trim().toLowerCase();
          const matched = filter
            ? all.filter((m) => m.content.toLowerCase().includes(filter) || m.id === filter)
            : all;
          const text = matched.length
            ? matched.map((m) => `- ${m.content}`).join('\n')
            : 'No matching saved memories.';
          return {
            content: [{ type: 'text', text }],
            details: {
              notes: matched.map((m) => ({
                key: m.id,
                value: m.content,
                updatedAt: m.updatedAt,
              })),
            },
          };
        }

        if (params.action === 'retain') {
          const content = (params.value ?? params.key ?? '').trim();
          if (!content) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Nothing to retain — provide value (the fact to remember).',
                },
              ],
              details: { notes: [] },
            };
          }
          try {
            const saved = await userStore.add(content, 'agent');
            return {
              content: [{ type: 'text', text: `Saved memory: ${saved.content}` }],
              details: {
                notes: [{ key: saved.id, value: saved.content, updatedAt: saved.updatedAt }],
              },
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Memory write failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              details: { notes: [] },
            };
          }
        }

        if (params.action === 'forget') {
          const key = (params.key ?? params.value ?? '').trim();
          if (!key) {
            return {
              content: [{ type: 'text', text: 'Provide key or value to forget.' }],
              details: { notes: [] },
            };
          }
          const ok = await userStore.forget(key);
          return {
            content: [
              {
                type: 'text',
                text: ok ? `Forgot memory matching "${key}".` : `No saved memory matched "${key}".`,
              },
            ],
            details: { notes: [] },
          };
        }

        return {
          content: [{ type: 'text', text: 'Unknown memory action.' }],
          details: { notes: [] },
        };
      }

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
              {
                type: 'text',
                text: `Memory write failed: ${error instanceof Error ? error.message : String(error)}`,
              },
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
              {
                type: 'text',
                text: `Memory write failed: ${error instanceof Error ? error.message : String(error)}`,
              },
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
        return {
          content: [{ type: 'text', text: 'Skill name must not be empty.' }],
          details: { path: '' },
        };
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
          {
            type: 'text',
            text: `Skill written to .pi/skills/${name}/SKILL.md (command /skill:${name}).`,
          },
        ],
        details: { path: file },
      };
    },
  });
}
