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

test('batterijniveaus bedienen uitsluitend de gekoppelde entiteiten met geldige grenzen', async context => {
  const commands = [];
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities: demoEntities() }),
    runner: { status: () => ({ activeAllowed: true }) },
    evCommandProvider: async command => commands.push(command)
  });
  await store.update({ mappings: { ...emptyMappings, batteryMode: 'measured', batteryMinLevel: 'number.ups_min_charge_level', batteryMaxLevel: 'number.ups_max_charge_level', batteries: [{ id: 'extra', name: 'Extra', minLevelEntity: 'number.ups_min_charge_level', maxLevelEntity: 'number.ups_max_charge_level' }] }, control: { ...defaultRules, mode: 'preview' } });
  const send = (batteryId, min, max) => fetch(`${url}/api/battery/levels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batteryId, min, max, confirm: true }) });
  assert.equal((await send('main_battery', 30, 90)).status, 403);
  await store.update({ control: { ...defaultRules, mode: 'active' } });
  assert.equal((await send('main_battery', 90, 30)).status, 400);
  assert.equal((await send('main_battery', 30.5, 90)).status, 409);
  assert.equal((await send('missing', 30, 90)).status, 409);
  assert.equal(commands.length, 0);
  assert.equal((await send('main_battery', 30, 90)).status, 200);
  assert.equal((await send('extra', 30, 90)).status, 200);
  assert.equal(commands.length, 4);
  assert.deepEqual(commands[0], { entityId: 'number.ups_min_charge_level', service: 'number.set_value', value: 30 });
});

test('serverherstart behoudt actief voor Warmte en Stroom zonder demosturing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gridnest-mode-restart-'));
  try {
    const store = await createStore(directory, 'demo');
    await store.update({ control: { ...defaultRules, mode: 'active' }, thermal: { ...thermalConfig(), mode: 'active' } });
    const serverModule = new URL('../src/server.js', import.meta.url).href;
    const storeModule = new URL('../src/store.js', import.meta.url).href;
    const script = `import { startServer } from ${JSON.stringify(serverModule)}; import { createStore } from ${JSON.stringify(storeModule)};
      const server = await startServer({ DEMO_MODE: 'true', DATA_DIR: process.env.DATA_DIR, HOST: '127.0.0.2' });
      await new Promise(resolve => server.once('listening', resolve));
      const store = await createStore(process.env.DATA_DIR, 'demo');
      console.log('modes=' + store.get().control.mode + ',' + store.get().thermal.mode);
      await new Promise(resolve => server.close(resolve));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /modes=active,active/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('actieve instellingen opnieuw opslaan behoudt modus en vereist nog steeds apparaatvrijgave', async context => {
  let activeAllowed = true;
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities: demoEntities() }),
    runner: { status: () => ({ activeAllowed }), tick: async () => {} }
  });
  await store.update({ control: { ...defaultRules, mode: 'active' }, thermal: { ...thermalConfig(), mode: 'active' } });
  const save = (path, body) => fetch(`${url}/api/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const thermal = store.get().thermal;
  thermal.rooms[0].targetC = 22;
  assert.equal((await save('thermal', thermal)).status, 200);
  assert.equal(store.get().thermal.mode, 'active');
  assert.equal(store.get().thermal.rooms[0].targetC, 22);
  assert.equal((await save('rules', { control: store.get().control })).status, 200);
  activeAllowed = false;
  assert.equal((await save('thermal', thermal)).status, 403);
  assert.equal((await save('rules', { control: store.get().control })).status, 403);
  assert.equal(store.get().control.mode, 'active');
});

test('SolarEdge totaalmeter levert dagverschil zonder levensduurtotaal als dagmeter te tonen', async context => {
  let entityId;
  const { url, store } = await fixture(context, {
    solarTodayProvider: async id => { entityId = id; return { energyKwh: 4.2, complete: true, source: 'cumulative-meter' }; },
    dailyRecapProvider: async () => { throw new Error('Geen vermogenshistorie'); }
  });
  const response = await fetch(`${url}/api/mappings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...emptyMappings, solarToday: 'sensor.solaredge_i1_ac_energy', solarTodayMode: 'total' }) });
  assert.equal(response.status, 200);
  assert.equal(store.get().mappings.solarTodayMode, 'total');
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(bootstrap.energy.solarOutlook.actualTodayKwh, null);
  const recap = await (await fetch(`${url}/api/daily-recap`)).json();
  assert.equal(recap.solarToday.energyKwh, 4.2);
  assert.equal(entityId, 'sensor.solaredge_i1_ac_energy');
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

