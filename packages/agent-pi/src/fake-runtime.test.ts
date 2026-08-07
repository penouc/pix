import { describe, expect, it } from 'vitest';

import type { DesktopAgentEvent } from '@pi-desktop/protocol';

import { FakeAgentRuntime } from './fake-runtime.js';

describe('FakeAgentRuntime', () => {
  it('streams a full fake run', async () => {
    const runtime = new FakeAgentRuntime();
    const events: DesktopAgentEvent[] = [];
    runtime.subscribe((e) => events.push(e));

    const session = await runtime.createSession({
      projectId: 'proj-1',
      projectPath: '/tmp/demo',
      title: 'Test',
    });

    const ref = await runtime.sendMessage(session.id, { text: 'hello agent' });
    expect(ref.sessionId).toBe(session.id);

    await waitFor(() => events.some((e) => e.type === 'run.completed'), 3000);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('run.started');
    expect(types).toContain('tool.requested');
    expect(types).toContain('message.delta');
    expect(types).toContain('run.completed');

    for (const event of events) {
      expect(event.projectId).toBe('proj-1');
      expect(event.sessionId).toBe(session.id);
      if (
        event.type === 'session.updated' ||
        event.type === 'context.updated' ||
        event.type === 'compaction.started' ||
        event.type === 'compaction.completed'
      ) {
        continue;
      }
      expect(event.runId).toBe(ref.runId);
      expect(event.sequence).toBeGreaterThan(0);
    }

    await runtime.dispose();
  });

  it('compacts context and emits session-scoped events', async () => {
    const runtime = new FakeAgentRuntime();
    const events: DesktopAgentEvent[] = [];
    runtime.subscribe((e) => events.push(e));

    const session = await runtime.createSession({
      projectId: 'proj-1',
      projectPath: '/tmp/demo',
    });
    const before = await runtime.getContextUsage(session.id);
    expect(before?.tokens).toBeGreaterThan(0);

    const result = await runtime.compact(session.id);
    expect(result.tokensBefore).toBe(before?.tokens);
    expect(result.estimatedTokensAfter).toBeLessThan(result.tokensBefore);

    expect(events.some((e) => e.type === 'compaction.started')).toBe(true);
    expect(events.some((e) => e.type === 'compaction.completed')).toBe(true);
    expect(events.some((e) => e.type === 'context.updated')).toBe(true);

    const after = await runtime.getContextUsage(session.id);
    expect(after?.tokens).toBe(result.estimatedTokensAfter);

    await runtime.dispose();
  });

  it('cancels an in-flight run', async () => {
    const runtime = new FakeAgentRuntime();
    const events: DesktopAgentEvent[] = [];
    runtime.subscribe((e) => events.push(e));

    const session = await runtime.createSession({
      projectId: 'proj-1',
      projectPath: '/tmp/demo',
    });
    const ref = await runtime.sendMessage(session.id, { text: 'long task' });
    await runtime.abort(ref.runId);

    await waitFor(() => events.some((e) => e.type === 'run.cancelled'), 1000);
    expect(events.some((e) => e.type === 'run.completed')).toBe(false);
    await runtime.dispose();
  });

  it('lists fork points and rewinds the transcript at one', async () => {
    const runtime = new FakeAgentRuntime();

    const session = await runtime.createSession({
      projectId: 'proj-1',
      projectPath: '/tmp/demo',
    });
    await runtime.sendMessage(session.id, { text: 'first idea' });
    await runtime.sendMessage(session.id, { text: 'second idea' });
    await runtime.sendMessage(session.id, { text: 'third idea' });

    const points = await runtime.forkPoints(session.id);
    expect(points.map((p) => p.text)).toEqual(['first idea', 'second idea', 'third idea']);

    // Fork at the second message: later messages are discarded and the editor
    // text comes back for re-sending.
    const result = await runtime.forkSession(session.id, points[1]!.entryId);
    expect(result.editorText).toBe('second idea');
    expect((await runtime.forkPoints(session.id)).map((p) => p.text)).toEqual([
      'first idea',
      'second idea',
    ]);

    await expect(runtime.forkSession(session.id, 'nope')).rejects.toThrow();
    await runtime.dispose();
  });
});

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor timeout'));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}
