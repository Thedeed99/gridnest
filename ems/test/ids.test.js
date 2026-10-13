import test from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../web/ids.js';

test('ID creation falls back to Web Crypto when randomUUID is unavailable', () => {
  const id = createId({ getRandomValues: bytes => bytes.fill(0) });
  assert.equal(id, '00000000-0000-4000-8000-000000000000');
});

test('ID creation uses randomUUID when supported', () => {
  assert.equal(createId({ randomUUID: () => 'native-id' }), 'native-id');
});