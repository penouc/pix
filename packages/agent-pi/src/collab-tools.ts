import { randomUUID } from 'node:crypto';

import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import type { AskOption, DesktopAgentEvent, TodoItem, TodoStatus } from '@pi-desktop/protocol';
import { Type, type Static } from 'typebox';

/*
 * #11 / #12 — self-built collaboration tools.
 *
 * `todo`  — a per-session step checklist the agent owns. Creating items, moving
 *           them between pending/in_progress/completed, and clearing the list
 *           are all pure in-session state; the sidebar renders the same list
 *           the model sees, and every change emits a `todo.updated` event.
 * `ask`   — a structured question that blocks the run until the user answers.
 *           The agent can offer options (rendered as buttons) and/or free text;
 *           the chosen answer becomes this tool call's result, so the model
 *           continues with the user's actual decision instead of guessing.
 *
 * Both tools are classified `safe` by the permission pipeline (see
 * packages/security/src/risk-classifier.ts): no filesystem, no shell, no
 * network — so they never enter the approval queue.
 */

export const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type TodoStatusKey = (typeof TODO_STATUSES)[number];

const todoStatusSchema = StringEnum(TODO_STATUSES, {
  description: 'pending = waiting, in_progress = being worked on, completed = done',
});

const todoItemInputSchema = Type.Object({
  /** Stable id; omit on create and one is generated. */
  id: Type.Optional(Type.String({ description: 'Existing todo id' })),
  text: Type.String({ description: 'Todo description' }),
  status: Type.Optional(todoStatusSchema),
});

const todoToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('create', {
      description: 'Add one or more checklist items (duplicate-safe by id)',
    }),
    Type.Literal('update', {
      description: 'Update one item: mark status or rewrite its text',
    }),
    Type.Literal('clear', { description: 'Empty the whole checklist' }),
  ]),
  /** create: items to add. */
  items: Type.Optional(
    Type.Array(todoItemInputSchema, {
      description: 'Checklist items to create',
    }),
  ),
  /** update: the item id to change. */
  id: Type.Optional(Type.String({ description: 'Todo id to update' })),
  /** update: new status (optional). */
  status: Type.Optional(todoStatusSchema),
  /** update: new text (optional). */
  text: Type.Optional(Type.String({ description: 'Replacement text' })),
});
type TodoToolParams = Static<typeof todoToolSchema>;

const askToolSchema = Type.Object({
  question: Type.String({
    description:
      'The question to ask the user. Be specific and offer options when a choice is expected.',
  }),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Optional(Type.String({ description: 'Stable id; omit to derive from label' })),
        label: Type.String({ description: 'Option text shown to the user' }),
      }),
      { description: 'Offered answers. Omit for pure free-text.' },
    ),
  ),
  allowFreeText: Type.Optional(
    Type.Boolean({
      description:
        'Whether the user may type their own answer instead of picking an option. Default true.',
    }),
  ),
});
type AskToolParams = Static<typeof askToolSchema>;

export interface TodoPersistence {
  /** Load the stored checklist for a session (empty when none yet). */
  load(sessionId: string): Promise<TodoItem[]>;
  /** Persist the checklist after every change. */
  save(sessionId: string, items: TodoItem[]): Promise<void>;
}

export type TodoChange =
  | { action: 'create'; items: Array<{ id?: string; text: string; status?: TodoStatus }> }
  | { action: 'update'; id: string; status?: TodoStatus; text?: string }
  | { action: 'clear' };

/** Pure reducer: apply a tool change to a checklist. Exported for tests. */
export function applyTodoChange(items: TodoItem[], change: TodoChange): TodoItem[] {
  switch (change.action) {
    case 'create': {
      const next = [...items];
      for (const incoming of change.items) {
        const text = incoming.text?.trim();
        if (!text) continue;
        if (incoming.id && next.some((item) => item.id === incoming.id)) continue;
        next.push({
          id: incoming.id ?? randomUUID(),
          text: text.slice(0, 2000),
          status: incoming.status ?? 'pending',
        });
      }
      return next;
    }
    case 'update': {
      if (!change.id) return items;
      return items.map((item) =>
        item.id === change.id
          ? {
              ...item,
              ...(change.text?.trim() ? { text: change.text.trim().slice(0, 2000) } : {}),
              ...(change.status ? { status: change.status } : {}),
            }
          : item,
      );
    }
    case 'clear':
      return [];
    default:
      return items;
  }
}

