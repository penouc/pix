import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/labels.js', import.meta.url), 'utf8');

test('acceptance: exactly one label is updated conservatively', () => {
  const submitCount = [...src.matchAll(/=\s*'Submit';/g)].length;
  assert.equal(submitCount, 1, 'Expected exactly one label to be "Submit"');
});

test('acceptance: labels.js is syntactically valid (exportable)', async () => {
  const { BUTTON_LABEL, HEADING_LABEL, LINK_LABEL } = await import('../src/labels.js?v=' + Date.now());
  assert.ok(
    typeof BUTTON_LABEL === 'string' && typeof HEADING_LABEL === 'string' && typeof LINK_LABEL === 'string',
    'All three exports must remain strings',
  );
});
