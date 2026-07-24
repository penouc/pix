import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { isAlive, killProcessTree, listDescendantPids } from './process-tree.js';

describe('killProcessTree', () => {
  it(
    'terminates a detached sleep process',
    async () => {
      if (process.platform === 'win32') {
        // Covered by taskkill path; skip heavy windows CI variance here.
        return;
      }

      const child = spawn('sleep', ['120'], {
        detached: true,
        stdio: 'ignore',
      });
      const pid = child.pid;
      expect(pid).toBeTypeOf('number');
      child.unref();

      await delay(50);
      expect(isAlive(pid!)).toBe(true);

      killProcessTree(pid!);
      await delay(100);

      expect(isAlive(pid!)).toBe(false);
    },
    10_000,
  );

  it(
    'terminates parent and child shell tree',
    async () => {
      if (process.platform === 'win32') return;

      // Parent shell starts a long-running child then waits.
      const child = spawn(
        'bash',
        ['-c', 'sleep 120 & wait'],
        {
          detached: true,
          stdio: 'ignore',
        },
      );
      const pid = child.pid;
      expect(pid).toBeTypeOf('number');
      child.unref();

      await delay(80);
      const descendants = listDescendantPids(pid!);
      // May or may not have captured child yet depending on timing; kill whole tree either way.
      killProcessTree(pid!);
      await delay(150);

      expect(isAlive(pid!)).toBe(false);
      for (const d of descendants) {
        expect(isAlive(d)).toBe(false);
      }
    },
    10_000,
  );
});
