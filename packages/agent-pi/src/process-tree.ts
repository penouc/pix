import { execFileSync } from 'node:child_process';

/**
 * Kill a process and its descendants (plan §7.2 / §14.1).
 * Cross-platform best-effort; safe to call with already-dead pids.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!Number.isFinite(pid) || pid <= 0) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // process may already be gone
    }
    return;
  }

  // Prefer process-group kill when the target is a group leader (detached spawn).
  try {
    process.kill(-pid, signal);
  } catch {
    // not a group leader or already dead
  }

  const descendants = listDescendantPids(pid);
  for (const childPid of descendants.reverse()) {
    try {
      process.kill(childPid, signal);
    } catch {
      // ignore
    }
  }

  try {
    process.kill(pid, signal);
  } catch {
    // ignore
  }

  // Escalate if still alive shortly after (best-effort, non-blocking for callers).
  if (signal === 'SIGTERM' && isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
    for (const childPid of listDescendantPids(pid)) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Depth-first list of descendant pids (unix). Empty on Windows. */
export function listDescendantPids(rootPid: number): number[] {
  if (process.platform === 'win32') return [];
  try {
    const out = execFileSync('pgrep', ['-P', String(rootPid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const direct = out
      .split(/\s+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const all: number[] = [];
    for (const child of direct) {
      all.push(...listDescendantPids(child), child);
    }
    return all;
  } catch {
    return [];
  }
}