test('kosten-API blijft leeg als alles uit staat en berekent alleen ingeschakelde kosten', async context => {
  let calls = 0;
  const { url, store } = await fixture(context, { energyCostsProvider: async (config, entities) => {
    calls++;
    assert.equal(config.mappings.gasConsumption, 'sensor.demo_gas');
    assert.equal(entities.some(entity => entity.id === 'sensor.demo_price_gas'), true);
    return { resources: [{ key: 'gas', label: 'Gas', today: 0.7, month: 14.5 }] };
  } });
  assert.deepEqual(await (await fetch(`${url}/api/energy-costs`)).json(), { resources: [] });
  assert.equal(calls, 0);
  await store.update({ mappings: { ...emptyMappings, gasConsumption: 'sensor.demo_gas' }, preferences: {
    ...defaultPreferences,
    costs: { ...defaultPreferences.costs, gas: { enabled: true, rate: { source: 'entity', value: null, entityId: 'sensor.demo_price_gas' } } }
  } });
  const response = await fetch(`${url}/api/energy-costs`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).resources.map(item => [item.key, item.today, item.month]), [['gas', 0.7, 14.5]]);
  assert.equal(calls, 1);
});

test('tariefvoorkeuren accepteren geldige sensoreenheden en weigeren een verkeerde eenheid', async context => {
  const { url, store } = await fixture(context);
  const costs = { ...defaultPreferences.costs,
    gas: { enabled: true, rate: { source: 'entity', value: null, entityId: 'sensor.demo_price_gas' } } };
  const save = next => fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, costs: next }) });
  assert.equal((await save(costs)).status, 200);
  const invalid = { ...costs, gas: { enabled: true, rate: { source: 'entity', value: null, entityId: 'sensor.demo_temperature' } } };
  assert.equal((await save(invalid)).status, 400);
  assert.equal(store.get().preferences.costs.gas.rate.entityId, 'sensor.demo_price_gas');
});

test('financiële tarieven bewaren zes decimalen na opslaan en herstart', async context => {
  const { url, store, directory } = await fixture(context);
  const costs = { ...defaultPreferences.costs,
    electricity: { enabled: true, rate: { source: 'manual', value: 0.234567, entityId: null } },
    feedIn: { enabled: true, rate: { source: 'manual', value: 0.123456, entityId: null } } };
  const saved = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, costs }) });
  assert.equal(saved.status, 200);
  assert.deepEqual(store.get().preferences.costs, costs);
  const restored = await createStore(directory, 'demo');
  assert.deepEqual(restored.get().preferences.costs, costs);
  const invalid = { ...costs, feedIn: { enabled: true, rate: { source: 'entity', entityId: 'sensor.demo_temperature' } } };
  assert.equal((await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, costs: invalid }) })).status, 400);
});

