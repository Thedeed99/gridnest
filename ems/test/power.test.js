import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPower } from '../web/power.js';

test('power display toggle formats W with Dutch thousands separators', () => {
  assert.equal(formatPower(1.234, 'W'), '1.234 W');
  assert.equal(formatPower(12.345, 'W'), '12.345 W');
  assert.equal(formatPower(1.234, 'kW'), '1,23 kW');
  assert.equal(formatPower(null, 'W'), 'Niet beschikbaar');
});