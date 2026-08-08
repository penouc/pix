import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Resolve the bash executable that runs commands.
 *
 * On Windows, Pi (and therefore PiX's agent) requires bash — the SDK looks for
 * a custom `shellPath`, then Git Bash under Program Files, then `bash.exe` on
 * PATH. The Terminal panel must speak the same dialect as the agent, so it
 * resolves the same way instead of falling back to cmd.exe. On macOS/Linux the
 * OS shell is bash-compatible and `shell: true` is fine; this returns null and
 * callers keep their platform default.
 *
 * Mirrors `@earendil-works/pi-coding-agent`'s own resolution (docs/windows.md).
 */
export function resolveBashPath(): string | null {
  if (process.platform !== 'win32') return null;

  const candidates: string[] = [];
  const programFiles = process.env['ProgramFiles'];
  if (programFiles) candidates.push(path.join(programFiles, 'Git', 'bin', 'bash.exe'));
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Git', 'bin', 'bash.exe'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // PATH fallback (Cygwin, MSYS2, WSL bash on PATH). `where` can list paths
  // that do not exist, so verify the first hit. `C:\Windows\System32\bash.exe`
  // is the legacy WSL launcher, not a real bash — skip it (same guard Pi uses).
  try {
    const result = execFileSync('where', ['bash.exe'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    for (const candidate of result.trim().split(/\r?\n/)) {
      if (!candidate || !existsSync(candidate)) continue;
      const normalized = candidate.replace(/\//g, '\\').toLowerCase();
      if (/^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized)) continue;
      return candidate;
    }
  } catch {
    // Not on PATH.
  }
  return null;
}

export interface PlatformPreflight {
  platform: NodeJS.Platform;
  git: { available: boolean; version?: string };
  bash: {
    /** Agent + Terminal commands need bash on Windows; irrelevant elsewhere. */
    required: boolean;
    available: boolean;
    path?: string;
    /** Human-readable remediation shown when `required && !available`. */
    hint?: string;
  };
}

const GIT_BASH_HINT =
  'PiX needs Git Bash to run agent commands. Install Git for Windows: https://git-scm.com/download/win';

async function readGitVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], {
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cheap environment probe for the About screen and the Windows Git Bash banner.
 * Never throws: any probe failure reads as "unavailable", and the UI decides
 * whether that matters (it only does when bash is required).
 */
export async function runPreflight(): Promise<PlatformPreflight> {
  const bashPath = process.platform === 'win32' ? resolveBashPath() : null;
  const gitVersion = await readGitVersion();

  return {
    platform: process.platform,
    git: { available: Boolean(gitVersion), ...(gitVersion ? { version: gitVersion } : {}) },
    bash: {
      required: process.platform === 'win32',
      available: bashPath !== null,
      ...(bashPath ? { path: bashPath } : {}),
      ...(process.platform === 'win32' && !bashPath ? { hint: GIT_BASH_HINT } : {}),
    },
  };
}
