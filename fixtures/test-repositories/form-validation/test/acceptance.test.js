import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSignup } from '../src/validateSignup.js';

test('requires password', () => {
  assert.equal(validateSignup({ email: 'a@b.test', password: '' }), 'Password is required');
});

test('rejects a short password', () => {
  assert.equal(
    validateSignup({ email: 'a@b.test', password: 'short' }),
    'Password must be at least 8 characters',
  );
});

test('accepts a valid password and preserves email validation', () => {
  assert.equal(validateSignup({ email: 'bad', password: 'long-enough' }), 'Email is invalid');
  assert.equal(validateSignup({ email: 'a@b.test', password: 'long-enough' }), null);
});
