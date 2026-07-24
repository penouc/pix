import { describe, expect, it } from 'vitest';

import { redactSecrets } from './audit-log.js';

describe('redactSecrets', () => {
  it('redacts api keys and bearer tokens', () => {
    expect(redactSecrets('api_key=sk-abc1234567890')).toContain('***');
    expect(redactSecrets('Authorization: Bearer abc.def.ghi')).toContain('***');
  });
});