/** Render the checklist as the text the model reads back. Exported for tests. */
export function formatTodoList(items: TodoItem[]): string {
  if (items.length === 0) return 'Todo list is empty.';
  const lines = items.map((item, index) => {
    const marker = item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]';
    return `${marker} ${index + 1}. ${item.text}`;
  });
  const done = items.filter((item) => item.status === 'completed').length;
  return `Todo list (${done}/${items.length} done):\n${lines.join('\n')}`;
}

interface PendingAsk {
  askId: string;
  sessionId: string;
  question: string;
  options: AskOption[];
  allowFreeText: boolean;
  /** Resolves with the answer once the user replies via `answerAsk`. */
  resolve: (answer: string, optionId?: string) => void;
  reject: (error: Error) => void;
}

export interface CollaborationServiceOptions {
  /** Emit a desktop protocol event (`todo.updated` / `ask.pending` / `ask.resolved`). */
  emit: (event: DesktopAgentEvent) => void;
  /** Where to send the events: session-scoped identity (no runId). */
  scope: () => { projectId: string; sessionId: string } | null;
  /** Optional durable store; without it the checklist lives for the session only. */
  persistence?: TodoPersistence | null;
}

/**
 * One instance per Pi session (created alongside the extension that registers
 * the tools). Holds that session's checklist and its in-flight asks, so the
 * desktop runtime can answer an ask by askId and can report the current list.
 */
export class CollaborationService {
  private readonly todos = new Map<string, TodoItem[]>();
  private readonly asks = new Map<string, PendingAsk>();
  private readonly persistence: TodoPersistence | null;

  constructor(private readonly options: CollaborationServiceOptions) {
    this.persistence = options.persistence ?? null;
  }

  /** The stored checklist, loading persisted state once. */
  async getTodos(sessionId: string): Promise<TodoItem[]> {
    const cached = this.todos.get(sessionId);
    if (cached) return cached;
    let loaded: TodoItem[] = [];
    try {
      loaded = this.persistence ? await this.persistence.load(sessionId) : [];
    } catch (error) {
      console.warn('[CollaborationService] loading todos failed', error);
    }
    this.todos.set(sessionId, loaded);
    return loaded;
  }

  async applyTodoChange(sessionId: string, change: TodoChange): Promise<TodoItem[]> {
    const current = await this.getTodos(sessionId);
    const next = applyTodoChange(current, change);
    this.todos.set(sessionId, next);
    const scope = this.options.scope();
    if (scope) {
      this.options.emit({
        type: 'todo.updated',
        ...scope,
        timestamp: Date.now(),
        items: next,
      });
    }
    if (this.persistence) {
      try {
        await this.persistence.save(sessionId, next);
      } catch (error) {
        console.warn('[CollaborationService] persisting todos failed', error);
      }
    }
    return next;
  }

