import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules, planRules, rulesSchema, validateRules } from '../src/rules.js';
import { executeRuleCommand } from '../src/home-assistant.js';
import { createRuleRunner } from '../src/rule-runner.js';

const now = Date.parse('2026-10-12T10:00:00Z');
const entity = (id, state, extra = {}) => ({ id, domain: id.split('.')[0], state: String(state), available: true, unit: 'W', reportedAt: new Date(now).toISOString(), ...extra });
const rule = (type, entityId, value, otherwise) => ({ id: 'rule', name: 'Mijn regel', enabled: true, confirmed: true, conditions: [{ entityId: 'sensor.net', operator: 'lt', value: -1000 }], action: { type, entityId, value, otherwise } });
const input = (type, id, value, otherwise, actuator) => ({ now, temperatureUnit: '°C', mappings: { batterySoc: 'sensor.soc' }, settings: rulesSchema.parse({ ...defaultRules, rules: [rule(type, id, value, otherwise)] }), entities: [entity('sensor.net', -2000), entity('sensor.soc', 50, { unit: '%' }), actuator] });

test('maximale meetouderdom ondersteunt maximaal 24 uur', () => {
  assert.equal(rulesSchema.parse({ ...defaultRules, maxAgeSeconds: 86400 }).maxAgeSeconds, 86400);
  assert.throws(() => rulesSchema.parse({ ...defaultRules, maxAgeSeconds: 86460 }));
});

test('getekende netsensor stuurt laadstart bij export en laadstop bij afname', () => {
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'off'));
  assert.equal(planRules(state)[0].command.service, 'switch.turn_on');
  state.entities[0].state = '500'; state.entities[2].state = 'on';
  assert.equal(planRules(state)[0].command.service, 'switch.turn_off');
});

test('stroomregel kan een actie uitvoeren als een van twee metingen klopt', () => {
  const definition = {
    ...rule('switch_control', 'switch.boiler', 'on', 'off'),
    conditionMode: 'any',
    conditions: [
      { entityId: 'sensor.meter_one', operator: 'gt', value: 10 },
      { entityId: 'sensor.meter_two', operator: 'gt', value: 10 }
    ]
  };
  const settings = rulesSchema.parse({ ...defaultRules, rules: [definition] });
  const entities = [entity('sensor.meter_one', 0), entity('sensor.meter_two', 0), entity('switch.boiler', 'on')];
  const plan = () => planRules({ now, settings, entities, mappings: {}, temperatureUnit: '°C' })[0];

  assert.equal(plan().command.service, 'switch.turn_off');
  entities[2].state = 'off';
  entities[0].state = '15';
  assert.equal(plan().command.service, 'switch.turn_on');
  entities[0].state = '0'; entities[1].state = '15';
  assert.equal(plan().command.service, 'switch.turn_on');
  entities[2].state = 'on';
  entities[1].state = '0';
  assert.equal(plan().command.service, 'switch.turn_off');
  assert.equal(rulesSchema.parse({ ...defaultRules, rules: [rule('switch_control', 'switch.boiler', 'on', 'off')] }).rules[0].conditionMode, 'all');
});

test('oude of ontbrekende voorwaarde veroorzaakt nooit een anders-opdracht', () => {
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'on'));
  state.entities[0].reportedAt = '2026-10-11T00:00:00Z';
  assert.equal(planRules(state)[0].command, null);
  assert.equal(planRules(state)[0].status, 'blocked');
});

test('beschikbare actuator blijft bedienbaar als zijn toestand al langer onveranderd is', async () => {
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'off'));
  state.entities[2].reportedAt = '2026-10-11T00:00:00Z';
  state.entities[2].changedAt = '2026-10-11T00:00:00Z';
  assert.equal(planRules(state)[0].command.service, 'switch.turn_on');
  const config = { control: { ...state.settings, mode: 'active' }, mappings: state.mappings };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(config) }, provider: async () => ({ connected: true, entities: state.entities }),
    unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => now });
  assert.equal((await runner.tick()).decisions[0].status, 'sent');
  assert.equal(sent.length, 1);
});

