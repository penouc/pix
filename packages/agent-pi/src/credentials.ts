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
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'moonshotai',
  'minimax',
  'zai',
] as const;

const ENV_KEY_BY_PROVIDER: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  groq: ['GROQ_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  zai: ['ZAI_API_KEY'],
};

export interface ProviderAuthSummary {
  providerId: string;
  hasAuth: boolean;
  source: 'env' | 'runtime' | 'none';
}

/**
 * Apply env API keys into ModelRuntime and report which providers look authenticated.
 * Never logs key material.
 */
export async function hydrateRuntimeAuthFromEnv(
  runtime: ModelRuntime,
): Promise<ProviderAuthSummary[]> {
  const summaries: ProviderAuthSummary[] = [];

  for (const providerId of ENV_PROVIDER_CANDIDATES) {
    const keys = ENV_KEY_BY_PROVIDER[providerId] ?? [];
    let applied = false;
    for (const envName of keys) {
      const value = process.env[envName]?.trim();
      if (!value) continue;
      try {
        await runtime.setRuntimeApiKey(providerId, value);
        applied = true;
        break;
      } catch {
        // provider may not accept runtime key in this catalog snapshot
      }
    }

    const status = runtime.getProviderAuthStatus(providerId);
    const hasAuth = applied || Boolean(status?.configured);
    summaries.push({
      providerId,
      hasAuth,
      source: applied
        ? 'env'
        : status?.configured
          ? 'runtime'
          : 'none',
    });
  }

  return summaries;
}

export function describeAuthSources(summaries: ProviderAuthSummary[]): string {
  const ready = summaries.filter((s) => s.hasAuth).map((s) => s.providerId);
  if (ready.length === 0) return 'none';
  return ready.join(', ');
}
