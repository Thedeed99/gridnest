import test from 'node:test';
import assert from 'node:assert/strict';
import { thermalSchema } from '../src/store.js';
import { defaultRules } from '../src/rules.js';
import { planThermal, validateThermal } from '../src/thermal.js';
import { solarTarget } from '../src/thermal-solar.js';
import { createRuleRunner } from '../src/rule-runner.js';

const now = Date.parse('2026-10-12T10:00:00Z');
function fixture() {
  return { now, settings: defaultRules, mappings: {}, temperatureUnit: '°C', thermal: thermalSchema.parse({
    sources: [{ id: 'cv', name: 'CV', entityId: 'climate.cv', profile: 'radiators', controlEnabled: true, confirmed: true, controlRoomId: 'living' }],
    rooms: [{ id: 'living', name: 'Woonkamer', floor: 'Begane grond', temperatureEntity: 'sensor.temperature', presenceEntity: null, targetC: 21, sourceIds: ['cv'] }]
  }), entities: [
    { id: 'sensor.temperature', domain: 'sensor', unit: '°C', available: true, state: '19', reportedAt: new Date(now).toISOString() },
    { id: 'climate.cv', domain: 'climate', available: true, state: 'off', targetTemperature: 20, hvacModes: ['heat', 'off'], supportedFeatures: 1, minTempC: 7, maxTempC: 30, targetStepC: 0.5, reportedAt: new Date(now).toISOString() }
  ] };
}

test('Warmte zet het kamerdoel om in een thermostaatopdracht, ook zonder gebruikersregels', () => {
  const plans = planThermal(fixture());
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].command, { entityId: 'climate.cv', service: 'climate.set_temperature', value: 21 });
});

test('verwarmmodus volgt pas nadat het juiste temperatuurdoel wordt teruggemeld', () => {
  const input = fixture(); input.entities[1].targetTemperature = 21;
  const plans = planThermal(input);
  assert.equal(plans[0].status, 'stable');
  assert.equal(plans[1].command.service, 'climate.set_hvac_mode');
  assert.equal(plans[1].command.value, 'heat');
});

test('monitor-only, onbevestigde bronnen en ontbrekende of oude sensoren sturen niet', () => {
  const input = fixture(); input.thermal.sources[0].controlEnabled = false;
  assert.deepEqual(planThermal(input), []);
  input.thermal.sources[0].controlEnabled = true; input.thermal.sources[0].confirmed = false;
  assert.equal(planThermal(input)[0].command, null);
  input.thermal.sources[0].confirmed = true; input.entities[0].reportedAt = '2026-10-11T00:00:00Z';
  assert.equal(planThermal(input)[0].command, null);
});

test('een bron heeft een gekoppelde regelkamer, bestaande configuraties blijven monitor-only', () => {
  assert.equal(thermalSchema.parse({ sources: [], rooms: [] }).mode, 'off');
  const input = fixture(); input.thermal.sources[0].controlRoomId = 'missing';
  assert.throws(() => thermalSchema.parse(input.thermal));
  assert.equal(planThermal(input)[0].status, 'blocked');
});

function sunnyFixture() {
  const input = fixture();
  input.thermal.sources[0].profile = 'airco';
  input.thermal.sources[0].solar = { ...input.thermal.sources[0].solar, enabled: true, powerEntity: 'sensor.airco' };
  input.mappings = { gridMode: 'signed', gridDirection: 'positive-import', gridPower: 'sensor.net', solar: 'sensor.pv', batteryMode: 'none' };
  for (const [id, state] of [['sensor.net', -2000], ['sensor.pv', 4000], ['sensor.airco', 0]]) input.entities.push({ id, domain: 'sensor', available: true, state: String(state), unit: 'W', reportedAt: new Date(now).toISOString() });
  return { ...input, source: input.thermal.sources[0], baseTarget: 21, maxAge: 900 };
}

test('zonneboost wacht, corrigeert extra aircoverbruik en stopt vertraagd bij echt tekort', () => {
  const input = sunnyFixture();
  let result = solarTarget(input);
  assert.equal(result.targetC, 21);
  input.now += 300000; input.entities.forEach(entity => { entity.reportedAt = new Date(input.now).toISOString(); });
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 22);
  input.entities.find(entity => entity.id === 'sensor.net').state = '-100';
  input.entities.find(entity => entity.id === 'sensor.airco').state = '1800';
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 22);
  assert.equal(result.surplusW, 1900);
  input.entities.find(entity => entity.id === 'sensor.net').state = '2000';
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 22);
  input.now += 300000; input.entities.forEach(entity => { entity.reportedAt = new Date(input.now).toISOString(); });
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 21);
});

test('nacht, ontbrekende metingen en ontladende batterij geven het gewone comfortdoel', () => {
  const input = sunnyFixture();
  assert.equal(solarTarget({ ...input, now: Date.parse('2026-10-12T22:00:00Z'), previous: { active: true } }).targetC, 21);
  input.entities.find(entity => entity.id === 'sensor.net').available = false;
  assert.equal(solarTarget({ ...input, previous: { active: true } }).active, false);
  input.entities.find(entity => entity.id === 'sensor.net').available = true;
  input.mappings.batteryMode = 'unknown';
  assert.equal(solarTarget(input).active, false);
});