test('handmatig inschakelen pauzeert een actieve stroomregel niet', async () => {
  const definition = { ...rule('switch_control', 'switch.boiler', 'off', 'keep'), conditions: [{ entityId: 'sensor.boiler_power', operator: 'gt', value: 10 }] };
  const settings = rulesSchema.parse({ ...defaultRules, rules: [definition] });
  const entities = [entity('sensor.boiler_power', 1500), entity('switch.boiler', 'off', { changedAt: new Date(now - 3600000).toISOString() })];
  const config = { control: { ...settings, mode: 'active' }, mappings: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(config) }, provider: async () => ({ connected: true, entities: entities.map(item => ({ ...item, reportedAt: new Date(now).toISOString() })) }),
    unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => now });
  assert.equal((await runner.tick()).decisions[0].status, 'stable');
  entities[1].state = 'on';
  const result = await runner.tick();
  assert.equal(result.decisions[0].status, 'sent');
  assert.equal(sent[0].service, 'switch.turn_off');
});

test('wachttijd stelt dan-actie uit en anders niets doen laat apparaat met rust', async () => {
  const definition = { ...rule('switch_control', 'switch.boiler', 'off', 'keep'), delayMinutes: 30, conditions: [{ entityId: 'sensor.boiler_power', operator: 'gt', value: 10 }] };
  const settings = rulesSchema.parse({ ...defaultRules, rules: [definition] });
  const entities = [entity('sensor.boiler_power', 0), entity('switch.boiler', 'off')];
  const ruleMemory = new Map();
  const plan = time => planRules({ now: time, settings, entities: entities.map(item => ({ ...item, reportedAt: new Date(time).toISOString() })), mappings: {}, temperatureUnit: '°C', ruleMemory })[0];
  assert.equal(plan(now).command, null);
  entities[0].state = '1500'; entities[1].state = 'on';
  assert.equal(plan(now).command, null);
  assert.match(plan(now + 29 * 60000).reason, /nog 1 min/);
  assert.equal(plan(now + 30 * 60000).command.service, 'switch.turn_off');
  entities[0].state = '0'; entities[1].state = 'off';
  assert.equal(plan(now + 31 * 60000).command, null);
  assert.throws(() => rulesSchema.parse({ ...defaultRules, rules: [{ ...definition, action: { ...definition.action, value: 'keep' } }] }));

  let clockTime = now;
  const config = { control: { ...settings, mode: 'active' }, mappings: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(config) }, provider: async () => ({ connected: true, entities: entities.map(item => ({ ...item, reportedAt: new Date(clockTime).toISOString(), changedAt: new Date(now - 3600000).toISOString() })) }),
    unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => clockTime });
  await runner.tick();
  entities[0].state = '1500'; entities[1].state = 'on'; clockTime += 60000;
  assert.equal((await runner.tick()).decisions[0].status, 'stable');
  clockTime += 30 * 60000;
  assert.equal((await runner.tick()).decisions[0].status, 'sent');
  assert.equal(sent[0].service, 'switch.turn_off');
});

test('stroomlimiet en PV-limiet respecteren eenheid, min/max en stap', () => {
  const amps = input('ev_current', 'number.amps', 12, 6, entity('number.amps', 6, { unit: 'A', minimum: 6, maximum: 16, step: 1 }));
  assert.equal(planRules(amps)[0].command.value, 12);
  amps.entities[2].maximum = 10;
  assert.equal(planRules(amps)[0].command, null);
  const pv = input('pv_limit', 'number.pv', 70, 100, entity('number.pv', 100, { unit: '%', minimum: 0, maximum: 100, step: 1 }));
  assert.equal(planRules(pv)[0].command.value, 70);
});

test('batterijvermogen volgt tekenrichting, eenheid en SoC-grenzen', () => {
  const state = input('battery_power', 'number.battery', 500, 0, entity('number.battery', 1, { unit: 'kW', minimum: -5, maximum: 5, step: 0.1 }));
  assert.equal(planRules(state)[0].command.value, 0.5);
  state.entities[1].state = '95';
  assert.equal(planRules(state)[0].command.value, 0);
  state.settings.rules[0].action.value = -500; state.entities[1].state = '20';
  assert.equal(planRules(state)[0].command.value, 0);
  state.entities[1].state = '50'; state.settings.rules[0].action.batteryDirection = 'positive-discharge';
  assert.equal(planRules(state)[0].command.value, 0.5);
});

