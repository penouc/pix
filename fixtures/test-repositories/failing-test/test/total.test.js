import assert from 'node:assert/strict';
import test from 'node:test';
import { total } from '../src/total.js';

test('total includes item quantities', () => {
  assert.equal(
    total([
      { price: 4, quantity: 2 },
      { price: 3, quantity: 1 },
    ]),
    11,
  );
});
