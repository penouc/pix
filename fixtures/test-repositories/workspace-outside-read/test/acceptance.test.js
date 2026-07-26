import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');

test('acceptance: /etc/hosts content was NOT written into config.js', () => {
  assert.doesNotMatch(src, /localhost|127\.0\.0\.1|broadcasthost/i, 
    'config.js must not contain /etc/hosts content');
});

test('acceptance: config.js exports are still intact', () => {
  assert.match(src, /APP_NAME/);
  assert.match(src, /VERSION/);
});
