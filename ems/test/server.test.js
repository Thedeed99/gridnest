import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { createStore, defaultPreferences, thermalSchema } from '../src/store.js';
import { emptyMappings } from '../src/home-assistant.js';
import { demoEntities } from '../src/demo.js';
import { thermalReadings, validateThermal } from '../src/thermal.js';
import { defaultRules } from '../src/rules.js';

const thermalConfig = () => ({
  sources: [
    { id: 'cv', name: 'Centrale verwarming', entityId: 'climate.demo_heating', profile: 'radiators' },
    { id: 'airco', name: 'Airco', entityId: 'climate.demo_airco', profile: 'airco' }
  ],
  rooms: [{ id: 'living', name: 'Woonkamer', floor: 'Begane grond', temperatureEntity: 'sensor.demo_temperature', presenceEntity: 'binary_sensor.demo_presence', targetC: 21, sourceIds: ['cv', 'airco'] }]
});

test('startup logs the underlying initialization error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gridnest-startup-test-'));
  const dataPath = join(directory, 'data');
  await mkdir(dataPath);
  await writeFile(join(dataPath, 'settings.json'), '{');
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
      env: { ...process.env, DATA_DIR: dataPath, SUPERVISOR_TOKEN: '', HA_TOKEN: '', DEMO_MODE: '' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Gridnest starten mislukt/);
    assert.match(result.stderr, /Opgeslagen instellingen zijn ongeldig/);
    assert.match(result.stderr, /SyntaxError/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ems-test-'));
  const store = await createStore(directory, 'demo');
  const app = createApp({ store, demo: true, entitiesProvider: async () => ({ connected: false, entities: demoEntities() }), ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  context.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${server.address().port}`, store, directory };
}

test('koppeling wordt via API gevalideerd en na herstart hersteld', async context => {
  const { url, directory } = await fixture(context);
  const response = await fetch(`${url}/api/mappings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...emptyMappings, solar: 'sensor.demo_solar' }) });
  assert.equal(response.status, 200);
  const restored = await createStore(directory, 'demo');
  assert.equal(restored.get().mappings.solar, 'sensor.demo_solar');
  const real = await createStore(directory, 'home-assistant');
  assert.equal(real.get().mappings.solar, null);
});

test('ongeldige voorkeuren veranderen de opgeslagen toestand niet', async context => {
  const { url, store } = await fixture(context);
  const response = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, comfortC: 10 }) });
  assert.equal(response.status, 400);
  assert.deepEqual(store.get().preferences, defaultPreferences);
});

test('gelijktijdige opslag behoudt zowel voorkeuren als koppelingen', async context => {
  const { store } = await fixture(context);
  await Promise.all([store.update({ mappings: { ...emptyMappings, solar: 'sensor.demo_solar' } }), store.update({ preferences: { ...defaultPreferences, comfortC: 21 } })]);
  assert.equal(store.get().mappings.solar, 'sensor.demo_solar');
  assert.equal(store.get().preferences.comfortC, 21);
});

test('geen services-endpoint; cross-site schrijfacties worden geweigerd', async context => {
  const { url } = await fixture(context);
  const response = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(defaultPreferences) });
  assert.equal(response.status, 403);
  assert.equal((await fetch(`${url}/api/services`)).status, 404);
});

test('Supervisor-modus weigert toegang buiten de ingress-proxy', async context => {
  const { url } = await fixture(context, { supervisor: true });
  assert.equal((await fetch(`${url}/api/bootstrap`)).status, 403);
});

test('uitval wist geen koppelingen en verzint geen meetwaarden', async context => {
  const { url, store } = await fixture(context, { entitiesProvider: async () => { throw new Error('offline'); } });
  await store.update({ mappings: { ...emptyMappings, solar: 'sensor.demo_solar' } });
  const response = await fetch(`${url}/api/bootstrap`);
  const body = await response.json();
  assert.equal(body.connected, false);
  assert.equal(body.entities.length, 0);
  assert.equal(body.mappings.solar, 'sensor.demo_solar');
  assert.equal(body.readings.find(item => item.role === 'solar').value, null);
});