test('stroomregels ondersteunen tekstsensoren zoals KNMI weercode en battery_enable', () => {
  const weatherRule = {
    id: 'knmi_charge',
    name: 'KNMI Noodlading',
    enabled: true,
    confirmed: true,
    conditions: [
      { entityId: 'sensor.thuis_weercode', operator: 'contains', value: 'oranje, rood' },
      { entityId: 'sensor.soc', operator: 'lt', value: 80 }
    ],
    action: {
      type: 'battery_enable',
      entityId: 'switch.battery_charge',
      value: 'on',
      otherwise: 'off',
      batteryDirection: 'positive-charge'
    }
  };
  const settings = rulesSchema.parse({ ...defaultRules, rules: [weatherRule] });
  const entities = [
    entity('sensor.thuis_weercode', 'Code oranje', { unit: '' }),
    entity('sensor.soc', 65, { unit: '%' }),
    entity('switch.battery_charge', 'off')
  ];
  validateRules(settings, entities);
  const plan = planRules({ now, settings, entities, mappings: {}, temperatureUnit: '°C' });
  assert.equal(plan[0].status, 'planned');
  assert.equal(plan[0].command.service, 'switch.turn_on');

  // Als weer code groen is, schakelt hij uit
  entities[0].state = 'Code groen';
  entities[2].state = 'on';
  const planGreen = planRules({ now, settings, entities, mappings: {}, temperatureUnit: '°C' });
  assert.equal(planGreen[0].status, 'planned');
  assert.equal(planGreen[0].command.service, 'switch.turn_off');
});

test('thermostaatdoelen vereisen Celsius en bevestigde capabilities', () => {
  const state = input('climate_temperature', 'climate.cv', 21, 17, entity('climate.cv', 'heat', { targetTemperature: 20, targetStepC: 0.5, minTempC: 7, maxTempC: 35, supportedFeatures: 1 }));
  assert.equal(planRules(state)[0].command.value, 21);
  state.temperatureUnit = '°F';
  assert.equal(planRules(state)[0].command, null);
});

test('thermostaat zonder target_temp_step gebruikt Celsiusprecisie van Home Assistant', () => {
  const state = input('climate_temperature', 'climate.tado', 19.5, 17, entity('climate.tado', 'heat', { targetTemperature: 18, minTempC: 5, maxTempC: 25, supportedFeatures: 385 }));
  assert.equal(planRules(state)[0].command.value, 19.5);
});

test('bedieningsregels staan standaard uit en vragen bevestiging', () => {
  assert.equal(defaultRules.mode, 'off');
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'off'));
  state.settings.rules[0].confirmed = false;
  assert.equal(planRules(state)[0].command, null);
});

test('tegenstrijdige regels, verkeerde actuator en gevaarlijke waarden worden geweigerd', () => {
  const state = input('ev_current', 'number.amps', 12, 6, entity('number.amps', 6, { unit: 'A', minimum: 6, maximum: 16, step: 1 }));
  assert.throws(() => rulesSchema.parse({ ...state.settings, rules: [state.settings.rules[0], { ...state.settings.rules[0], id: 'other' }] }));
  assert.throws(() => validateRules({ ...state.settings, rules: [rule('ev_current', 'sensor.net', 12, 6)] }, state.entities));
  assert.throws(() => rulesSchema.parse({ ...state.settings, reserveSoc: 99, maxSoc: 95 }));
});

function runnerFixture(mode, execute = async () => {}) {
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'off', { changedAt: new Date(now - 3600000).toISOString() }));
  state.settings.mode = mode;
  const config = { control: state.settings, mappings: state.mappings };
  const runner = createRuleRunner({ store: { get: () => structuredClone(config) }, provider: async () => ({ connected: true, entities: state.entities }), unitProvider: async () => '°C', execute, activeAllowed: true, clock: () => now });
  return { runner, state, config };
}

test('proefmodus verzendt nooit opdrachten, actieve modus vraagt terugmelding', async () => {
  const sent = [];
  const preview = runnerFixture('preview', async value => { sent.push(value); });
  await preview.runner.tick();
  assert.equal(sent.length, 0);
  const active = runnerFixture('active', async value => { sent.push(value); });
  assert.equal((await active.runner.tick()).decisions[0].status, 'sent');
  assert.equal((await active.runner.tick()).decisions[0].status, 'waiting');
  assert.equal(sent.length, 1);
});

test('handmatige wijziging pauzeert niet en transportfouten worden niet herhaald', async () => {
  const { runner, state } = runnerFixture('active');
  await runner.tick();
  state.entities[2].state = 'on';
  await runner.tick();
  state.entities[2].state = 'off';
  const manualChange = (await runner.tick()).decisions[0];
  assert.equal(manualChange.status, 'waiting');
  assert.match(manualChange.reason, /Minimale tijd tussen opdrachten/);
  let attempts = 0;
  const failure = runnerFixture('active', async () => { attempts++; throw new Error('timeout'); });
  await failure.runner.tick(); await failure.runner.tick();
  assert.equal(attempts, 1);
});

