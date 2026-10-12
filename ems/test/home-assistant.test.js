import test from 'node:test';
import assert from 'node:assert/strict';
import { compatible, emptyMappings, normalizeStates, readEntities, readings, roles, validateMappings } from '../src/home-assistant.js';
import { demoEntities } from '../src/demo.js';

const state = (entity_id, unit = 'W', value = '1200', attributes = {}) => ({
  entity_id, state: value, attributes: { friendly_name: 'Mijn apparaat', unit_of_measurement: unit, ...attributes },
  last_updated: '2026-10-12T08:00:00Z'
});

test('power picker accepteert W en kW maar geen energieteller', () => {
  const entities = normalizeStates([state('sensor.power'), state('sensor.energy', 'kWh'), state('sensor.kw', 'kW')]);
  assert.deepEqual(entities.filter(entity => compatible(roles[0], entity)).map(entity => entity.id), ['sensor.power', 'sensor.kw']);
});

test('aanwezigheid accepteert geen deur- of storingssensor', () => {
  const entities = normalizeStates([state('binary_sensor.door', '', 'on', { device_class: 'door' }), state('binary_sensor.home', '', 'on', { device_class: 'occupancy' })]);
  assert.equal(compatible(roles.at(-1), entities[0]), false);
  assert.equal(compatible(roles.at(-1), entities[1]), true);
});

test('koppelingen worden gecontroleerd op type, bestaan en dubbel netgebruik', () => {
  const entities = normalizeStates([state('sensor.power'), state('sensor.energy', 'kWh')]);
  assert.equal(validateMappings({ ...emptyMappings, solar: 'sensor.power' }, entities).solar, 'sensor.power');
  assert.throws(() => validateMappings({ ...emptyMappings, solar: 'sensor.missing' }, entities));
  assert.throws(() => validateMappings({ ...emptyMappings, solar: 'sensor.energy' }, entities));
  assert.throws(() => validateMappings({ ...emptyMappings, gridImport: 'sensor.power', gridExport: 'sensor.power' }, entities));
  assert.throws(() => validateMappings({ ...emptyMappings, token: 'secret' }, entities));
});

test('onbekende en ongeldige meetwaarden worden niet als nul gepresenteerd', () => {
  for (const value of ['unknown', 'unavailable', 'abc', '']) {
    const result = readings({ ...emptyMappings, solar: 'sensor.power' }, normalizeStates([state('sensor.power', 'W', value)]));
    assert.equal(result.find(item => item.role === 'solar').valid, false);
  }
});

test('zonder token worden geen netwerkverzoeken uitgevoerd', async () => {
  const result = await readEntities({}, () => { throw new Error('Geen netwerk verwacht'); });
  assert.equal(result.connected, false);
});

test('add-on gebruikt Supervisor proxy en voert uitsluitend GET uit', async () => {
  const result = await readEntities({ SUPERVISOR_TOKEN: 'test-only' }, async (url, options) => {
    assert.equal(url.href, 'http://supervisor/core/api/states');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => [state('sensor.power')] };
  });
  assert.equal(result.entities.length, 1);
});

test('externe verbinding lekt geen token of attributen in antwoord', async () => {
  const result = await readEntities({ HA_TOKEN: 'test-only', HA_URL: 'https://example.test/api' }, async url => {
    assert.equal(url.href, 'https://example.test/api/states');
    return { ok: true, json: async () => [state('sensor.power', 'W', '0', { secret: 'do-not-expose' })] };
  });
  assert.ok(!JSON.stringify(result).includes('test-only'));
  assert.ok(!JSON.stringify(result).includes('do-not-expose'));
});

test('API-fout blijft fout en valt niet stil terug op demodata', async () => {
  await assert.rejects(readEntities({ SUPERVISOR_TOKEN: 'test-only' }, async () => ({ ok: false, status: 401 })), /401/);
});

test('gasmeter vereist kubieke meters en een cumulatieve meterstand', () => {
  const gasRole = roles.find(role => role.id === 'gasConsumption');
  const entities = normalizeStates([
    state('sensor.gas_total', 'm³', '1250', { state_class: 'total_increasing' }),
    state('sensor.gas_flow', 'm³', '0.02', { state_class: 'measurement' })
  ]);
  assert.equal(validateMappings({ ...emptyMappings, gasConsumption: 'sensor.gas_total' }, entities).gasConsumption, 'sensor.gas_total');
  assert.equal(compatible(gasRole, entities[0]), true);
  assert.throws(() => validateMappings({ ...emptyMappings, gasConsumption: 'sensor.gas_flow' }, entities), /cumulatieve meterstand/);
});

test('fase-entiteiten vereisen de juiste ampere- en voltage-eenheden', () => {
  const entities = normalizeStates([
    state('sensor.l1_current', 'A', '5'), state('sensor.l1_voltage', 'V', '230'),
    state('sensor.l2_current', 'W', '500')
  ]);
  const mapped = validateMappings({ ...emptyMappings, phase1Current: 'sensor.l1_current', phase1Voltage: 'sensor.l1_voltage' }, entities);
  assert.equal(mapped.phase1Current, 'sensor.l1_current');
  assert.throws(() => validateMappings({ ...emptyMappings, phase2Current: 'sensor.l2_current' }, entities));
});

