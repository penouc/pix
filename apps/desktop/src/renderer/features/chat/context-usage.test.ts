import { describe, expect, it } from 'vitest';

import { normalizeContextCapacity } from './context-usage';

describe('normalizeContextCapacity', () => {
  it.each([1_000_000, 1_047_576, 1_048_576, 1_050_000])(
    'normalizes the %i-token 1M tier',
    (capacity) => {
      expect(normalizeContextCapacity(capacity)).toBe(1_000_000);
    },
  );

  it.each([128_000, 200_000, 272_000, 400_000, 2_000_000])(
    'preserves the distinct %i-token tier',
    (capacity) => {
      expect(normalizeContextCapacity(capacity)).toBe(capacity);
    },
  );

  it('rejects missing or invalid capacities', () => {
    expect(normalizeContextCapacity()).toBeUndefined();
    expect(normalizeContextCapacity(0)).toBeUndefined();
    expect(normalizeContextCapacity(Number.NaN)).toBeUndefined();
  });
});