  /**
   * Register a blocked ask and return a promise for the user's answer. Rejects
   * when the abort signal fires or when the session is disposed.
   */
  registerAsk(
    sessionId: string,
    params: {
      question: string;
      options?: Array<{ id?: string; label: string }>;
      allowFreeText?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<{ answer: string; optionId?: string }> {
    return new Promise((resolve, reject) => {
      const askId = randomUUID();
      const options: AskOption[] = (params.options ?? []).map((option) =>
        option.id ? { id: option.id, label: option.label } : { id: option.label, label: option.label },
      );
      const pending: PendingAsk = {
        askId,
        sessionId,
        question: params.question,
        options,
        allowFreeText: params.allowFreeText ?? true,
        resolve: (answer, optionId) => {
          this.asks.delete(askId);
          resolve({ answer, ...(optionId ? { optionId } : {}) });
        },
        reject: (error) => {
          this.asks.delete(askId);
          reject(error);
        },
      };
      this.asks.set(askId, pending);
      if (signal?.aborted) {
        pending.reject(new Error('Ask cancelled before it could be shown.'));
        return;
      }
      signal?.addEventListener(
        'abort',
        () => pending.reject(new Error('Ask cancelled (run aborted).')),
        { once: true },
      );
      const scope = this.options.scope();
      if (scope) {
        this.options.emit({
          type: 'ask.pending',
          ...scope,
          timestamp: Date.now(),
          askId,
          question: params.question,
          ...(options.length ? { options } : {}),
          ...(params.allowFreeText === false ? { allowFreeText: false } : {}),
        });
      } else {
        // No active session scope: nothing can answer this ask.
        pending.reject(new Error('Ask failed: no active session.'));
      }
    });
  }

  /** Resolve a pending ask. Returns false when the ask id is unknown. */
  answerAsk(askId: string, answer: string): boolean {
    const pending = this.asks.get(askId);
    if (!pending) return false;
    const trimmed = answer.trim();
    if (!trimmed) {
      pending.reject(new Error('Answer cannot be empty.'));
      return true;
    }
    const matched = pending.options.find(
      (option) => option.id === trimmed || option.label === trimmed,
    );
    const scope = this.options.scope();
    if (scope) {
      this.options.emit({
        type: 'ask.resolved',
        ...scope,
        timestamp: Date.now(),
        askId,
        ...(matched ? { optionId: matched.id } : {}),
        answer: trimmed.slice(0, 10_000),
      });
    }
    pending.resolve(trimmed, matched?.id);
    return true;
  }

  /** Number of asks still waiting for an answer (for dispose cleanup). */
  pendingAskCount(): number {
    return this.asks.size;
  }

  /** Reject every pending ask (used on session dispose / runtime shutdown). */
  rejectAllAsks(reason: string): void {
    for (const pending of this.asks.values()) {
      pending.reject(new Error(reason));
    }
    this.asks.clear();
  }
}

export function createTodoTool(service: CollaborationService, sessionId: string) {
  return defineTool({
    name: 'todo',
    label: 'Todo checklist',
    description:
      'Maintain a step-by-step todo checklist for the current task. Create items up front, mark items in_progress while working on them, mark them completed as each finishes, and clear the list once the task is fully done. The checklist is visible to the user in the sidebar, so keep it current and concise.',
    promptSnippet: 'todo — maintain the current task’s step checklist',
    promptGuidelines: [
      'Use todo when a task spans multiple distinct steps: create the full checklist first, then update statuses as you go.',
      'Keep todo items short and action-oriented; update one item at a time by its id.',
    ],
    parameters: todoToolSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: TodoToolParams,
    ): Promise<AgentToolResult<{ items: TodoItem[] }>> {
      let change: TodoChange;
      switch (params.action) {
        case 'create':
          change = { action: 'create', items: params.items ?? [] };
          break;
        case 'update':
          change = { action: 'update', id: params.id ?? '', status: params.status, text: params.text };
          break;
        case 'clear':
          change = { action: 'clear' };
          break;
        default:
          change = { action: 'clear' };
      }
      const items = await service.applyTodoChange(sessionId, change);
      return {
        content: [{ type: 'text', text: formatTodoList(items) }],
        details: { items },
      };
    },
  });
}

export function createAskTool(service: CollaborationService, sessionId: string) {
  return defineTool({
    name: 'ask',
    label: 'Ask the user',
    description:
      'Ask the user a structured question and wait for their answer. Use when a decision genuinely belongs to the user — a choice of approach, an approval gate, a preference, or missing information that changes the work. Offer options whenever the choice is enumerable; the user can pick one or type their own answer. The run is blocked until they respond, so ask sparingly and only when the answer is actually needed.',
    promptSnippet: 'ask — ask the user a structured question and wait for the answer',
    promptGuidelines: [
      'Use ask only when the user’s input is genuinely required; prefer sensible defaults for anything the user would not care about.',
      'When offering options, label them as the user will read them ("Use SQLite", not "option_a").',
    ],
    parameters: askToolSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: AskToolParams,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ answer: string; optionId?: string }>> {
      const { answer, optionId } = await service.registerAsk(
        sessionId,
        {
          question: params.question,
          options: params.options,
          allowFreeText: params.allowFreeText,
        },
        signal,
      );
      return {
        content: [{ type: 'text', text: `User answered: ${answer}` }],
        details: { answer, ...(optionId ? { optionId } : {}) },
      };
    },
  });
}
