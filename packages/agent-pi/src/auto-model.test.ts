import { describe, expect, it } from 'vitest';

import type { ModelCatalogEntry } from '@pi-desktop/agent-domain';

import {
  AutoModelRouter,
  classifyAutoSwitchError,
  deriveAutoCandidates,
  modelRefFromKey,
  modelRefKey,
} from './auto-model.js';

const CATALOGUE: ModelCatalogEntry[] = [
  {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    hasAuth: true,
    inputCostPerMTok: 0.15,
    outputCostPerMTok: 0.6,
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    hasAuth: true,
    inputCostPerMTok: 5,
    outputCostPerMTok: 15,
    reasoning: true,
  },
  {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    hasAuth: true,
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
    reasoning: true,
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    hasAuth: true,
    inputCostPerMTok: 0.27,
    outputCostPerMTok: 1.1,
  },
  // No credential — must never appear in a chain.
  {
    providerId: 'xai',
    modelId: 'grok-4',
    displayName: 'Grok 4',
    hasAuth: false,
    inputCostPerMTok: 2,
    outputCostPerMTok: 8,
    reasoning: true,
  },
];

describe('classifyAutoSwitchError', () => {
  it('maps rate limits, quotas, timeouts and server errors', () => {
    expect(classifyAutoSwitchError(new Error('429 Too Many Requests'))).toBe('rate-limit');
    expect(classifyAutoSwitchError(new Error('Provider overloaded, try again'))).toBe('rate-limit');
    expect(classifyAutoSwitchError(new Error('Insufficient quota: 402'))).toBe('quota');
    expect(classifyAutoSwitchError(new Error('Request timed out after 30s'))).toBe('timeout');
    expect(classifyAutoSwitchError(new Error('503 Service Unavailable'))).toBe('error');
  });

  it('refuses to switch on auth and configuration failures', () => {
    expect(classifyAutoSwitchError(new Error('Missing API key for openai'))).toBeNull();
    expect(classifyAutoSwitchError(new Error('Authentication failed'))).toBeNull();
    expect(classifyAutoSwitchError(new Error('No model selected'))).toBeNull();
  });

  it('leaves context overflow to compaction', () => {
    expect(classifyAutoSwitchError(new Error('context overflow: 140000 > 128000'))).toBeNull();
  });
});

describe('deriveAutoCandidates', () => {
  it('orders the default role cheapest-first, runnable only', () => {
    const refs = deriveAutoCandidates(CATALOGUE, 'default').map(modelRefKey);
    expect(refs).toEqual([
      'openai/gpt-4o-mini',
      'deepseek/deepseek-chat',
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-4o',
    ]);
    expect(refs.some((key) => key.startsWith('xai/'))).toBe(false);
  });

  it('orders the plan role reasoning-first, cheapest within a tier', () => {
    const refs = deriveAutoCandidates(CATALOGUE, 'plan').map(modelRefKey);
    expect(refs[0]).toBe('anthropic/claude-sonnet-4-5'); // reasoning + cheaper than gpt-4o
    expect(refs[1]).toBe('openai/gpt-4o'); // reasoning, more expensive
    expect(refs[2]).toBe('openai/gpt-4o-mini'); // non-reasoning
  });
});

describe('AutoModelRouter', () => {
  it('uses role pins and the configured fallback chain ahead of derived order', () => {
    const router = new AutoModelRouter(
      {
        defaultKey: 'deepseek/deepseek-chat',
        planKey: 'openai/gpt-4o',
        fallbackKeys: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4-5'],
      },
      CATALOGUE,
    );
    expect(router.resolve('default')).toEqual({ providerId: 'deepseek', modelId: 'deepseek-chat' });
    expect(router.resolve('plan')).toEqual({ providerId: 'openai', modelId: 'gpt-4o' });
  });

  it('skips stale pins that are not runnable and dedupes the chain', () => {
    const router = new AutoModelRouter(
      { defaultKey: 'xai/grok-4', fallbackKeys: ['openai/gpt-4o-mini', 'openai/gpt-4o-mini'] },
      CATALOGUE,
    );
    const chain = router.chain('default').map(modelRefKey);
    expect(chain[0]).toBe('openai/gpt-4o-mini');
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('advances to the next chain model and stops at the end', () => {
    const router = new AutoModelRouter(
      { fallbackKeys: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'] },
      CATALOGUE,
    );
    expect(router.next('default', { providerId: 'openai', modelId: 'gpt-4o-mini' })).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
    });
    // The configured chain is exhausted; the derived tail takes over.
    expect(router.next('default', { providerId: 'deepseek', modelId: 'deepseek-chat' })).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
    // Truly last in the full chain: no next candidate.
    expect(router.next('default', { providerId: 'openai', modelId: 'gpt-4o' })).toBeNull();
  });

  it('skips the failed model when resolving a fresh attempt', () => {
    const router = new AutoModelRouter(undefined, CATALOGUE);
    const first = router.resolve('default');
    const second = router.resolve('default', first ?? undefined);
    expect(second).not.toEqual(first);
  });

  it('returns null when nothing is runnable', () => {
    const router = new AutoModelRouter(undefined, []);
    expect(router.resolve('default')).toBeNull();
  });
});

describe('modelRefKey round-trip', () => {
  it('round-trips provider/model keys', () => {
    const ref = { providerId: 'openrouter', modelId: 'anthropic/claude-3.5-sonnet' };
    expect(modelRefFromKey(modelRefKey(ref))).toEqual(ref);
  });

  it('rejects malformed keys', () => {
    expect(() => modelRefFromKey('noprovider')).toThrow();
    expect(() => modelRefFromKey('/model')).toThrow();
  });
});
