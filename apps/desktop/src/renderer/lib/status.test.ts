import { describe, expect, it } from 'vitest';

import { formatInteger, NOT_REPORTED } from './status';

describe('formatInteger', () => {
  it.each([
    [0, '0'],
    [1_000, '1,000'],
    [125_000, '125,000'],
    [1_000_000, '1,000,000'],
    [12_345_678, '12,345,678'],
    [296_750_859, '296,750,859'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatInteger(value)).toBe(expected);
  });

  it('keeps the missing-value label', () => {
    expect(formatInteger(undefined)).toBe(NOT_REPORTED);
  });
});
