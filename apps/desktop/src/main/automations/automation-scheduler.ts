import type { ApprovalDecision, Automation, AutomationApprovalMode } from '@pi-desktop/protocol';

import { isDue, type AutomationStore } from './automation-store.js';

const TICK_MS = 30_000;

export interface AutomationRunHandle {
  sessionId: string;
  runId?: string;
}

/**
 * Fires due automations, and decides approvals for the runs it started.
 *
 * SAFETY — read this together with docs/decisions/0003-unattended-automations.md.
 * `unattended` mode auto-approves the approval requests raised by its own runs.
 * It does NOT weaken the policy engine: a `deny` from the engine (protected
 * path, workspace escape, git push, other external side effects) never becomes
 * an approval request in the first place, so it stays denied here too. Every
 * automatic decision is written to the audit log with the automation id.
 */
export class AutomationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** runId → the automation that started it, so approvals can be answered. */
  private readonly runOwners = new Map<
    string,
    { automationId: string; mode: AutomationApprovalMode }
  >();
  /**
   * sessionId → owner, claimed *before* the prompt is sent. A run can raise an
   * approval before `sendMessage` resolves, so keying on runId alone races and
   * the request would leak to the user instead of being auto-decided.
   */
  private readonly sessionOwners = new Map<
    string,
    { automationId: string; mode: AutomationApprovalMode }
  >();
  /** runId → automationId, kept so event triggers cannot recurse into themselves. */
  private readonly runOrigins = new Map<string, string>();
  private running = new Set<string>();

  constructor(
    private readonly store: AutomationStore,
    private readonly deps: {
      /**
       * Creates the session and sends the prompt. Must call `claimSession` with
       * the new session id *before* sending, so an approval raised during the
       * first turn is still attributed to this automation.
       */
      startRun: (
        automation: Automation,
        claimSession: (sessionId: string) => void,
      ) => Promise<AutomationRunHandle>;
      /** Answer an approval the started run raised. */
      decide: (requestId: string, decision: ApprovalDecision) => Promise<void>;
      recordAudit: (entry: {
        automationId: string;
        mode: AutomationApprovalMode;
        decision: ApprovalDecision;
        summary: string;
      }) => void;
      log: (message: string, meta?: Record<string, unknown>) => void;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Deliberately not firing on boot: a crash loop must not re-trigger writes.
    this.deps.log('[automations] scheduler started', { tickMs: TICK_MS });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Claim a session before its first prompt, so no approval can slip through. */
  claimSession(sessionId: string, automationId: string, mode: AutomationApprovalMode): void {
    this.sessionOwners.set(sessionId, { automationId, mode });
  }

  /** Associate a run with its automation once the runId is known. */
  claimRun(runId: string, automationId: string, mode: AutomationApprovalMode): void {
    this.runOwners.set(runId, { automationId, mode });
  }

  releaseSession(sessionId: string): void {
    this.sessionOwners.delete(sessionId);
  }

  /**
   * Called for every terminal run event. Records the outcome against the
   * automation that started it, frees its claims, and fires any `run-completed`
   * event automations — but never from a run an automation itself started, or
   * two event automations would trigger each other forever.
   */
  async handleRunFinished(input: {
    runId: string;
    projectId: string;
    outcome: 'completed' | 'failed' | 'cancelled';
  }): Promise<void> {
    const owner = this.runOwners.get(input.runId);
    const startedByAutomation = this.runOrigins.has(input.runId);

    this.runOwners.delete(input.runId);
    this.runOrigins.delete(input.runId);

    if (owner) {
      this.running.delete(owner.automationId);
      const existing = await this.store.get(owner.automationId);
      const prefix = existing?.lastRunSummary?.replace(/ · (running|[a-z]+)$/, '') ?? 'Run';
      await this.store.recordRun(owner.automationId, `${prefix} · ${input.outcome}`);
      this.deps.log('[automations] run finished', {
        automationId: owner.automationId,
        outcome: input.outcome,
      });
    }

    if (startedByAutomation) return;
    await this.fireEventTriggers(input.projectId);
  }

  private async fireEventTriggers(projectId: string): Promise<void> {
    let candidates: Automation[];
    try {
      candidates = (await this.store.list()).filter(
        (automation) =>
          automation.enabled &&
          automation.projectId === projectId &&
          automation.trigger.kind === 'event' &&
          automation.trigger.on === 'run-completed' &&
          !this.running.has(automation.id),
      );
    } catch (error) {
      this.deps.log('[automations] could not read event triggers', { error: String(error) });
      return;
    }
    for (const automation of candidates) {
      await this.fire(automation, 'event').catch((error) =>
        this.deps.log('[automations] event run failed', {
          automationId: automation.id,
          error: String(error),
        }),
      );
    }
  }

  /**
   * Called by Main for every approval.requested event. Returns true when the
   * scheduler answered it, so Main knows not to surface it to the user.
   */
  async handleApproval(input: {
    runId: string;
    sessionId: string;
    requestId: string;
    summary: string;
  }): Promise<boolean> {
    const owner = this.runOwners.get(input.runId) ?? this.sessionOwners.get(input.sessionId);
    if (!owner) return false;

    let decision: ApprovalDecision | null = null;
    if (owner.mode === 'unattended') decision = 'allow-once';
    if (owner.mode === 'read-only') decision = 'deny';
    // 'ask' and 'auto-reads' leave the request for a human — an unattended run
    // in those modes stalls, which the Automations screen states plainly.
    if (!decision) return false;

    this.deps.recordAudit({
      automationId: owner.automationId,
      mode: owner.mode,
      decision,
      summary: input.summary,
    });
    this.deps.log('[automations] auto-decided approval', {
      automationId: owner.automationId,
      mode: owner.mode,
      decision,
    });
    await this.deps.decide(input.requestId, decision);
    return true;
  }

  async runNow(id: string): Promise<AutomationRunHandle> {
    const automation = await this.store.get(id);
    if (!automation) throw new Error(`Automation ${id} not found`);
    return this.fire(automation, 'manual');
  }

  private async tick(): Promise<void> {
    let due: Automation[];
    try {
      due = (await this.store.list()).filter((automation) => isDue(automation));
    } catch (error) {
      this.deps.log('[automations] tick failed to read store', { error: String(error) });
      return;
    }
    for (const automation of due) {
      if (this.running.has(automation.id)) continue;
      await this.fire(automation, 'schedule').catch((error) => {
        this.deps.log('[automations] run failed', {
          automationId: automation.id,
          error: String(error),
        });
      });
    }
  }

  private async fire(
    automation: Automation,
    origin: 'manual' | 'schedule' | 'event',
  ): Promise<AutomationRunHandle> {
    if (this.running.has(automation.id)) {
      throw new Error(`Automation ${automation.id} is already running`);
    }
    // Held until the run *finishes*, not until it starts: releasing on start let
    // a second Run now (or the next tick) launch a duplicate run.
    this.running.add(automation.id);

    let claimedSession: string | null = null;
    try {
      const handle = await this.deps.startRun(automation, (sessionId) => {
        claimedSession = sessionId;
        this.claimSession(sessionId, automation.id, automation.approvalMode);
      });
      if (handle.runId) {
        this.claimRun(handle.runId, automation.id, automation.approvalMode);
        this.runOrigins.set(handle.runId, automation.id);
      }
      // The runId is authoritative from here.
      this.releaseSession(handle.sessionId);
      claimedSession = null;
      await this.store.recordRun(
        automation.id,
        `${ORIGIN_LABEL[origin]} · session ${handle.sessionId.slice(0, 8)} · running`,
      );
      this.deps.log('[automations] started run', {
        automationId: automation.id,
        origin,
        mode: automation.approvalMode,
        sessionId: handle.sessionId,
        runId: handle.runId,
      });
      if (!handle.runId) this.running.delete(automation.id);
      return handle;
    } catch (error) {
      // A failed start must not leave a claim behind: a stale session claim
      // would auto-decide approvals for whatever the *user* later runs in that
      // session — silently auto-approving their own writes under `unattended`.
      if (claimedSession) this.releaseSession(claimedSession);
      this.running.delete(automation.id);
      await this.store.recordRun(
        automation.id,
        `${ORIGIN_LABEL[origin]} · failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}

const ORIGIN_LABEL: Record<'manual' | 'schedule' | 'event', string> = {
  manual: 'Run now',
  schedule: 'Scheduled',
  event: 'Triggered',
};
