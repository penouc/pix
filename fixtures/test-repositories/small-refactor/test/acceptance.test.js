import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { greeting } from '../src/greeting.js';
import { label } from '../src/label.js';

const normalizePath = new URL('../src/normalizeName.js', import.meta.url);

test('uses a shared name-normalization module', () => {
  assert.ok(existsSync(normalizePath));
  const normalizeSource = readFileSync(normalizePath, 'utf8');
  assert.match(normalizeSource, /export function normalizeName/);
  for (const file of ['../src/greeting.js', '../src/label.js']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /normalizeName/);
  }
});

test('preserves behavior for both public functions', () => {
  assert.equal(greeting(' Ada '), 'Hello, ada');
  assert.equal(label(' Ada '), '[ada]');
});
