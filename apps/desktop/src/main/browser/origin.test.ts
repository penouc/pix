import { describe, expect, it } from 'vitest';

import { isHttpUrl, isLoopbackUrl, normalizeBrowserUrl } from './origin.js';

describe('browser origin policy', () => {
  it('accepts only http(s)', () => {
    expect(isHttpUrl('http://localhost:5173/')).toBe(true);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('file:///tmp/x')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });

  it('recognises loopback hosts for the picker', () => {
    expect(isLoopbackUrl('http://localhost:5173/app')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:3000/')).toBe(true);
    expect(isLoopbackUrl('http://[::1]/')).toBe(true);
    expect(isLoopbackUrl('https://example.com')).toBe(false);
  });

  it('normalises bare localhost like an address bar', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/');
    expect(normalizeBrowserUrl('')).toBeNull();
  });
});
