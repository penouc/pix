const ONE_MILLION_TOKENS = 1_000_000;

/**
 * Model catalogues describe the same "1M context" tier with nearby raw values
 * such as 1,000,000, 1,047,576, 1,048,576, or 1,050,000. The UI labels all of
 * those as 1M, so the usage ring must use the same canonical denominator rather
 * than showing a subtly different percentage for each provider wrapper.
 */
export function normalizeContextCapacity(capacity?: number): number | undefined {
  if (capacity == null || !Number.isFinite(capacity) || capacity <= 0) return undefined;
  if (capacity >= 900_000 && capacity <= 1_100_000) return ONE_MILLION_TOKENS;
  return capacity;
}