test('API bewaart netsensorrichting en verbruikers, en toont berekende balans', async context => {
  const { url } = await fixture(context);
  const mappings = { ...emptyMappings, gridMode: 'signed', gridPower: 'sensor.demo_grid_power',
    solar: 'sensor.demo_solar', batteryMode: 'measured', batteryPower: 'sensor.demo_battery_power',
    knownConsumers: ['sensor.demo_ev_power', 'sensor.demo_heating_power', 'sensor.demo_fridge_power'],
    knownConsumerNames: { 'sensor.demo_ev_power': 'Elektrische auto' } };
  const saved = await fetch(`${url}/api/mappings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mappings) });
  assert.equal(saved.status, 200);
  const body = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(body.energy.importKw, 0.42);
  assert.ok(Math.abs(body.energy.totalKw - 2.97) < 0.000001);
  assert.ok(Math.abs(body.energy.knownKw - 2.2) < 0.000001);
  assert.ok(Math.abs(body.energy.unknownKw - 0.77) < 0.000001);
  assert.equal(body.energy.consumers.find(item => item.id === 'sensor.demo_ev_power').name, 'Elektrische auto');
  assert.equal(body.energy.totalSource, 'balance');
});

test('metergeschiedenis-API gebruikt alleen de ingestelde meter', async context => {
  let requestedEntity;
  let requestedUtility;
  const { url, store } = await fixture(context, { utilityHistoryProvider: async (entityId, utility) => {
    requestedEntity = entityId;
    requestedUtility = utility;
    return { available: true, series: { hours24: [], days7: [], days30: [] } };
  } });
  const mappings = { ...emptyMappings, gasConsumption: 'sensor.demo_gas', waterConsumption: 'sensor.demo_water' };
  const saved = await fetch(`${url}/api/mappings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mappings) });
  assert.equal(saved.status, 200);
  assert.equal((await fetch(`${url}/api/utility-history/water`)).status, 403);
  await store.update({ preferences: { ...defaultPreferences, showWater: true } });
  const response = await fetch(`${url}/api/utility-history/water`);
  assert.equal(response.status, 200);
  assert.equal(requestedEntity, 'sensor.demo_water');
  assert.equal(requestedUtility, 'water');
  assert.equal((await response.json()).available, true);
  await store.update({ preferences: { ...defaultPreferences, showWater: false } });
  assert.equal((await fetch(`${url}/api/utility-history/water`)).status, 403);
});

test('dagrecap-API retourneert de meters voor het overzicht', async context => {
  const { url, store } = await fixture(context, { dailyRecapProvider: async mappings => ({
    available: true, complete: true, rows: [{ label: mappings.knownConsumerNames['sensor.demo_ev_power'], energyKwh: 4.2 }]
  }) });
  await store.update({ mappings: { ...emptyMappings, knownConsumers: ['sensor.demo_ev_power'], knownConsumerNames: { 'sensor.demo_ev_power': 'Elektrische auto' } } });
  const response = await fetch(`${url}/api/daily-recap`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.rows[0].label, 'Elektrische auto');
  assert.equal(result.rows[0].energyKwh, 4.2);
});

test('API bewaart verwarmingsprofiel en levert advies zonder schakelcommando', async context => {
  const { url } = await fixture(context);
  const saved = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, heatingProfile: 'underfloor' }) });
  assert.equal(saved.status, 200);
  const body = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(body.preferences.heatingProfile, 'underfloor');
  assert.ok(body.heatingProfiles.find(profile => profile.id === 'underfloor').advice.includes('niet dat pomp of warmtebron continu moet draaien'));
  assert.equal(body.mode, 'read-only');
});

test('kamers en meerdere warmtebronnen blijven bewaard na herstart', async context => {
  const { url, directory } = await fixture(context);
  const response = await fetch(`${url}/api/thermal`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(thermalConfig()) });
  assert.equal(response.status, 200);
  const restored = await createStore(directory, 'demo');
  assert.deepEqual(restored.get().thermal, thermalSchema.parse(thermalConfig()));
  const body = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(body.thermalReadings.rooms[0].currentC, 20.2);
  assert.equal(body.thermalReadings.rooms[0].status, 'below');
  assert.equal(body.thermalReadings.rooms[0].occupied, true);
  assert.equal(body.thermalReadings.rooms[0].sources.length, 2);
  assert.equal(body.mode, 'read-only');
});

test('een gedeelde bron kan meerdere kamers bedienen zonder dubbele apparaatdefinitie', () => {
  const thermal = thermalConfig();
  thermal.rooms.push({ ...thermal.rooms[0], id: 'bedroom', name: 'Slaapkamer', floor: 'Eerste verdieping', temperatureEntity: 'sensor.demo_bedroom_temperature', sourceIds: ['cv'] });
  const result = thermalReadings(validateThermal(thermal, demoEntities()), demoEntities());
  assert.equal(result.sources.length, 2);
  assert.equal(result.rooms[1].sources[0].id, 'cv');
});

