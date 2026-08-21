import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { HistoryAgentId } from '@pi-desktop/protocol';
import { HISTORY_AGENT_DISPLAY } from '@pi-desktop/protocol';

const execFileAsync = promisify(execFile);

export interface AcpAgentInfo {
  id: HistoryAgentId;
  displayName: string;
  available: boolean;
  /** argv used to spawn the ACP agent process */
  command: string;
  args: string[];
  /** Extra env for the ACP child (e.g. CODEX_PATH → local Codex CLI). */
  env?: Record<string, string>;
  /** CLI used for terminal resume fallback */
  resumeBin?: string;
  resumeArgs?: (sessionId: string) => string[];
}

/**
 * Known ACP / stdio agent launchers. Availability is checked via login-shell
 * `command -v` because Electron's GUI PATH often omits ~/.local/bin.
 */
const CATALOG: Array<Omit<AcpAgentInfo, 'available' | 'displayName'> & { bins: string[] }> = [
  {
    id: 'claude-code',
    bins: ['claude-agent-acp', 'claude'],
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
    resumeBin: 'claude',
    resumeArgs: (id) => ['--resume', id],
  },
  {
    id: 'codex',
    bins: ['codex-acp', 'codex'],
    // Official ACP adapter — starts Codex App Server / CLI under the hood.
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
    resumeBin: 'codex',
    resumeArgs: (id) => ['resume', id],
  },
  {
    id: 'gemini',
    bins: ['gemini'],
    command: 'gemini',
    args: ['--acp'],
    resumeBin: 'gemini',
  },
  {
    id: 'opencode',
    bins: ['opencode'],
    command: 'opencode',
    args: ['acp'],
    resumeBin: 'opencode',
    resumeArgs: (id) => ['--session', id],
  },
  {
    id: 'grok',
    bins: ['grok'],
    command: 'grok',
    args: ['--no-auto-update', 'agent', 'stdio'],
    resumeBin: 'grok',
  },
  {
    id: 'pi',
    bins: ['pi', 'pi-acp'],
    command: 'npx',
    args: ['-y', 'pi-acp'],
    resumeBin: 'pi',
    resumeArgs: (id) => ['--session', id],
  },
  {
    id: 'omp',
    bins: ['omp'],
    command: 'omp',
    args: ['-p', '--mode', 'json'],
    resumeBin: 'omp',
    resumeArgs: (id) => ['--resume', id],
  },
  {
    id: 'copilot',
    bins: ['copilot'],
    command: 'copilot',
    args: ['--acp', '--stdio'],
    resumeBin: 'copilot',
  },
];

let cached: AcpAgentInfo[] | null = null;
let cachedAt = 0;
let detectInflight: Promise<AcpAgentInfo[]> | null = null;

/** Sync snapshot for fast sidebar paint — may be null before the first probe. */
export function getCachedAcpAgents(): AcpAgentInfo[] | null {
  return cached;
}

export async function detectAcpAgents(force = false): Promise<AcpAgentInfo[]> {
  if (!force && cached && Date.now() - cachedAt < 60_000) return cached;
  if (detectInflight) return detectInflight;
  detectInflight = (async () => {
    try {
      const which = await resolveBins(CATALOG.flatMap((c) => c.bins));
      const out: AcpAgentInfo[] = CATALOG.map((c) => {
        const hit = c.bins.find((b) => which.get(b));
        let available = Boolean(hit);
        // Prefer a resolved local binary over npx when present.
        let command = c.command;
        let args = [...c.args];
        let env: Record<string, string> | undefined = c.env ? { ...c.env } : undefined;

        if (c.id === 'codex') {
          // Codex itself has no --acp flag — drive it through codex-acp, pointing
          // CODEX_PATH at the user's installed CLI when we can resolve it.
          const codexPath = which.get('codex');
          const acpPath = which.get('codex-acp');
          if (acpPath) {
            command = acpPath;
            args = [];
          } else {
            command = which.get('npx') ?? 'npx';
            args = ['-y', '@agentclientprotocol/codex-acp'];
          }
          env = {
            ...(env ?? {}),
            // Writable by default — history browse is read-only; Continue is not.
            INITIAL_AGENT_MODE: 'agent',
          };
          if (codexPath) env.CODEX_PATH = codexPath;
          // Adapter required — local `codex` alone cannot speak ACP.
          available = Boolean(acpPath || which.get('npx') || which.get('npm'));
        } else if (hit && hit !== 'npx') {
          if (c.id === 'claude-code' && hit === 'claude-agent-acp') {
            command = which.get(hit)!;
            args = [];
          } else if (
            c.id === 'gemini' ||
            c.id === 'opencode' ||
            c.id === 'grok' ||
            c.id === 'omp' ||
            c.id === 'copilot'
          ) {
            command = which.get(hit)!;
            args = c.args;
          } else if (c.id === 'pi' && hit === 'pi-acp') {
            command = which.get(hit)!;
            args = [];
          } else if (c.id === 'claude-code' && hit === 'claude') {
            // Claude CLI itself is enough for terminal resume; ACP still via npx.
            available = Boolean(which.get('claude-agent-acp') || which.get('npx') || which.get('npm'));
          }
        } else if (c.command === 'npx') {
          available = Boolean(which.get('npx') || which.get('npm'));
        }

        return {
          id: c.id,
          displayName: HISTORY_AGENT_DISPLAY[c.id],
          available,
          command: which.get(command) ?? command,
          args,
          ...(env ? { env } : {}),
          resumeBin: c.resumeBin && which.get(c.resumeBin) ? which.get(c.resumeBin) : c.resumeBin,
          resumeArgs: c.resumeArgs,
        };
      });
      cached = out;
      cachedAt = Date.now();
      return out;
    } finally {
      detectInflight = null;
    }
  })();
  return detectInflight;
}

export async function getAcpAgent(id: HistoryAgentId): Promise<AcpAgentInfo | null> {
  const all = await detectAcpAgents();
  return all.find((a) => a.id === id) ?? null;
}

async function resolveBins(bins: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(bins.concat(['npx', 'npm']))];
  // Prefer a fast non-login shell with an augmented PATH. Login shells (-lic)
  // load oh-my-zsh etc. and routinely cost multiple seconds on cold start.
  const home = process.env.HOME || '';
  const pathAugment = [
    process.env.PATH,
    home ? `${home}/.local/bin` : '',
    home ? `${home}/.nvm/current/bin` : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
    .filter(Boolean)
    .join(':');

  const map = await runWhich(unique, pathAugment, false);
  if (map.size > 0) return map;
  // Fallback once: full login shell when GUI PATH is empty.
  return runWhich(unique, process.env.PATH ?? pathAugment, true);
}

async function runWhich(
  unique: string[],
  pathEnv: string,
  login: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const script = unique
    .map((b) => `printf '%s\\t' ${shellQuote(b)}; command -v ${shellQuote(b)} || echo`)
    .join('; ');
  try {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh';
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', unique.map((b) => `where ${b} 2>nul`).join(' & ')]
        : [login ? '-lic' : '-c', script];
    const { stdout } = await execFileAsync(shell, args, {
      timeout: login ? 6_000 : 2_500,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PATH: pathEnv },
    });
    if (process.platform === 'win32') {
      for (const b of unique) {
        if (stdout.toLowerCase().includes(b.toLowerCase())) map.set(b, b);
      }
      return map;
    }
    for (const line of stdout.split('\n')) {
      const [name, p] = line.split('\t');
      if (name && p && p.startsWith('/')) map.set(name.trim(), p.trim());
    }
  } catch {
    /* empty */
  }
  return map;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
