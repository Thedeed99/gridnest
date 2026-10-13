import test from 'node:test';
import assert from 'node:assert/strict';
import { climateStatus, modeLabel } from '../web/status.js';

test('sidebar hides Proefmodus when live control has been released', () => {
  assert.equal(modeLabel({ demo: false, activeAllowed: true, mode: 'preview' }), 'Sturing vrijgegeven');
  assert.equal(modeLabel({ demo: false, activeAllowed: true, mode: 'off' }), 'Sturing vrijgegeven');
  assert.equal(modeLabel({ demo: false, activeAllowed: true, mode: 'active' }), 'Actieve regels');
});

test('sidebar preserves safe status labels when live control is not released', () => {
  assert.equal(modeLabel({ demo: true, activeAllowed: false, mode: 'off' }), 'Demomodus');
  assert.equal(modeLabel({ demo: false, activeAllowed: false, mode: 'preview' }), 'Proefmodus');
  assert.equal(modeLabel({ demo: false, activeAllowed: false, mode: 'off' }), 'Regels uit');
});

test('climate status distinguishes actual activity from the configured mode', () => {
  const base = { available: true, mode: 'heat' };
  assert.equal(climateStatus({ ...base, action: 'idle' }), 'Stand-by');
  assert.equal(climateStatus({ ...base, action: 'heating' }), 'Verwarmt');
  assert.equal(climateStatus({ ...base, action: null }), 'Verwarmmodus');
  assert.equal(climateStatus({ available: true, mode: 'cool' }), 'Koelmodus');
  assert.equal(climateStatus({ available: true, mode: 'cool', action: 'cooling' }), 'Koelt');
  assert.equal(climateStatus({ available: true, mode: 'off', action: 'off' }), 'Uit');
  assert.equal(climateStatus({ ...base, available: false, action: 'heating' }), 'Niet beschikbaar');
  assert.equal(climateStatus({ available: true, mode: 'unknown' }), 'Status onbekend');
});