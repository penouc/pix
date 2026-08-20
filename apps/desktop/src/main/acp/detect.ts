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
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp'],
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

export async function detectAcpAgents(force = false): Promise<AcpAgentInfo[]> {
  if (!force && cached && Date.now() - cachedAt < 60_000) return cached;
  const which = await resolveBins(CATALOG.flatMap((c) => c.bins));
  const out: AcpAgentInfo[] = CATALOG.map((c) => {
    const hit = c.bins.find((b) => which.get(b));
    const available = Boolean(hit);
    // Prefer a resolved local binary over npx when present.
    let command = c.command;
    let args = c.args;
    if (hit && hit !== 'npx') {
      if (c.id === 'claude-code' && hit === 'claude-agent-acp') {
        command = which.get(hit)!;
        args = [];
      } else if (c.id === 'codex' && hit === 'codex-acp') {
        command = which.get(hit)!;
        args = [];
      } else if (c.id === 'gemini' || c.id === 'opencode' || c.id === 'grok' || c.id === 'omp' || c.id === 'copilot') {
        command = which.get(hit)!;
        args = c.args;
      } else if (c.id === 'pi' && hit === 'pi-acp') {
        command = which.get(hit)!;
        args = [];
      } else if (c.id === 'claude-code' && hit === 'claude') {
        // Claude CLI itself is enough for terminal resume; ACP still via npx.
        available; // keep available true
      }
    }
    return {
      id: c.id,
      displayName: HISTORY_AGENT_DISPLAY[c.id],
      available: available || (c.command === 'npx' && Boolean(which.get('npx') || which.get('npm'))),
      command: which.get(command) ?? command,
      args,
      resumeBin: c.resumeBin && which.get(c.resumeBin) ? which.get(c.resumeBin) : c.resumeBin,
      resumeArgs: c.resumeArgs,
    };
  });
  // Mark available only when we can actually launch or resume.
  for (const a of out) {
    if (a.id === 'claude-code') {
      a.available = Boolean(which.get('claude-agent-acp') || which.get('npx') || which.get('claude'));
    }
  }
  cached = out;
  cachedAt = Date.now();
  return out;
}

export async function getAcpAgent(id: HistoryAgentId): Promise<AcpAgentInfo | null> {
  const all = await detectAcpAgents();
  return all.find((a) => a.id === id) ?? null;
}

async function resolveBins(bins: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(bins.concat(['npx', 'npm']))];
  const map = new Map<string, string>();
  const script = unique.map((b) => `printf '%s\\t' ${shellQuote(b)}; command -v ${shellQuote(b)} || echo`).join('; ');
  try {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/zsh';
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', unique.map((b) => `where ${b} 2>nul`).join(' & ')]
        : ['-lic', script];
    const { stdout } = await execFileAsync(shell, args, {
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    if (process.platform === 'win32') {
      // Best-effort: if where printed anything, mark bin present as itself.
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
