/**
 * Post-task acceptance checks for the eval fixture (plan §13.2).
 *
 * Baseline suite (button.test.js) expects Submit.
 * After the agent renames the label to Continue, run:
 *
 *   ACCEPTANCE=1 node --test test/acceptance.expected.test.js
 *
 * Or: npm run test:acceptance
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const enabled = process.env.ACCEPTANCE === '1';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

test('acceptance: PRIMARY_LABEL is Continue', { skip: !enabled }, () => {
  const source = readSource('src/Button.jsx');
  assert.match(source, /export const PRIMARY_LABEL = 'Continue'/);
});

test('acceptance: default prop is Continue', { skip: !enabled }, () => {
  const source = readSource('src/Button.jsx');
  assert.match(source, /label = 'Continue'/);
});

test('acceptance: no leftover Submit primary constants', { skip: !enabled }, () => {
  const source = readSource('src/Button.jsx');
  assert.doesNotMatch(source, /PRIMARY_LABEL = 'Submit'/);
});