test('bestaande laag/hoog-instellingen migreren naar één ingevuld all-in tarief', async context => {
  const { store, directory } = await fixture(context);
  const config = store.get();
  config.preferences.costs.electricity = { enabled: true,
    lowRate: { source: 'manual', value: 0.234567, entityId: null },
    highRate: { source: 'manual', value: 0.345678, entityId: null } };
  delete config.preferences.costs.feedIn;
  await writeFile(join(directory, 'settings.json'), JSON.stringify(config));
  const restored = await createStore(directory, 'demo');
  assert.deepEqual(restored.get().preferences.costs.electricity, { enabled: true, rate: config.preferences.costs.electricity.lowRate });
  assert.equal(restored.get().preferences.costs.feedIn.enabled, false);
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

test('aanwezigheid aanpassen behoudt de door de gebruiker gekozen actieve Warmte', async context => {
  const { url, store } = await fixture(context);
  const thermal = thermalSchema.parse(thermalConfig());
  thermal.mode = 'active'; thermal.rooms[0].presenceControl = true;
  await store.update({ thermal });
  const response = await fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...defaultPreferences, presenceEntities: ['person.demo_one'] }) });
  assert.equal(response.status, 200);
  assert.equal(store.get().thermal.mode, 'active');
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

test('verversingsinterval wordt opgeslagen en ongeldige intervallen worden geweigerd', async context => {
  const { url, store } = await fixture(context);
  const send = refreshSeconds => fetch(`${url}/api/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...store.get().preferences, refreshSeconds }) });
  for (const seconds of [1, 5, 10, 30, 60, 0]) {
    assert.equal((await send(seconds)).status, 200);
    const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
    assert.equal(bootstrap.preferences.refreshSeconds, seconds);
  }
  assert.equal((await send(15)).status, 400);
  assert.equal(store.get().preferences.refreshSeconds, 0);
});

test('verbruikerschakelaar vereist vrijgave, bevestiging, actuele stand en dezelfde koppeling', async context => {
  const commands = [];
  let activeAllowed = false;
  let entities = demoEntities();
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities }),
    runner: { status: () => ({ activeAllowed }) },
    consumerSwitchProvider: async (entityId, enabled) => { commands.push({ entityId, enabled }); }
  });
  const mappings = { ...emptyMappings, knownConsumers: ['sensor.demo_fridge_power'], knownConsumerSwitches: { 'sensor.demo_fridge_power': 'switch.demo_battery_enable' } };
  await store.update({ mappings });
  const send = body => fetch(`${url}/api/consumers/enable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { consumerId: 'sensor.demo_fridge_power', switchId: 'switch.demo_battery_enable', enabled: true, expectedState: 'off', confirm: true };
  assert.equal((await send(body)).status, 403);
  activeAllowed = true;
  await store.update({ control: { ...defaultRules, mode: 'preview' } });
  assert.equal((await send({ ...body, confirm: false })).status, 400);
  assert.equal((await send({ ...body, switchId: 'switch.demo_ev_enable' })).status, 409);
  assert.equal((await send({ ...body, expectedState: 'on' })).status, 409);
  assert.equal((await send(body)).status, 200);
  entities = entities.map(entity => entity.id === body.switchId ? { ...entity, reportedAt: '2000-01-01T00:00:00Z' } : entity);
  assert.equal((await send(body)).status, 200);
  entities = entities.map(entity => entity.id === body.switchId ? { ...entity, available: false } : entity);
  assert.equal((await send(body)).status, 409);
  await store.update({ mappings: { ...mappings, knownSource: 'aggregate' } });
  assert.equal((await send(body)).status, 409);
  assert.deepEqual(commands, [{ entityId: body.switchId, enabled: true }, { entityId: body.switchId, enabled: true }]);
});

test('dagrecap kan officiele Energietotalen leveren zonder bruikbare vermogenshistorie', async context => {
  const official = { rows: [{ label: 'Woningverbruik', value: 10.76, unit: 'kWh', source: 'home-assistant', complete: true }], updatedThrough: '2026-10-12T18:00:00Z' };
  const { url } = await fixture(context, { dailyRecapProvider: async () => { throw new Error('Geen vermogenshistorie'); }, officialRecapProvider: async () => official });
  const response = await fetch(`${url}/api/daily-recap`);
  assert.equal(response.status, 200);
  const recap = await response.json();
  assert.deepEqual(recap.officialRows, official.rows);
  assert.equal(recap.source, 'home-assistant');
  assert.deepEqual(recap.rows, []);
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

test('UPS uitschakelen accepteert een onveranderde oude status en controleert terugmelding', async context => {
  let state = 'on';
  let report = true;
  let failFeedback = false;
  let commands = 0;
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    runner: { status: () => ({ activeAllowed: true }) },
    entitiesProvider: async () => {
      if (failFeedback && commands) throw new Error('Terugmelding tijdelijk weg');
      return { connected: true, entities: [{ id: 'switch.ups', domain: 'switch', available: true, state, reportedAt: '2000-01-01T00:00:00Z' }] };
    },
    batterySwitchProvider: async (_entityId, enabled) => { commands++; if (report) state = enabled ? 'on' : 'off'; }
  });
  await store.update({ mappings: { ...emptyMappings, batteryEnable: 'switch.ups' } });
  const send = () => fetch(`${url}/api/battery/enable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false, confirm: true }) });
  const result = await send();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).verified, true);
  state = 'on'; report = false;
  assert.equal((await (await send()).json()).verified, false);
  commands = 0; failFeedback = true;
  const uncertain = await send();
  assert.equal(uncertain.status, 200);
  assert.equal((await uncertain.json()).verified, false);
  assert.equal(commands, 1);
});

test('extra batterijschakelaar schakelt alleen de bijbehorende batterij uit', async context => {
  let state = 'on';
  const commands = [];
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities: [{ id: 'switch.extra_battery', domain: 'switch', available: true, state }] }),
    runner: { status: () => ({ activeAllowed: true }) },
    batterySwitchProvider: async (entityId, enabled) => { commands.push({ entityId, enabled }); state = enabled ? 'on' : 'off'; }
  });
  await store.update({ mappings: { ...emptyMappings, batteries: [{ id: 'extra', name: 'Extra', switchEntity: 'switch.extra_battery' }] } });
  const send = (batteryId, switchId, expectedState, enabled = false) => fetch(`${url}/api/batteries/${batteryId}/enable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ switchId, enabled, expectedState, confirm: true })
  });
  assert.equal((await send('extra', 'switch.extra_battery', 'on')).status, 200);
  assert.equal((await send('extra', 'switch.extra_battery', 'on')).status, 409);
  assert.equal((await send('missing', 'switch.extra_battery', 'off', true)).status, 409);
  assert.deepEqual(commands, [{ entityId: 'switch.extra_battery', enabled: false }]);
});

