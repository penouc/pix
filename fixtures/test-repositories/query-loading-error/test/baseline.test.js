import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProfileView } from '../src/profileView.js';

test('baseline renders a successful query result', () => {
  assert.equal(renderProfileView({ data: { name: 'Ada' } }), 'Hello, Ada');
});
