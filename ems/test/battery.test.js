import test from 'node:test';
import assert from 'node:assert/strict';
import { batteryState } from '../web/battery.js';

test('batterijstatus onderscheidt doorvoer en laden zonder onbekende codes te raden', () => {
  assert.deepEqual(batteryState({ available: true, state: 'pass_through' }, 500), { label: 'Doorvoer', powerW: 0 });
  assert.equal(batteryState({ available: true, state: 'DISCHARGING' }, 500).powerW, -500);
  assert.equal(batteryState({ available: true, state: 'Charging' }, -500).powerW, 500);
  assert.equal(batteryState({ available: true, state: '2' }, 500).powerW, null);
  assert.equal(batteryState({ available: false }, 500).powerW, null);
  assert.equal(batteryState(null, 500).label, 'Laden');
});

test('unused betekent doorvoer bij de UPS en draagt geen laadvermogen bij', () => {
  for (const state of ['unused', ' UNUSED ', 'unusued']) {
    assert.deepEqual(batteryState({ available: true, state }, 500), { label: 'Doorvoer', powerW: 0 });
  }
});