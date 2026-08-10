/**
 * Loopback / scheme helpers for the Dock preview host (ADR-0005).
 * Kept pure so policy can be unit-tested without Electron.
 */

/** http(s) only — same bar as `system.openExternal`. */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Hosts the element picker is allowed to run against in P1. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/** Accept `localhost:5173` the way a browser address bar does. */
export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
