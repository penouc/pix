import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import type { HistorySessionMeta } from '@pi-desktop/protocol';

import { getAcpAgent } from '../acp/detect.js';

const execFileAsync = promisify(execFile);

export interface ResumeOutcome {
  ok: boolean;
  command: string;
  error?: string;
}

export interface ExternalTerminalApp {
  id: string;
  name: string;
  /** Absolute .app path on macOS when known. */
  appPath?: string;
}

const MAC_TERMINALS: Array<{ id: string; name: string; paths: string[] }> = [
  {
    id: 'terminal',
    name: 'Terminal',
    paths: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'],
  },
  { id: 'iterm', name: 'iTerm', paths: ['/Applications/iTerm.app'] },
  { id: 'warp', name: 'Warp', paths: ['/Applications/Warp.app'] },
  { id: 'ghostty', name: 'Ghostty', paths: ['/Applications/Ghostty.app'] },
  { id: 'kitty', name: 'Kitty', paths: ['/Applications/kitty.app'] },
  { id: 'alacritty', name: 'Alacritty', paths: ['/Applications/Alacritty.app'] },
  { id: 'hyper', name: 'Hyper', paths: ['/Applications/Hyper.app'] },
];

/** Detect installed GUI terminals the user can resume into. */
export async function listExternalTerminals(): Promise<ExternalTerminalApp[]> {
  if (platform() !== 'darwin') {
    return [{ id: 'clipboard', name: 'Copy command' }];
  }
  const found: ExternalTerminalApp[] = [];
  for (const t of MAC_TERMINALS) {
    const appPath = t.paths.find((p) => existsSync(p));
    if (appPath) found.push({ id: t.id, name: t.name, appPath });
  }
  if (!found.some((t) => t.id === 'terminal')) {
    // Terminal.app is always present on macOS even if path differs.
    found.unshift({ id: 'terminal', name: 'Terminal' });
  }
  return found;
}

/**
 * Open the session in the user's terminal at the original project directory.
 * macOS uses AppleScript / open; other platforms copy the command for paste.
 */
export async function resumeInTerminal(
  meta: HistorySessionMeta,
  terminalId = 'terminal',
): Promise<ResumeOutcome> {
  if (meta.origin === 'pix') {
    return {
      ok: false,
      command: '',
      error: 'PiX sessions open inside the app — pick the session from the list.',
    };
  }
  const info = await getAcpAgent(meta.agent);
  const bin = info?.resumeBin ?? meta.agent;
  const args = info?.resumeArgs?.(meta.nativeId) ?? ['--resume', meta.nativeId];
  const cwd = meta.projectPath;
  const core = [bin, ...args].map(posixQuote).join(' ');
  const command = cwd ? `cd ${posixQuote(cwd)} && ${core}` : core;

  if (platform() === 'darwin' && terminalId !== 'clipboard') {
    try {
      const launched = await launchMacTerminal(terminalId, command);
      return {
        ok: true,
        command,
        error: launched.needsPaste
          ? `Opened ${launched.appName} — resume command copied; paste it to continue.`
          : undefined,
      };
    } catch (err) {
      await copyToClipboard(command);
      return {
        ok: false,
        command,
        error: `Could not open terminal (${err instanceof Error ? err.message : String(err)}). Command copied.`,
      };
    }
  }

  await copyToClipboard(command);
  return {
    ok: false,
    command,
    error: 'Command copied to clipboard — paste it into your terminal to resume.',
  };
}

async function launchMacTerminal(
  terminalId: string,
  command: string,
): Promise<{ needsPaste: boolean; appName: string }> {
  switch (terminalId) {
    case 'iterm':
      await osascript([
        'tell application "iTerm"',
        'activate',
        'try',
        '  create window with default profile',
        'on error',
        '  create window with profile "Default"',
        'end try',
        'tell current session of current window',
        `  write text ${applescriptString(command)}`,
        'end tell',
        'end tell',
      ]);
      return { needsPaste: false, appName: 'iTerm' };
    case 'warp':
    case 'ghostty':
    case 'kitty':
    case 'alacritty':
    case 'hyper': {
      const appName =
        terminalId === 'warp'
          ? 'Warp'
          : terminalId === 'ghostty'
            ? 'Ghostty'
            : terminalId === 'kitty'
              ? 'kitty'
              : terminalId === 'alacritty'
                ? 'Alacritty'
                : 'Hyper';
      await copyToClipboard(command);
      await execFileAsync('open', ['-a', appName], { timeout: 5_000 });
      return { needsPaste: true, appName };
    }
    case 'terminal':
    default:
      await osascript([
        'tell application "Terminal" to activate',
        `tell application "Terminal" to do script ${applescriptString(command)}`,
      ]);
      return { needsPaste: false, appName: 'Terminal' };
  }
}

function posixQuote(s: string): string {
  if (s && /^[A-Za-z0-9_./:=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function applescriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function osascript(lines: string[]): Promise<void> {
  const args = lines.flatMap((l) => ['-e', l]);
  const { stderr } = await execFileAsync('osascript', args, { timeout: 10_000 });
  if (stderr?.trim()) {
    // osascript often writes warnings to stderr without failing
  }
}

async function copyToClipboard(text: string): Promise<void> {
  if (platform() === 'darwin') {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('pbcopy');
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy ${code}`))));
        child.stdin.write(text);
        child.stdin.end();
      });
      return;
    } catch {
      /* fall through */
    }
  }
}
