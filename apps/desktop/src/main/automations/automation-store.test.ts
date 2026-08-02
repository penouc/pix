import { describe, expect, it } from 'vitest';

import type { Automation } from '@pi-desktop/protocol';

import { isDue, nextRunAt, nextRunAtForTrigger } from './automation-store.js';

const BASE: Omit<Automation, 'trigger'> = {
  id: 'a1',
  name: 'Nightly',
  projectId: 'p1',
  prompt: 'run the tests',
  approvalMode: 'unattended',
  enabled: true,
  createdAt: 0,
};

/** 2026-07-26 09:00 local. */
function at(hour: number, minute = 0): number {
  const date = new Date(2026, 6, 26, hour, minute, 0, 0);
  return date.getTime();
}

describe('automation scheduling', () => {
  it('fires a daily trigger once its slot has arrived', () => {
    // Regression: returning only future times made `isDue` permanently false,
    // so daily automations never ran.
    const automation: Automation = { ...BASE, trigger: { kind: 'daily', atMinute: 2 * 60 } };
    expect(isDue(automation, at(2, 1))).toBe(true);
  });

  it('does not fire a daily trigger before its slot', () => {
    const automation: Automation = { ...BASE, trigger: { kind: 'daily', atMinute: 2 * 60 } };
    expect(isDue(automation, at(1, 59))).toBe(false);
  });

  it('skips a daily slot that was missed rather than catching it up', () => {
    // Waking the machine at 09:00 must not run last night's 02:00 automation.
    const automation: Automation = { ...BASE, trigger: { kind: 'daily', atMinute: 2 * 60 } };
    expect(isDue(automation, at(9))).toBe(false);
  });

  it('does not re-fire a daily trigger inside the same slot', () => {
    const automation: Automation = {
      ...BASE,
      trigger: { kind: 'daily', atMinute: 2 * 60 },
      lastRunAt: at(2, 0),
    };
    expect(isDue(automation, at(2, 10))).toBe(false);
    expect(nextRunAtForTrigger(automation.trigger, automation.lastRunAt, at(2, 10))).toBe(
      at(2) + 24 * 60 * 60 * 1000,
    );
  });

  it('waits one full period before a freshly enabled interval trigger fires', () => {
    const now = at(9);
    expect(nextRunAtForTrigger({ kind: 'interval', everyMinutes: 60 }, undefined, now)).toBe(
      now + 60 * 60_000,
    );
    expect(isDue({ ...BASE, trigger: { kind: 'interval', everyMinutes: 60 } }, now)).toBe(false);
  });

  it('fires an interval trigger one period after the last run', () => {
    const automation: Automation = {
      ...BASE,
      trigger: { kind: 'interval', everyMinutes: 30 },
      lastRunAt: at(9),
    };
    expect(isDue(automation, at(9, 29))).toBe(false);
    expect(isDue(automation, at(9, 31))).toBe(true);
  });

  it('anchors a never-run interval to when it was enabled', () => {
    const automation: Automation = {
      ...BASE,
      createdAt: at(8),
      enabledAt: at(9),
      trigger: { kind: 'interval', everyMinutes: 30 },
    };
    expect(nextRunAt(automation, at(9, 10))).toBe(at(9, 30));
    expect(isDue(automation, at(9, 29))).toBe(false);
    expect(isDue(automation, at(9, 31))).toBe(true);
  });

  it('never fires a manual or disabled automation', () => {
    expect(isDue({ ...BASE, trigger: { kind: 'manual' } }, at(9))).toBe(false);
    expect(
      isDue({ ...BASE, enabled: false, trigger: { kind: 'daily', atMinute: 2 * 60 } }, at(2, 1)),
    ).toBe(false);
  });
});
