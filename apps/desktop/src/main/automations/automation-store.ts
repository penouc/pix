import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Automation, AutomationDraft, AutomationTrigger } from '@pi-desktop/protocol';

/**
 * Automation definitions, persisted in the Main-private config dir.
 *
 * Kept as a JSON document rather than a SQLite table on purpose for now: this
 * is additive state with no foreign keys into checkpoints, and the migration
 * chain carries the rule that a destructive migration must not run while an
 * unresolved checkpoint exists. Moving these to the `automations` table is the
 * v6 migration in plan §26.2.
 */
export class AutomationStore {
  private readonly filePath: string;
  private cache: Automation[] | null = null;

  constructor(userDataPath = app.getPath('userData')) {
    this.filePath = path.join(userDataPath, 'automations.json');
  }

  async list(projectId?: string): Promise<Automation[]> {
    const all = await this.load();
    const filtered = projectId ? all.filter((a) => a.projectId === projectId) : all;
    return filtered.map((automation) => ({
      ...automation,
      nextRunAt: nextRunAt(automation) ?? undefined,
    }));
  }

  async get(id: string): Promise<Automation | undefined> {
    return (await this.load()).find((automation) => automation.id === id);
  }

  async save(draft: AutomationDraft): Promise<Automation> {
    const all = await this.load();
    const now = Date.now();
    if (draft.id) {
      const index = all.findIndex((automation) => automation.id === draft.id);
      if (index === -1) throw new Error(`Automation ${draft.id} not found`);
      const updated: Automation = { ...all[index]!, ...draft, id: draft.id };
      all[index] = updated;
      await this.persist(all);
      return { ...updated, nextRunAt: nextRunAt(updated) ?? undefined };
    }
    const created: Automation = {
      id: randomUUID(),
      name: draft.name,
      projectId: draft.projectId,
      prompt: draft.prompt,
      trigger: draft.trigger,
      approvalMode: draft.approvalMode,
      note: draft.note,
      enabled: draft.enabled,
      createdAt: now,
    };
    all.push(created);
    await this.persist(all);
    return { ...created, nextRunAt: nextRunAt(created) ?? undefined };
  }

  async remove(id: string): Promise<void> {
    const all = await this.load();
    await this.persist(all.filter((automation) => automation.id !== id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<Automation> {
    const all = await this.load();
    const found = all.find((automation) => automation.id === id);
    if (!found) throw new Error(`Automation ${id} not found`);
    found.enabled = enabled;
    await this.persist(all);
    return { ...found, nextRunAt: nextRunAt(found) ?? undefined };
  }

  async recordRun(id: string, summary: string, at = Date.now()): Promise<void> {
    const all = await this.load();
    const found = all.find((automation) => automation.id === id);
    if (!found) return;
    found.lastRunAt = at;
    found.lastRunSummary = summary;
    await this.persist(all);
  }

  private async load(): Promise<Automation[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.cache = Array.isArray(parsed) ? (parsed as Automation[]) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private async persist(next: Automation[]): Promise<void> {
    this.cache = next;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8');
  }
}

/** When this automation is next due, or null if it only runs on demand. */
export function nextRunAt(automation: Automation, now = Date.now()): number | null {
  if (!automation.enabled) return null;
  return nextRunAtForTrigger(automation.trigger, automation.lastRunAt, now);
}

export function nextRunAtForTrigger(
  trigger: AutomationTrigger,
  lastRunAt: number | undefined,
  now: number,
): number | null {
  // Neither manual nor event triggers are time-based.
  if (trigger.kind === 'manual' || trigger.kind === 'event') return null;

  if (trigger.kind === 'interval') {
    const periodMs = trigger.everyMinutes * 60_000;
    if (!lastRunAt) return now + periodMs;
    return lastRunAt + periodMs;
  }

  // daily — today's wall-clock occurrence of atMinute, or tomorrow's once
  // today's has already been used. Returning only *future* times here would
  // make `isDue` (next <= now) permanently false, so today's slot is kept
  // until a run actually consumes it.
  const today = new Date(now);
  today.setHours(Math.floor(trigger.atMinute / 60), trigger.atMinute % 60, 0, 0);
  const todaySlot = today.getTime();
  const DAY = 24 * 60 * 60 * 1000;

  // Already ran in this slot (or later) → next is tomorrow's.
  if (lastRunAt != null && lastRunAt >= todaySlot) return todaySlot + DAY;
  // Today's slot has arrived and nothing has consumed it → due now.
  if (todaySlot <= now) return todaySlot;
  return todaySlot;
}

/**
 * A slot older than this is treated as missed and skipped rather than caught
 * up: waking the machine at noon must not fire last night's 02:00 automation.
 */
const MISSED_SLOT_GRACE_MS = 60 * 60 * 1000;

export function isDue(automation: Automation, now = Date.now()): boolean {
  const next = nextRunAt(automation, now);
  if (next === null) return false;
  if (next > now) return false;
  return now - next <= MISSED_SLOT_GRACE_MS;
}
