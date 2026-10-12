import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyEnergyRecap, demoDailyRecap, recapMeters, readDailyRecap } from '../src/daily-recap.js';
import { emptyMappings } from '../src/home-assistant.js';

const sensor = (id, state, unit = 'W') => ({ id, name: id, domain: 'sensor', state: String(state), unit, available: true });

test('dagrecap integreert gekoppelde vermogensmeters naar kWh', () => {
  const now = new Date(2026, 9, 12, 2);
  const meter = { id: 'sensor.grid', label: 'Netafname', kind: 'import', unit: 'kW' };
  const history = [[]];
  history[0].push({ last_changed: new Date(2026, 9, 11, 23, 45).toISOString(), state: '0.5' });
  for (let minutes = 0; minutes <= 120; minutes += 15) {
    const value = minutes < 60 ? '0.5' : minutes === 120 ? '0.5' : '1';
    history[0].push({ last_changed: new Date(2026, 9, 12, 0, minutes).toISOString(), state: value });
  }
  const result = dailyEnergyRecap(history, [meter], now);
  assert.equal(result.available, true);
  assert.equal(result.complete, true);
  assert.equal(result.rows[0].energyKwh, 1.5);
});

test('signed net- en batterijvermogen splitsen afname/export en laden/ontladen', () => {
  const now = new Date(2026, 9, 12, 1);
  const meters = [
    { id: 'sensor.grid', label: 'Net', kind: 'grid', unit: 'W', signed: true, direction: 1 },
    { id: 'sensor.battery', label: 'Batterij', kind: 'battery', unit: 'W', signed: true, direction: 1 }
  ];
  const history = [
    [
      { last_changed: new Date(2026, 9, 11, 23, 45).toISOString(), state: '500' },
      { last_changed: new Date(2026, 9, 12, 0, 15).toISOString(), state: '500' },
      { last_changed: new Date(2026, 9, 12, 0, 30).toISOString(), state: '-500' },
      { last_changed: new Date(2026, 9, 12, 0, 45).toISOString(), state: '-500' },
      { last_changed: new Date(2026, 9, 12, 1).toISOString(), state: '-500' }
    ],
    Array.from({ length: 6 }, (_, index) => ({ last_changed: new Date(2026, 9, 11, 23, 45 + index * 15).toISOString(), state: '-1000' }))
  ];
  const result = dailyEnergyRecap(history, meters, now);
  assert.equal(result.rows.find(row => row.label === 'Netafname').energyKwh, 0.25);
  assert.equal(result.rows.find(row => row.label === 'Teruglevering').energyKwh, 0.25);
  assert.equal(result.rows.find(row => row.label === 'Batterij ontladen').energyKwh, 1);
});

test('dagrecap kiest alleen gekoppelde elektrische vermogensmeters', () => {
  const mappings = { ...emptyMappings, gridImport: 'sensor.grid', gasConsumption: 'sensor.gas', knownConsumers: ['sensor.fridge'], knownConsumerNames: { 'sensor.fridge': 'Koelkast' } };
  const meters = recapMeters(mappings, [sensor('sensor.grid', 600), sensor('sensor.fridge', 100), sensor('sensor.gas', 100, 'm³')]);
  assert.deepEqual(meters.map(meter => meter.label), ['Netafname', 'Koelkast']);
});

test('dagrecap leest in één GET alleen de ingestelde entiteiten', async () => {
  const now = new Date(2026, 9, 12, 1);
  const meters = [{ id: 'sensor.grid', label: 'Netafname', kind: 'import', unit: 'W' }];
  let requested;
  const result = await readDailyRecap({ SUPERVISOR_TOKEN: 'test-token' }, meters, async (url, options) => {
    requested = { url: new URL(url), options };
    return { ok: true, json: async () => [[
      { last_changed: new Date(2026, 9, 11, 23, 45).toISOString(), state: '500' },
      ...Array.from({ length: 5 }, (_, index) => ({ last_changed: new Date(2026, 9, 12, 0, (index + 1) * 15).toISOString(), state: '500' }))
    ]] };
  }, now);
  assert.equal(requested.url.searchParams.get('filter_entity_id'), 'sensor.grid');
  assert.equal(requested.options.headers.Authorization, 'Bearer test-token');
  assert.equal(result.rows[0].energyKwh, 0.5);
});

test('demo dagrecap geeft voorbeelden voor alle gekoppelde meters', () => {
  const meters = [
    { id: 'sensor.grid', label: 'Netafname', kind: 'import', unit: 'W' },
    { id: 'sensor.solar', label: 'Zonnepanelen', kind: 'production', unit: 'W' }
  ];
  const result = demoDailyRecap(meters, new Date(2026, 9, 12, 12));
  assert.equal(result.rows.length, 2);
  assert.equal(result.available, true);
  assert.equal(result.complete, true);
});

test('dagrecap telt een sensor niet dubbel bij een rol en bekende verbruikers', () => {
  const mappings = { ...emptyMappings, evPower: 'sensor.ev', knownConsumers: ['sensor.ev'], knownConsumerNames: { 'sensor.ev': 'Auto laden' } };
  const meters = recapMeters(mappings, [sensor('sensor.ev', 1200)]);
  assert.deepEqual(meters.map(meter => meter.label), ['Laadpaal']);
});