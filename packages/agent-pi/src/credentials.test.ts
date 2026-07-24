import { describe, expect, it } from 'vitest';

import { describeAuthSources, type ProviderAuthSummary } from './credentials.js';

describe('describeAuthSources', () => {
  it('returns none when empty or unauthenticated', () => {
    expect(describeAuthSources([])).toBe('none');
    const none: ProviderAuthSummary[] = [
      { providerId: 'openai', hasAuth: false, source: 'none' },
    ];
    expect(describeAuthSources(none)).toBe('none');
  });

  it('lists authenticated providers', () => {
    const rows: ProviderAuthSummary[] = [
      { providerId: 'openai', hasAuth: true, source: 'env' },
      { providerId: 'anthropic', hasAuth: false, source: 'none' },
      { providerId: 'xai', hasAuth: true, source: 'runtime' },
    ];
    expect(describeAuthSources(rows)).toBe('openai, xai');
  });
});
