import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

/**
 * Providers we attempt to hydrate from process env (plan M3 partial).
 * Pi's ModelRuntime also reads env natively; setRuntimeApiKey makes status explicit.
 */
const ENV_PROVIDER_CANDIDATES = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'openrouter',
  'opencode',
  'opencode-go',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'moonshotai',
  'minimax',
  'minimax-cn',
  'zai',
] as const;

const ENV_KEY_BY_PROVIDER: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  // OpenCode Zen + Go plans share OPENCODE_API_KEY in Pi env mapping.
  opencode: ['OPENCODE_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY'],
  groq: ['GROQ_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-cn': ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
  zai: ['ZAI_API_KEY'],
};

export interface ProviderAuthSummary {
  providerId: string;
  hasAuth: boolean;
  source: 'env' | 'runtime' | 'none';
}

/**
 * Load OpenCode CLI stored API keys into process.env (never logs values).
 * Source: ~/.local/share/opencode/auth.json (`opencode-go` / `opencode` entries).
 */
export function loadOpenCodeAuthFromDisk(): { loaded: string[] } {
  const loaded: string[] = [];
  try {
    const authPath = join(homedir(), '.local/share/opencode/auth.json');
    const raw = readFileSync(authPath, 'utf8');
    const json = JSON.parse(raw) as Record<string, { type?: string; key?: string }>;

    const goKey = json['opencode-go']?.key?.trim();
    if (goKey) {
      if (!process.env['OPENCODE_API_KEY']?.trim()) {
        process.env['OPENCODE_API_KEY'] = goKey;
      }
      if (!process.env['OPENCODE_GO_API_KEY']?.trim()) {
        process.env['OPENCODE_GO_API_KEY'] = goKey;
      }
      loaded.push('opencode-go');
    }

    const zenKey = json['opencode']?.key?.trim();
    if (zenKey && !process.env['OPENCODE_API_KEY']?.trim()) {
      process.env['OPENCODE_API_KEY'] = zenKey;
      loaded.push('opencode');
    }
  } catch {
    // missing file or unreadable — ignore
  }
  return { loaded };
}

/**
 * Apply env API keys into ModelRuntime and report which providers look authenticated.
 * Never logs key material.
 */
export async function hydrateRuntimeAuthFromEnv(
  runtime: ModelRuntime,
): Promise<ProviderAuthSummary[]> {
  // Prefer local OpenCode CLI credentials when env is empty.
  loadOpenCodeAuthFromDisk();

  const summaries: ProviderAuthSummary[] = [];

  for (const providerId of ENV_PROVIDER_CANDIDATES) {
    const keys = ENV_KEY_BY_PROVIDER[providerId] ?? [];
    let applied = false;
    for (const envName of keys) {
      const value = process.env[envName]?.trim();
      if (!value) continue;
      try {
        // Bound setRuntimeApiKey — some providers may network-probe and hang on bad proxies.
        await Promise.race([
          // The catalogue is bundled. Refreshing it over the network for every
          // env key made startup wait up to 8 seconds per provider (OpenCode's
          // shared key can configure two), while adding no models the picker
          // does not already have.
          runtime.setRuntimeApiKey(providerId, value, { allowNetwork: false }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('setRuntimeApiKey timeout')), 8_000),
          ),
        ]);
        applied = true;
        break;
      } catch {
        // If setRuntimeApiKey fails/times out, still treat non-empty env as auth for list/UI.
        // Pi will read OPENCODE_API_KEY (etc.) from process.env at request time.
        applied = true;
        break;
      }
    }

    const status = runtime.getProviderAuthStatus(providerId);
    const hasAuth = applied || Boolean(status?.configured);
    summaries.push({
      providerId,
      hasAuth,
      source: applied ? 'env' : status?.configured ? 'runtime' : 'none',
    });
  }

  return summaries;
}

export function describeAuthSources(summaries: ProviderAuthSummary[]): string {
  const ready = summaries.filter((s) => s.hasAuth).map((s) => s.providerId);
  if (ready.length === 0) return 'none';
  return ready.join(', ');
}
