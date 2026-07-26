import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalDecision, Automation, AutomationTrigger } from '@pi-desktop/protocol';

import { AutomationScheduler, type AutomationRunHandle } from './automation-scheduler.js';
import type { AutomationStore } from './automation-store.js';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'Nightly',
    projectId: 'p1',
    prompt: 'run the tests',
    trigger: { kind: 'manual' } as AutomationTrigger,
    approvalMode: 'unattended',
    enabled: true,
    createdAt: 0,
    ...overrides,
  };
}

/** Minimal in-memory stand-in for the JSON-backed store. */
function fakeStore(items: Automation[]) {
  const state = [...items];
  return {
    list: vi.fn(async () => state),
    get: vi.fn(async (id: string) => state.find((entry) => entry.id === id)),
    recordRun: vi.fn(async (id: string, summary: string) => {
      const found = state.find((entry) => entry.id === id);
      if (found) {
        found.lastRunAt = Date.now();
        found.lastRunSummary = summary;
      }
    }),
  } as unknown as AutomationStore & { recordRun: ReturnType<typeof vi.fn> };
}

function harness(items: Automation[], startRun?: AutomationScheduler['deps']['startRun']) {
  const store = fakeStore(items);
  const decisions: Array<{ requestId: string; decision: ApprovalDecision }> = [];
  const audits: unknown[] = [];
  const scheduler = new AutomationScheduler(store, {
    startRun:
      startRun ??
      (async (_automation, claimSession): Promise<AutomationRunHandle> => {
        claimSession('s1');
        return { sessionId: 's1', runId: 'r1' };
      }),
    decide: async (requestId, decision) => {
      decisions.push({ requestId, decision });
    },
    recordAudit: (entry) => audits.push(entry),
    log: () => {},
  });
  return { scheduler, store, decisions, audits };
}

describe('automation approval decisions', () => {
  it('auto-approves for an unattended run', async () => {
    const { scheduler, decisions, audits } = harness([automation()]);
    await scheduler.runNow('a1');

    const handled = await scheduler.handleApproval({
      runId: 'r1',
      sessionId: 's1',
      requestId: 'req-1',
      summary: 'bash pnpm test',
    });

    expect(handled).toBe(true);
    expect(decisions).toEqual([{ requestId: 'req-1', decision: 'allow-once' }]);
    expect(audits).toHaveLength(1);
  });

  it('auto-denies for a read-only run', async () => {
    const { scheduler, decisions } = harness([automation({ approvalMode: 'read-only' })]);
    await scheduler.runNow('a1');

    const handled = await scheduler.handleApproval({
      runId: 'r1',
      sessionId: 's1',
      requestId: 'req-1',
      summary: 'edit src/index.ts',
    });

    expect(handled).toBe(true);
    expect(decisions).toEqual([{ requestId: 'req-1', decision: 'deny' }]);
  });

  it('leaves the decision to a person in ask mode', async () => {
    const { scheduler, decisions } = harness([automation({ approvalMode: 'ask' })]);
    await scheduler.runNow('a1');

    const handled = await scheduler.handleApproval({
      runId: 'r1',
      sessionId: 's1',
      requestId: 'req-1',
      summary: 'bash pnpm test',
    });

    expect(handled).toBe(false);
    expect(decisions).toEqual([]);
  });

  it('never decides for a run it did not start', async () => {
    const { scheduler, decisions } = harness([automation()]);
    const handled = await scheduler.handleApproval({
      runId: 'someone-elses-run',
      sessionId: 'someone-elses-session',
      requestId: 'req-1',
      summary: 'rm -rf build',
    });
    expect(handled).toBe(false);
    expect(decisions).toEqual([]);
  });

  it('answers an approval raised before the runId is known', async () => {
    // The first turn can raise an approval before sendMessage resolves.
    let claimed: ((sessionId: string) => void) | null = null;
    const { scheduler, decisions } = harness([automation()], async (_a, claimSession) => {
      claimed = claimSession;
      claimSession('s9');
      // Approval arrives while the prompt is still in flight.
      await scheduler.handleApproval({
        runId: 'not-yet-known',
        sessionId: 's9',
        requestId: 'early',
        summary: 'edit file',
      });
      return { sessionId: 's9', runId: 'r9' };
    });

    await scheduler.runNow('a1');
    expect(claimed).not.toBeNull();
    expect(decisions).toEqual([{ requestId: 'early', decision: 'allow-once' }]);
  });

  it('drops the session claim when the run fails to start', async () => {
    // Regression: a stale claim auto-decided approvals for whatever the *user*
    // later ran in that session.
    const { scheduler, decisions } = harness([automation()], async (_a, claimSession) => {
      claimSession('s-leaky');
      throw new Error('provider unavailable');
    });

    await expect(scheduler.runNow('a1')).rejects.toThrow('provider unavailable');

    const handled = await scheduler.handleApproval({
      runId: 'user-run',
      sessionId: 's-leaky',
      requestId: 'req-user',
      summary: 'edit src/secret.ts',
    });
    expect(handled).toBe(false);
    expect(decisions).toEqual([]);
  });
});

describe('automation run lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to start the same automation twice concurrently', async () => {
    const { scheduler } = harness([automation()]);
    await scheduler.runNow('a1');
    await expect(scheduler.runNow('a1')).rejects.toThrow('already running');
  });

  it('records the outcome once the run finishes and frees the automation', async () => {
    const { scheduler, store } = harness([automation()]);
    await scheduler.runNow('a1');

    await scheduler.handleRunFinished({ runId: 'r1', projectId: 'p1', outcome: 'completed' });

    const summaries = store.recordRun.mock.calls.map((call) => call[1] as string);
    expect(summaries.at(-1)).toContain('completed');
    // Freed, so it can run again.
    await expect(scheduler.runNow('a1')).resolves.toMatchObject({ sessionId: 's1' });
  });

  it('fires an event automation after a user run, but not after its own', async () => {
    const event = automation({
      id: 'ev',
      trigger: { kind: 'event', on: 'run-completed' },
      approvalMode: 'read-only',
    });
    const started: string[] = [];
    const { scheduler } = harness([event], async (a, claimSession) => {
      started.push(a.id);
      claimSession(`s-${a.id}`);
      return { sessionId: `s-${a.id}`, runId: `r-${a.id}` };
    });

    // A run the user started finishes → the event automation fires.
    await scheduler.handleRunFinished({
      runId: 'user-run',
      projectId: 'p1',
      outcome: 'completed',
    });
    expect(started).toEqual(['ev']);

    // Its own run finishing must not retrigger it — otherwise infinite loop.
    await scheduler.handleRunFinished({ runId: 'r-ev', projectId: 'p1', outcome: 'completed' });
    expect(started).toEqual(['ev']);
  });

  it('ignores event automations belonging to another project', async () => {
    const event = automation({ id: 'ev', trigger: { kind: 'event', on: 'run-completed' } });
    const started: string[] = [];
    const { scheduler } = harness([event], async (a, claimSession) => {
      started.push(a.id);
      claimSession('s');
      return { sessionId: 's', runId: 'r' };
    });
    await scheduler.handleRunFinished({ runId: 'x', projectId: 'other', outcome: 'completed' });
    expect(started).toEqual([]);
  });
});