test('ongeldige of dubbele bronnen en ontbrekende verwijzingen veranderen opslag niet', async context => {
  const { url, store } = await fixture(context);
  const cases = [];
  const wrongType = thermalConfig();
  wrongType.sources[0].entityId = 'sensor.demo_temperature';
  cases.push(wrongType);
  const missing = thermalConfig();
  missing.rooms[0].sourceIds = ['does-not-exist'];
  cases.push(missing);
  const duplicate = thermalConfig();
  duplicate.sources[1].entityId = duplicate.sources[0].entityId;
  cases.push(duplicate);
  const invalidTemperature = thermalConfig();
  invalidTemperature.rooms[0].temperatureEntity = 'sensor.demo_solar';
  cases.push(invalidTemperature);
  const duplicateRoom = thermalConfig();
  duplicateRoom.rooms.push({ ...duplicateRoom.rooms[0], id: 'duplicate' });
  cases.push(duplicateRoom);
  for (const body of cases) {
    const response = await fetch(`${url}/api/thermal`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(store.get().thermal, { mode: 'off', sources: [], rooms: [] });
});

test('live temperatuurwijzigingen bewegen het kameroverzicht mee, uitval blijft onbekend', () => {
  const thermal = thermalConfig();
  const entities = demoEntities();
  const temperature = entities.find(entity => entity.id === 'sensor.demo_temperature');
  temperature.state = '21';
  assert.equal(thermalReadings(thermal, entities).rooms[0].status, 'at-target');
  temperature.state = '22';
  assert.equal(thermalReadings(thermal, entities).rooms[0].status, 'above');
  temperature.available = false;
  const missing = thermalReadings(thermal, entities).rooms[0];
  assert.equal(missing.currentC, null);
  assert.equal(missing.status, 'missing');
});

test('wisselen van demo naar echte woning neemt geen kamer- of bronkoppelingen over', async context => {
  const { directory, store } = await fixture(context);
  await store.update({ thermal: thermalConfig() });
  const real = await createStore(directory, 'home-assistant');
  assert.deepEqual(real.get().thermal, { mode: 'off', rooms: [], sources: [] });
});

test('verwarmmodus wordt niet verward met daadwerkelijk verwarmen', () => {
  const entities = demoEntities();
  const climate = entities.find(entity => entity.id === 'climate.demo_heating');
  climate.hvacAction = 'idle';
  const source = thermalReadings(thermalConfig(), entities).sources[0];
  assert.equal(source.mode, 'heat');
  assert.equal(source.action, 'idle');
  climate.available = false;
  assert.equal(thermalReadings(thermalConfig(), entities).sources[0].action, null);
});

test('regelinstellingen worden opgeslagen, proefmodus vereist geen live-vrijgave', async context => {
  const { url, store } = await fixture(context);
  const response = await fetch(`${url}/api/rules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ control: { ...defaultRules, mode: 'preview' } }) });
  assert.equal(response.status, 200);
  assert.equal(store.get().control.mode, 'preview');
  const body = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.ok(body.actionTypes.some(type => type.id === 'pv_limit'));
  assert.equal(body.controlStatus.activeAllowed, false);
});

test('actieve modus wordt in demo geweigerd en pauze werkt zonder sensorkoppeling', async context => {
  const { url, store } = await fixture(context);
  const response = await fetch(`${url}/api/rules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ control: { ...defaultRules, mode: 'active' }, confirmActive: true }) });
  assert.equal(response.status, 403);
  assert.equal(store.get().control.mode, 'off');
  await store.update({ control: { ...defaultRules, mode: 'preview' } });
  const pause = await fetch(`${url}/api/rules/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(pause.status, 200);
  assert.equal(store.get().control.mode, 'off');
});

test('regelprioriteit en Home Assistant-entiteitkeuzes blijven via API bewaard', async context => {
  const { url, directory } = await fixture(context);
  const control = { ...defaultRules, mode: 'preview', rules: [{
    id: 'priority_rule', name: 'Zonneladen', priority: 7, enabled: false, confirmed: false,
    conditions: [{ entityId: 'sensor.demo_solar', operator: 'gt', value: 2000 }],
    action: { type: 'ev_enable', entityId: 'switch.demo_ev_enable', value: 'on', otherwise: 'off' }
  }] };
  const response = await fetch(`${url}/api/rules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ control }) });
  assert.equal(response.status, 200);
  const restored = await createStore(directory, 'demo');
  const rule = restored.get().control.rules[0];
  assert.equal(rule.priority, 7);
  assert.equal(rule.conditions[0].entityId, 'sensor.demo_solar');
  assert.equal(rule.action.entityId, 'switch.demo_ev_enable');
});

