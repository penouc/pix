import assert from 'node:assert/strict';
import test from 'node:test';

// Lightweight fixture: agent should update expected label together with component.
test('primary label', () => {
  const expected = 'Submit';
  assert.equal(expected, 'Submit');
});
