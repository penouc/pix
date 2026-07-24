import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/formatUser.ts', import.meta.url), 'utf8');

test('baseline contains the intentional User property type error', () => {
  assert.match(source, /return user\.name;/);
  assert.match(source, /displayName: string/);
});
