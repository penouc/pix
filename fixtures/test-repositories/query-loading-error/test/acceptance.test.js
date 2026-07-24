import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProfileView } from '../src/profileView.js';

test('renders loading state', () => {
  assert.equal(renderProfileView({ isLoading: true }), 'Loading profile...');
});

test('renders error state', () => {
  assert.equal(renderProfileView({ error: new Error('offline') }), 'Could not load profile');
});

test('preserves successful state', () => {
  assert.equal(renderProfileView({ data: { name: 'Ada' } }), 'Hello, Ada');
});
