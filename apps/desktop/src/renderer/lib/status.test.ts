import { describe, expect, it } from 'vitest';

import { formatTokenMillions, NOT_REPORTED } from './status';

describe('formatTokenMillions', () => {
  it.each([
    [0, '0M'],
    [1_000, '0.001M'],
    [125_000, '0.125M'],
    [1_000_000, '1M'],
    [1_250_000, '1.25M'],
    [12_345_678, '12.3M'],
  ])('formats %i tokens as %s', (tokens, expected) => {
    expect(formatTokenMillions(tokens)).toBe(expected);
  });

  it('keeps the missing-value label', () => {
    expect(formatTokenMillions(undefined)).toBe(NOT_REPORTED);
  });
});
