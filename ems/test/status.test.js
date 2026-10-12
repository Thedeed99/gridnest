import test from 'node:test';
import assert from 'node:assert/strict';
import { modeLabel } from '../web/status.js';

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