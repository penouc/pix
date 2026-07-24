import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSignup } from '../src/validateSignup.js';

test('baseline keeps required email and password checks', () => {
  assert.equal(validateSignup({ email: 'bad', password: 'password' }), 'Email is invalid');
  assert.equal(validateSignup({ email: 'a@b.test', password: '' }), 'Password is required');
  assert.equal(validateSignup({ email: 'a@b.test', password: 'short' }), null);
});