test('accuhealth accepteert een optionele sensor in procenten', () => {
  const health = normalizeStates([state('sensor.battery_health', '%', '96', { device_class: 'battery' })])[0];
  assert.equal(compatible(roles.find(role => role.id === 'batteryHealth'), health), true);
  assert.equal(compatible(roles.find(role => role.id === 'batteryHealth'), normalizeStates([state('sensor.battery_health', 'W', '96')])[0]), false);
});

test('optionele EV-, accu- en zonnebediening koppelingen valideren domein en eenheid', () => {
  const entities = normalizeStates([
    state('binary_sensor.ev_cable', '', 'on'),
    state('lock.ev_cable', '', 'locked'),
    state('sensor.ev_session', 'kWh', '3.2'),
    state('sensor.ev_l1', 'A', '16'),
    state('switch.battery_enable', '', 'on'),
    state('sensor.battery_input', 'W', '300'),
    state('sensor.battery_output', 'W', '250'),
    state('sensor.battery_time', 'h', '4'),
    state('number.inverter_limit', '%', '100', { min: 0, max: 100, step: 1 })
  ]);
  const mappings = validateMappings({ ...emptyMappings, evCableStatus: 'binary_sensor.ev_cable', evLockStatus: 'lock.ev_cable',
    evSessionEnergy: 'sensor.ev_session', evPhase1Current: 'sensor.ev_l1', batteryEnable: 'switch.battery_enable',
    batteryInputPower: 'sensor.battery_input', batteryOutputPower: 'sensor.battery_output', batteryRemainingTime: 'sensor.battery_time', solarLimit: 'number.inverter_limit' }, entities);
  assert.equal(mappings.evCableStatus, 'binary_sensor.ev_cable');
  assert.equal(mappings.batteryEnable, 'switch.battery_enable');
  assert.throws(() => validateMappings({ ...emptyMappings, solarLimit: 'sensor.ev_session' }, entities));
});

test('zonneopbrengst vandaag accepteert een Wh- of kWh-dagmeter, geen vermogenssensor', () => {
  const entities = normalizeStates([state('sensor.solar_today', 'kWh', '0.21'), state('sensor.solar_today_wh', 'Wh', '210'), state('sensor.solar_power', 'W', '210')]);
  assert.equal(validateMappings({ ...emptyMappings, solarToday: 'sensor.solar_today' }, entities).solarToday, 'sensor.solar_today');
  assert.equal(validateMappings({ ...emptyMappings, solarToday: 'sensor.solar_today_wh' }, entities).solarToday, 'sensor.solar_today_wh');
  assert.throws(() => validateMappings({ ...emptyMappings, solarToday: 'sensor.solar_power' }, entities));
});

test('bekende verbruikers kunnen alleen aan bestaande unieke schakelentiteiten worden gekoppeld', () => {
  const entities = normalizeStates([state('sensor.fridge', 'W', '0'), state('sensor.dryer', 'W', '1'), state('switch.fridge', '', 'on')]);
  const mappings = { ...emptyMappings, knownConsumers: ['sensor.fridge'], knownConsumerSwitches: { 'sensor.fridge': 'switch.fridge' } };
  assert.equal(validateMappings(mappings, entities).knownConsumerSwitches['sensor.fridge'], 'switch.fridge');
  assert.deepEqual(validateMappings({ ...emptyMappings }, entities).knownConsumerSwitches, {});
  assert.throws(() => validateMappings({ ...mappings, knownConsumers: [] }, entities));
  assert.throws(() => validateMappings({ ...mappings, knownConsumerSwitches: { 'sensor.fridge': 'sensor.fridge' } }, entities));
  assert.throws(() => validateMappings({ ...mappings, knownConsumerSwitches: { 'sensor.fridge': 'switch.missing' } }, entities));
  assert.throws(() => validateMappings({ ...mappings, knownConsumers: ['sensor.fridge', 'sensor.dryer'], knownConsumerSwitches: { 'sensor.fridge': 'switch.fridge', 'sensor.dryer': 'switch.fridge' } }, entities));
});

test('auto-accupercentage vereist een sensor in procenten', () => {
  const entities = normalizeStates([state('sensor.car_soc', '%', '64'), state('sensor.car_power', 'W', '640')]);
  assert.equal(validateMappings({ ...emptyMappings, evSoc: 'sensor.car_soc' }, entities).evSoc, 'sensor.car_soc');
  assert.throws(() => validateMappings({ ...emptyMappings, evSoc: 'sensor.car_power' }, entities));
});

test('demo sensor identifiers blijven uniek', () => {
  const ids = demoEntities().map(entity => entity.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('laadpaaldagtotaal vereist een cumulatieve energieteller en geen vermogens- of sessiemeter', () => {
  const entities = normalizeStates([state('sensor.ev_total', 'kWh', '42', { state_class: 'total_increasing' }), state('sensor.ev_session', 'kWh', '2.3', { state_class: 'measurement' })]);
  assert.equal(validateMappings({ ...emptyMappings, evEnergyTotal: 'sensor.ev_total' }, entities).evEnergyTotal, 'sensor.ev_total');
  assert.throws(() => validateMappings({ ...emptyMappings, evEnergyTotal: 'sensor.ev_session' }, entities), /cumulatieve/);
});