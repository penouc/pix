import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/total.js', import.meta.url), 'utf8');

test('baseline preserves the reproducible quantity defect', () => {
  assert.match(source, /sum \+ item\.price/);
  assert.doesNotMatch(source, /item\.price \* item\.quantity/);
});
