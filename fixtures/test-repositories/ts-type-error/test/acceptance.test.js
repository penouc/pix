import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/formatUser.ts', import.meta.url), 'utf8');

test('formatUser returns the declared User displayName', () => {
  assert.match(source, /return user\.displayName;/);
  assert.doesNotMatch(source, /user\.name/);
});