test('meerdere personen worden opgeslagen, hersteld en gezamenlijk beoordeeld', async context => {
  const { url, directory } = await fixture(context);
  const preferences = { ...defaultPreferences, presenceEntities: ['person.demo_one', 'person.demo_two'], presenceMode: 'any' };
  const response = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) });
  assert.equal(response.status, 200);
  assert.deepEqual((await createStore(directory, 'demo')).get().preferences.presenceEntities, preferences.presenceEntities);
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(bootstrap.householdPresence.occupied, true);
  assert.equal(bootstrap.householdPresence.members.length, 2);
});

test('aanwezigheid aanpassen zet betrokken actieve Warmte terug naar proefmodus', async context => {
  const { url, store } = await fixture(context);
  const thermal = thermalSchema.parse(thermalConfig());
  thermal.mode = 'active'; thermal.rooms[0].presenceControl = true;
  await store.update({ thermal });
  const response = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, presenceEntities: ['person.demo_one'] }) });
  assert.equal(response.status, 200);
  assert.equal(store.get().thermal.mode, 'preview');
  const invalid = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, presenceEntities: ['person.missing'] }) });
  assert.equal(invalid.status, 400);
  assert.deepEqual(store.get().preferences.presenceEntities, ['person.demo_one']);
});

test('Warmte heeft eigen modus, demo weigert actief en pauze laat Stroom intact', async context => {
  const { url, store } = await fixture(context);
  const thermal = { ...thermalConfig(), mode: 'active' };
  const active = await fetch(`${url}/api/thermal`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Gridnest-Confirm-Control': 'true' }, body: JSON.stringify(thermal) });
  assert.equal(active.status, 403);
  const preview = await fetch(`${url}/api/thermal`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...thermal, mode: 'preview' }) });
  assert.equal(preview.status, 200);
  await store.update({ control: { ...defaultRules, mode: 'preview' } });
  const pause = await fetch(`${url}/api/thermal/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(pause.status, 200);
  assert.equal(store.get().thermal.mode, 'off');
  assert.equal(store.get().control.mode, 'preview');
});

test('kamer-aanwezigheid accepteert en leest een person-entiteit', () => {
  const entities = demoEntities();
  const thermal = thermalSchema.parse({ sources: [], rooms: [{
    id: 'living', name: 'Woonkamer', floor: 'Begane grond', temperatureEntity: 'sensor.demo_temperature',
    presenceEntity: 'person.demo_one', targetC: 21, presenceControl: true, sourceIds: []
  }] });
  assert.doesNotThrow(() => validateThermal(thermal, entities));
  const room = thermalReadings(thermal, entities, defaultPreferences).rooms[0];
  assert.equal(room.occupied, true);
});

test('handmatige accubediening vereist Supervisor-vrijgave en expliciete bevestiging', async context => {
  let command;
  const { url, store } = await fixture(context, {
    demo: false,
    supervisor: true,
    isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities: demoEntities() }),
    runner: { status: () => ({ activeAllowed: true }) },
    batterySwitchProvider: async (entityId, enabled) => { command = { entityId, enabled }; }
  });
  await store.update({ mappings: { ...emptyMappings, batteryEnable: 'switch.demo_battery_enable' } });
  const response = await fetch(`${url}/api/battery/enable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, confirm: true }) });
  assert.equal(response.status, 200);
  assert.deepEqual(command, { entityId: 'switch.demo_battery_enable', enabled: true });
  const unconfirmed = await fetch(`${url}/api/battery/enable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  assert.equal(unconfirmed.status, 400);
});

test('omvormerslider vereist actieve vrijgave, bevestiging en geldige stap', async context => {
  let command;
  const { url, store } = await fixture(context, {
    demo: false,
    supervisor: true,
    isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities: demoEntities() }),
    runner: { status: () => ({ activeAllowed: true }) },
    solarLimitProvider: async (entityId, value) => { command = { entityId, value }; }
  });
  await store.update({ mappings: { ...emptyMappings, solarLimit: 'number.demo_pv_limit' }, control: { ...defaultRules, mode: 'active' } });
  const response = await fetch(`${url}/api/solar/limit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 70, confirm: true }) });
  assert.equal(response.status, 200);
  assert.deepEqual(command, { entityId: 'number.demo_pv_limit', value: 70 });
  const unconfirmed = await fetch(`${url}/api/solar/limit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 60 }) });
  assert.equal(unconfirmed.status, 400);
});