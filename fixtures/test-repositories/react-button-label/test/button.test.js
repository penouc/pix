import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

test('PRIMARY_LABEL constant is Submit (baseline; agent should change to Continue)', () => {
  const source = readSource('src/Button.jsx');
  // Baseline expectation for the unfixed fixture.
  // After the agent task, this should match 'Continue' instead.
  assert.match(source, /export const PRIMARY_LABEL = 'Submit'/);
});

test('default Button label prop is Submit', () => {
  const source = readSource('src/Button.jsx');
  assert.match(source, /label = 'Submit'/);
});

test('App uses PRIMARY_LABEL', () => {
  const source = readSource('src/App.jsx');
  assert.match(source, /PRIMARY_LABEL/);
});
