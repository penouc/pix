import { execFileSync } from 'node:child_process';

/**
 * Kill a process and, on Windows, its whole descendant tree.
 *
 * Windows has no POSIX signals and no process groups as Unix knows them:
 * `process.kill(-pid, signal)` throws, so it is replaced with
 * `taskkill /T /F`, which walks the parent/child tree. On Unix the detached
 * spawn is its own process-group leader, so `process.kill(-pid, SIGKILL)`
 * takes the whole group down with one call (falling back to the single pid).
 *
 * Used by both the Terminal panel timeout/cancel path and anywhere else Main
 * needs to reap a runaway tree. Best-effort: safe to call with dead pids.
 */
export function killProcessTree(pid: number | undefined): void {
  if (pid == null || !Number.isFinite(pid) || pid <= 0) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      /* already gone, or the tree was already reaped */
    }
    return;
  }

  try {
    // Negative pid targets the whole process group created by `detached`.
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
