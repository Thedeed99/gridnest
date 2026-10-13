import test from 'node:test';
import assert from 'node:assert/strict';
import { householdPresence } from '../src/thermal.js';
import { normalizeStates } from '../src/home-assistant.js';
import { defaultPreferences, preferencesSchema } from '../src/store.js';

const now = Date.parse('2026-10-12T10:00:00Z');
const person = (id, state, extra = {}) => ({ id, name: id, domain: 'person', state, available: !['unknown', 'unavailable'].includes(state), reportedAt: new Date(now).toISOString(), ...extra });
const preferences = { ...defaultPreferences, presenceEntities: ['person.first', 'person.second'] };

test('minstens een thuis: een aanwezige persoon weegt op tegen afwezige of onbekende personen', () => {
  assert.equal(householdPresence(preferences, [person('person.first', 'home'), person('person.second', 'not_home')]).occupied, true);
  assert.equal(householdPresence(preferences, [person('person.first', 'home')]).occupied, true);
  assert.equal(householdPresence(preferences, [person('person.first', 'not_home'), person('person.second', 'Werk')]).occupied, false);
});

test('onbekende aanwezigheid wordt niet als iedereen afwezig beschouwd', () => {
  assert.equal(householdPresence(preferences, [person('person.first', 'not_home')]).occupied, null);
  assert.equal(householdPresence(preferences, []).occupied, null);
  assert.equal(householdPresence(defaultPreferences, []).occupied, null);
});

test('iedereen thuis is een expliciete andere keuze en een beschikbare status heeft geen timer', () => {
  const all = { ...preferences, presenceMode: 'all' };
  assert.equal(householdPresence(all, [person('person.first', 'home'), person('person.second', 'home')]).occupied, true);
  assert.equal(householdPresence(all, [person('person.first', 'home'), person('person.second', 'not_home')]).occupied, false);
  assert.equal(householdPresence(all, [person('person.first', 'home')]).occupied, null);
  assert.equal(householdPresence(preferences, [person('person.first', 'home', { reportedAt: '2026-10-11T00:00:00Z' })], now).occupied, true);
});

test('Home Assistant personen worden ingelezen en dubbele keuzen geweigerd', () => {
  const states = normalizeStates([{ entity_id: 'person.first', state: 'home', last_updated: new Date(now).toISOString(), attributes: { friendly_name: 'Persoon 1', latitude: 52 } }]);
  assert.equal(states[0].domain, 'person');
  assert.ok(!JSON.stringify(states).includes('latitude'));
  assert.throws(() => preferencesSchema.parse({ ...defaultPreferences, presenceEntities: ['person.first', 'person.first'] }));
});