test('extra temperatuur blijft begrensd en een andere airco kan niet tegelijk een boost starten', () => {
  const input = sunnyFixture(); input.entities[1].maxTempC = 21.5;
  input.solarMemory = new Map([['cv', { active: true, basePower: 0 }]]);
  assert.equal(planThermal(input)[0].command.value, 21.5);
  assert.equal(solarTarget({ ...input, allowStart: false }).next.active, false);
  assert.throws(() => thermalSchema.parse({ ...input.thermal, sources: [{ ...input.source, solar: { ...input.source.solar, stopW: 2000, startW: 1000 } }] }));
});

test('Warmte is aangesloten op de uitvoerlaag, onafhankelijk van Stroom', async () => {
  const input = fixture(); input.thermal.mode = 'active';
  input.entities[1].changedAt = new Date(now - 3600000).toISOString();
  const snapshot = { control: defaultRules, thermal: input.thermal, mappings: {}, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async command => { sent.push(command); }, activeAllowed: true, clock: () => now });
  await runner.tick();
  assert.equal(sent[0].service, 'climate.set_temperature');
  assert.equal(sent[0].value, 21);
  assert.equal((await runner.tick()).decisions[0].status, 'waiting');
  input.entities[1].targetTemperature = 21;
  await runner.tick();
  assert.equal(sent[1].service, 'climate.set_hvac_mode');
});

test('proefmodus stuurt niets en dubbele thermostaatbediening wordt geblokkeerd', async () => {
  const input = fixture(); input.thermal.mode = 'preview';
  const snapshot = { control: { ...defaultRules, mode: 'preview', rules: [{ id: 'legacy', name: 'Oude thermostaatregel', enabled: true, confirmed: true, priority: 50, conditions: [{ entityId: 'sensor.temperature', operator: 'gt', value: 0 }], action: { type: 'climate_temperature', entityId: 'climate.cv', value: 22, otherwise: 17 } }] }, thermal: input.thermal, mappings: {} };
  let calls = 0;
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async () => { calls++; }, activeAllowed: true, clock: () => now });
  const result = await runner.tick();
  assert.equal(calls, 0);
  assert.ok(result.decisions.every(decision => decision.status === 'blocked'));
});

test('net- en productiemeters kunnen niet als aircoverbruik worden gekoppeld', () => {
  const input = sunnyFixture(); input.source.solar.powerEntity = 'sensor.pv';
  assert.throws(() => validateThermal(input.thermal, input.entities, input.mappings));
  input.source.solar.powerEntity = 'sensor.airco';
  assert.doesNotThrow(() => validateThermal(input.thermal, input.entities, input.mappings));
});

test('batterijontlading wordt niet als zonoverschot benut voor extra warmte', () => {
  const input = sunnyFixture();
  input.mappings.batteryMode = 'measured'; input.mappings.batteryPower = 'sensor.battery';
  input.mappings.batteryDirection = 'positive-charge';
  input.entities.push({ id: 'sensor.battery', domain: 'sensor', available: true, unit: 'W', state: '-500', reportedAt: new Date(now).toISOString() });
  assert.equal(solarTarget({ ...input, previous: { active: true } }).active, false);
});

test('zonneboost geeft altijd basis 21 plus 1, nooit telkens een extra graad bovenop het apparaatdoel', () => {
  const input = sunnyFixture();
  input.solarMemory = new Map([['cv', { active: true, basePower: 0 }]]);
  input.entities[1].targetTemperature = 21;
  assert.equal(planThermal(input)[0].command.value, 22);
  input.entities[1].targetTemperature = 22;
  assert.equal(planThermal(input)[0].command, null);
  assert.equal(planThermal(input)[0].targetC, 22);
  assert.equal(input.thermal.rooms[0].targetC, 21);
});

test('gezamenlijke afwezigheid verlaagt een expliciet gekozen kamer zonder zonneboost', () => {
  const input = sunnyFixture();
  input.thermal.rooms[0].presenceControl = true;
  input.preferences = { presenceEntities: ['person.first', 'person.second'], presenceMode: 'any', awayC: 17 };
  for (const id of input.preferences.presenceEntities) input.entities.push({ id, domain: 'person', state: 'not_home', available: true, reportedAt: new Date(now).toISOString() });
  input.solarMemory = new Map([['cv', { active: true, basePower: 0 }]]);
  assert.equal(planThermal(input)[0].command.value, 17);
  input.entities.find(entity => entity.id === 'person.first').state = 'home';
  assert.equal(planThermal(input)[0].command.value, 22);
  input.entities.find(entity => entity.id === 'person.first').state = 'not_home';
  input.entities.find(entity => entity.id === 'person.second').available = false;
  assert.equal(planThermal(input)[0].status, 'blocked');
});

test('de aangesloten runner neemt gezamenlijke aanwezigheid mee in het werkelijke thermostaatdoel', async () => {
  const input = fixture(); input.thermal.mode = 'active'; input.thermal.rooms[0].presenceControl = true;
  input.entities.push({ id: 'person.first', domain: 'person', state: 'not_home', available: true, reportedAt: new Date(now).toISOString() });
  const snapshot = { control: defaultRules, thermal: input.thermal, mappings: {}, preferences: { presenceEntities: ['person.first'], presenceMode: 'any', awayC: 17 } };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async command => { sent.push(command); }, activeAllowed: true, clock: () => now });
  await runner.tick();
  assert.equal(sent[0].value, 17);
});