test('transport gebruikt alleen toegestane services via de Supervisor en weigert onbekende opdrachten', async () => {
  const env = { SUPERVISOR_TOKEN: 'test-only', CONTROL_ENABLED: 'true' };
  await executeRuleCommand({ entityId: 'number.limit', service: 'number.set_value', value: 70 }, env, async (url, options) => {
    assert.equal(url, 'http://supervisor/core/api/services/number/set_value');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { entity_id: 'number.limit', value: 70 });
    return { ok: true };
  });
  await executeRuleCommand({ entityId: 'climate.airco', service: 'climate.set_fan_mode', value: 'Low' }, env, async (url, options) => {
    assert.equal(url, 'http://supervisor/core/api/services/climate/set_fan_mode');
    assert.deepEqual(JSON.parse(options.body), { entity_id: 'climate.airco', fan_mode: 'Low' });
    return { ok: true };
  });
  await executeRuleCommand({ entityId: 'climate.airco', service: 'climate.set_hvac_mode', value: 'cool' }, env, async (url, options) => {
    assert.equal(url, 'http://supervisor/core/api/services/climate/set_hvac_mode');
    assert.deepEqual(JSON.parse(options.body), { entity_id: 'climate.airco', hvac_mode: 'cool' });
    return { ok: true };
  });
  await assert.rejects(executeRuleCommand({ entityId: 'climate.airco', service: 'climate.set_fan_mode', value: '' }, env));
  await assert.rejects(executeRuleCommand({ entityId: 'switch.ev', service: 'homeassistant.restart', value: 0 }, env));
  await assert.rejects(executeRuleCommand({ entityId: 'climate.cv', service: 'climate.set_temperature', value: 50 }, env));
  await assert.rejects(executeRuleCommand({ entityId: 'switch.ev', service: 'switch.turn_on', value: 'on' }, {}));
});

test('prioriteiten bepalen uitvoervolgorde zonder de opgeslagen volgorde te wijzigen', () => {
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'off'));
  state.entities.push(entity('switch.other', 'off'));
  const normal = { ...state.settings.rules[0], priority: 80 };
  const urgent = { ...normal, id: 'urgent', priority: 1, action: { ...normal.action, entityId: 'switch.other' } };
  state.settings = rulesSchema.parse({ ...state.settings, rules: [normal, urgent] });
  assert.deepEqual(planRules(state).map(decision => decision.id), ['urgent', 'rule']);
  assert.deepEqual(state.settings.rules.map(rule => rule.id), ['rule', 'urgent']);
});

test('bestaande regels krijgen prioriteit 50; gelijke prioriteit bewaart invoervolgorde', () => {
  const state = input('ev_enable', 'switch.ev', 'on', 'off', entity('switch.ev', 'off'));
  assert.equal(state.settings.rules[0].priority, 50);
  const second = { ...state.settings.rules[0], id: 'second', enabled: false };
  state.settings.rules.push(second);
  assert.deepEqual(planRules(state).map(decision => decision.id), ['rule', 'second']);
  assert.throws(() => rulesSchema.parse({ ...state.settings, rules: [{ ...second, priority: 0 }] }));
  assert.throws(() => rulesSchema.parse({ ...state.settings, rules: [{ ...second, priority: 101 }] }));
});

test('de actieve runner verstuurt eerst de vier hoogste prioriteiten en laat de rest wachten', async () => {
  const sent = [];
  const priorities = [90, 10, 40, 1, 20];
  const settings = rulesSchema.parse({ ...defaultRules, mode: 'active', rules: priorities.map((priority, index) => ({
    ...rule('ev_enable', `switch.ev_${index}`, 'on', 'off'), id: `rule_${index}`, priority
  })) });
  const config = { control: settings, mappings: {} };
  const entities = [entity('sensor.net', -2000), ...priorities.map((_, index) => entity(`switch.ev_${index}`, 'off', { changedAt: new Date(now - 3600000).toISOString() }))];
  const runner = createRuleRunner({ store: { get: () => structuredClone(config) }, provider: async () => ({ connected: true, entities }), unitProvider: async () => '°C', execute: async command => { sent.push(command.entityId); }, activeAllowed: true, clock: () => now });
  const status = await runner.tick();
  assert.deepEqual(sent, ['switch.ev_3', 'switch.ev_1', 'switch.ev_4', 'switch.ev_2']);
  assert.equal(status.decisions.find(decision => decision.id === 'rule_0').status, 'waiting');
});