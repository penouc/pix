import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import test from 'node:test';

test('slow operation (30 second sleep)', { timeout: 60000 }, () => {
  execSync('sleep 30');
  assert.ok(true);
});
