import { describe, expect, it } from 'vitest';

import type { DesktopAgentEvent, TodoItem } from '@pi-desktop/protocol';

import {
  applyTodoChange,
  CollaborationService,
  formatTodoList,
  type TodoPersistence,
} from './collab-tools.js';

const SESSION = 'session-1';

function service(options: {
  persistence?: TodoPersistence | null;
  events?: DesktopAgentEvent[];
} = {}) {
  const events: DesktopAgentEvent[] = [];
  const svc = new CollaborationService({
    emit: (event) => events.push(event),
    scope: () => ({ projectId: 'p1', sessionId: SESSION }),
    persistence: options.persistence ?? null,
  });
  return { svc, events: options.events ?? events };
}

describe('applyTodoChange', () => {
  it('creates items with generated ids and default pending status', () => {
    const next = applyTodoChange([], {
      action: 'create',
      items: [{ text: 'First' }, { text: 'Second' }],
    });
    expect(next).toHaveLength(2);
    expect(next[0]!.text).toBe('First');
    expect(next[0]!.status).toBe('pending');
    expect(next[0]!.id).toBeTruthy();
  });

  it('skips empty text and duplicate ids on create', () => {
    const first = applyTodoChange([], { action: 'create', items: [{ id: 'a', text: 'A' }] });
    const next = applyTodoChange(first, {
      action: 'create',
      items: [{ id: 'a', text: 'A again' }, { text: '   ' }],
    });
    expect(next).toHaveLength(1);
  });

  it('updates status and text by id', () => {
    const items: TodoItem[] = [
      { id: 'a', text: 'A', status: 'pending' },
      { id: 'b', text: 'B', status: 'pending' },
    ];
    const next = applyTodoChange(items, {
      action: 'update',
      id: 'a',
      status: 'in_progress',
      text: 'A updated',
    });
    expect(next[0]).toMatchObject({ id: 'a', text: 'A updated', status: 'in_progress' });
    expect(next[1]).toMatchObject({ id: 'b', text: 'B' });
  });

  it('clears the whole list', () => {
    const items: TodoItem[] = [{ id: 'a', text: 'A', status: 'completed' }];
    expect(applyTodoChange(items, { action: 'clear' })).toEqual([]);
  });
});

describe('formatTodoList', () => {
  it('renders statuses as markers with a done count', () => {
    const text = formatTodoList([
      { id: 'a', text: 'One', status: 'completed' },
      { id: 'b', text: 'Two', status: 'in_progress' },
      { id: 'c', text: 'Three', status: 'pending' },
    ]);
    expect(text).toContain('(1/3 done)');
    expect(text).toContain('[x] 1. One');
    expect(text).toContain('[>] 2. Two');
    expect(text).toContain('[ ] 3. Three');
  });

  it('renders an empty message for an empty list', () => {
    expect(formatTodoList([])).toBe('Todo list is empty.');
  });
});

describe('CollaborationService todos', () => {
  it('applies changes and emits todo.updated with the full list', async () => {
    const { svc, events } = service();
    const created = await svc.applyTodoChange(SESSION, {
      action: 'create',
      items: [{ text: 'Step 1' }],
    });
    await svc.applyTodoChange(SESSION, {
      action: 'update',
      id: created[0]!.id,
      status: 'completed',
    });

    const todoEvents = events.filter((e) => e.type === 'todo.updated');
    expect(todoEvents).toHaveLength(2);
    const last = todoEvents[1] as Extract<DesktopAgentEvent, { type: 'todo.updated' }>;
    expect(last.items[0]?.status).toBe('completed');
  });

  it('loads persisted todos lazily and persists after a change', async () => {
    let stored: TodoItem[] = [{ id: 't1', text: 'Persisted', status: 'pending' }];
    const { svc, events } = service({
      persistence: {
        load: async () => stored,
        save: async (_sessionId, items) => {
          stored = items;
        },
      },
    });
    expect(await svc.getTodos(SESSION)).toEqual(stored);
    await svc.applyTodoChange(SESSION, { action: 'create', items: [{ text: 'New' }] });
    expect(stored).toHaveLength(2);
    expect(events.some((e) => e.type === 'todo.updated')).toBe(true);
  });
});

describe('CollaborationService asks', () => {
  it('blocks until answerAsk resolves with the answer', async () => {
    const { svc, events } = service();
    const promise = svc.registerAsk(SESSION, {
      question: 'Which?',
      options: [{ label: 'SQLite' }, { label: 'Postgres' }],
    });

    const pending = events.find((e) => e.type === 'ask.pending');
    expect(pending).toBeDefined();
    const askId = (pending as Extract<DesktopAgentEvent, { type: 'ask.pending' }>).askId;

    expect(svc.answerAsk(askId, 'SQLite')).toBe(true);
    const result = await promise;
    expect(result).toEqual({ answer: 'SQLite', optionId: 'SQLite' });

    const resolved = events.find((e) => e.type === 'ask.resolved');
    expect(
      (resolved as Extract<DesktopAgentEvent, { type: 'ask.resolved' }> | undefined)?.answer,
    ).toBe('SQLite');
  });

  it('rejects on abort signal', async () => {
    const { svc } = service();
    const controller = new AbortController();
    const promise = svc.registerAsk(SESSION, { question: 'Q' }, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('returns false for an unknown askId', async () => {
    const { svc } = service();
    expect(svc.answerAsk('does-not-exist', 'x')).toBe(false);
  });

  it('rejects all asks on dispose', async () => {
    const { svc } = service();
    const promise = svc.registerAsk(SESSION, { question: 'Q' });
    svc.rejectAllAsks('Session closed.');
    await expect(promise).rejects.toThrow('Session closed.');
  });
});
