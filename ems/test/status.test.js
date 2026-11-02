import test from 'node:test';
import assert from 'node:assert/strict';
import { climateStatus, modeLabel, roomClimateFeedback } from '../web/status.js';

test('klimaatfeedback meldt verzending en bevestiging afzonderlijk en accepteert geen uit als aan', () => {
  const result = { thermal: { mode: 'active', sources: [{ id: 'airco', controlRoomId: 'living', controlEnabled: true }] },
    controlStatus: { decisions: [{ origin: 'thermal', sourceId: 'airco', status: 'sent', observed: 'off', definition: { action: { type: 'climate_mode' } } }] } };
  assert.match(roomClimateFeedback(result, 'living', true).message, /Opdracht verzonden/);
  const mode = result.controlStatus.decisions[0];
  mode.status = 'stable';
  assert.equal(roomClimateFeedback(result, 'living', true).error, true);
  mode.observed = 'heat';
  assert.match(roomClimateFeedback(result, 'living', true).message, /bevestigd/);
  mode.observed = 'off';
  assert.match(roomClimateFeedback(result, 'living', false).message, /Uitschakelen bevestigd/);
  assert.equal(roomClimateFeedback(result, 'other-room', true).error, true);
  result.controlStatus.error = 'Regelcyclus geblokkeerd';
  assert.equal(roomClimateFeedback(result, 'living', true).error, true);
});

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