test('laadpaalbediening bewaakt vrijgave, kabel, stroomlimiet en ontgrendelen', async context => {
  const commands = [];
  let activeAllowed = false;
  let entities = demoEntities();
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities }),
    runner: { status: () => ({ activeAllowed }) },
    evCommandProvider: async command => { commands.push(command); }
  });
  const send = body => fetch(`${url}/api/ev/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const mappings = { ...emptyMappings, evEnable: 'switch.demo_ev_enable', evCurrentLimit: 'number.demo_ev_current', evCableStatus: 'binary_sensor.demo_ev_cable', evLockStatus: 'lock.demo_ev_cable', evPower: 'sensor.demo_ev_power' };
  await store.update({ mappings });
  assert.equal((await send({ action: 'enable', enabled: true, confirm: true })).status, 403);
  activeAllowed = true;
  await store.update({ control: { ...defaultRules, mode: 'preview' } });
  assert.equal((await send({ action: 'enable', enabled: true })).status, 400);
  assert.equal((await send({ action: 'enable', enabled: true, confirm: true })).status, 200);
  assert.equal((await send({ action: 'current', value: 12, confirm: true })).status, 200);
  assert.equal((await send({ action: 'current', value: 17, confirm: true })).status, 409);
  assert.equal((await send({ action: 'current', value: 6.5, confirm: true })).status, 409);
  assert.equal((await send({ action: 'lock', locked: false, confirm: true })).status, 200);
  entities = entities.map(entity => entity.id === 'sensor.demo_ev_power' ? { ...entity, state: '0' } : entity);
  assert.equal((await send({ action: 'lock', locked: false, confirm: true })).status, 200);
  entities = entities.map(entity => entity.id === 'binary_sensor.demo_ev_cable' ? { ...entity, state: 'off' } : entity);
  assert.equal((await send({ action: 'enable', enabled: true, confirm: true })).status, 409);
  entities = entities.map(entity => ({ ...entity, reportedAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z' }));
  assert.equal((await send({ action: 'current', value: 12, confirm: true })).status, 200);
  assert.equal((await send({ action: 'lock', locked: false, confirm: true })).status, 200);
  entities = entities.map(entity => entity.id === 'number.demo_ev_current' ? { ...entity, available: false } : entity);
  assert.equal((await send({ action: 'current', value: 12, confirm: true })).status, 409);
  assert.equal(commands.length, 6);
  assert.deepEqual(commands[1], { entityId: 'number.demo_ev_current', service: 'number.set_value', value: 12 });
});

test('kabelvergrendeling via switch ondersteunt on/off zonder stroommeting als voorwaarde', async context => {
  const commands = [];
  let entities = demoEntities();
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities }),
    runner: { status: () => ({ activeAllowed: true }) },
    evCommandProvider: async command => commands.push(command)
  });
  await store.update({ mappings: { ...emptyMappings, evLockStatus: 'switch.thuis_laadkabel_vergrendeling', evPower: 'sensor.demo_ev_power' } });
  const send = locked => fetch(`${url}/api/ev/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'lock', locked, confirm: true }) });
  assert.equal((await send(false)).status, 200);
  entities.find(item => item.id === 'sensor.demo_ev_power').state = '';
  assert.equal((await send(false)).status, 200);
  entities.find(item => item.id === 'sensor.demo_ev_power').state = '0';
  assert.equal((await send(false)).status, 200);
  assert.deepEqual(commands[0], { entityId: 'switch.thuis_laadkabel_vergrendeling', service: 'switch.turn_off' });
  assert.equal((await send(true)).status, 200);
  assert.equal(commands[3].service, 'switch.turn_on');
  entities.find(item => item.id === 'switch.thuis_laadkabel_vergrendeling').state = 'unknown';
  assert.equal((await send(true)).status, 409);
  assert.equal(commands.length, 4);
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

