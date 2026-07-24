import assert from 'node:assert/strict';
import test from 'node:test';
import { greeting } from '../src/greeting.js';
import { label } from '../src/label.js';

test('baseline public behavior is defined', () => {
  assert.equal(greeting(' Ada '), 'Hello, ada');
  assert.equal(label(' Ada '), '[ada]');
});