test('centrale systeembediening zet zowel Warmte als Stroom in dezelfde modus', async context => {
  let activeAllowed = false;
  const { url, store } = await fixture(context, {
    demo: false, supervisor: true, isIngressRequest: () => true,
    entitiesProvider: async () => ({ connected: true, entities: demoEntities() }),
    runner: { status: () => ({ activeAllowed }), tick: async () => {} }
  });
  const send = body => fetch(`${url}/api/system/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // Zet naar preview
  const resPreview = await send({ mode: 'preview' });
  assert.equal(resPreview.status, 200);
  assert.equal(store.get().control.mode, 'preview');
  assert.equal(store.get().thermal.mode, 'preview');

  // Actief zonder vrijgave faalt met 403
  assert.equal((await send({ mode: 'active', confirm: true })).status, 403);

  // Met vrijgave slaagt actief
  activeAllowed = true;
  const resActive = await send({ mode: 'active', confirm: true });
  assert.equal(resActive.status, 200);
  assert.equal(store.get().control.mode, 'active');
  assert.equal(store.get().thermal.mode, 'active');

  // Zet naar off
  const resOff = await send({ mode: 'off' });
  assert.equal(resOff.status, 200);
  assert.equal(store.get().control.mode, 'off');
  assert.equal(store.get().thermal.mode, 'off');
});