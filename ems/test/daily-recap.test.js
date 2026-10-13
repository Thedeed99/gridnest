import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyEnergyRecap, dailyOverviewRows, demoDailyRecap, recapMeters, readDailyRecap } from '../src/daily-recap.js';
import { emptyMappings } from '../src/home-assistant.js';
import { cumulativeSolarToday, readSolarMeterToday } from '../src/solar-meter.js';

const sensor = (id, state, unit = 'W') => ({ id, name: id, domain: 'sensor', state: String(state), unit, available: true });

test('cumulatieve SolarEdge-meter geeft alleen verschil sinds HA-middernacht, niet levensduurtotaal', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  const entity = sensor('sensor.solaredge_i1_ac_energy', 12504.2, 'kWh');
  const history = [[{ last_updated: '2026-10-12T21:30:00Z', state: '12500' }, { last_updated: '2026-10-13T08:00:00Z', state: '12502' }]];
  const result = cumulativeSolarToday(history, entity, now, 'Europe/Amsterdam');
  assert.ok(Math.abs(result.energyKwh - 4.2) < 0.000001);
  assert.equal(result.periodStart, '2026-10-12T22:00:00.000Z');
  assert.equal(result.complete, true);
  assert.equal(cumulativeSolarToday(history.slice(0).map(points => points.slice(1)), entity, now).energyKwh, null);
  assert.equal(cumulativeSolarToday(history, { ...entity, state: '10' }, now).energyKwh, null);
  assert.equal(cumulativeSolarToday(history, { ...entity, state: '12500' }, now).energyKwh, null);
  assert.equal(cumulativeSolarToday([[history[0][0]]], { ...entity, state: '12500' }, now).energyKwh, 0);
  assert.equal(cumulativeSolarToday([[{ last_updated: '2026-10-12T21:30:00Z', state: '12500000' }]], sensor(entity.id, 12504200, 'Wh'), now).energyKwh, 4.2);
});

test('cumulatieve meterhistorie gebruikt alleen GET en de gekozen entiteit met HA-tijdzone', async () => {
  const requests = [];
  const entity = sensor('sensor.solaredge_i1_ac_energy', 105, 'kWh');
  const result = await readSolarMeterToday({ SUPERVISOR_TOKEN: 'fake' }, entity, async (url, options) => {
    requests.push({ url: new URL(url), options });
    return { ok: true, json: async () => String(url).endsWith('/config') ? { time_zone: 'Europe/Amsterdam' } : [[{ state: '100', last_updated: '2026-10-12T22:00:00Z' }]] };
  }, new Date('2026-10-13T10:00:00Z'));
  assert.equal(result.energyKwh, 5);
  assert.equal(requests[1].url.searchParams.get('filter_entity_id'), entity.id);
  assert.ok(requests.every(item => !item.options.method || item.options.method === 'GET'));
});

test('overzichtsrecap toont alleen hoofdtotale waarden, batterijrichtingen en optionele meters', () => {
  const mappings = { ...emptyMappings, totalConsumption: 'sensor.total', gridExport: 'sensor.export', evPower: 'sensor.ev', batteryMode: 'measured', batteryPower: 'sensor.battery' };
  const row = (entityId, label, energyKwh) => ({ entityId, label, energyKwh, complete: true });
  const recap = { rows: [row('sensor.total', 'Woningverbruik', 12), row('sensor.export', 'Teruglevering', 2), row('sensor.ev', 'Laadpaal', 4), row('sensor.battery', 'Batterij laden', 3), row('sensor.battery', 'Batterij ontladen', 1), row('sensor.phase', 'Fase L1', 5), row('sensor.fridge', 'Koelkast', 1)] };
  const result = dailyOverviewRows(recap, mappings, { gas: { value: 0.5, complete: true }, water: { value: 0.2, complete: false } });
  assert.deepEqual(result.map(row => row.label), ['Woningverbruik', 'Teruglevering', 'Laadpaal', 'Batterij laden', 'Batterij ontladen', 'Gas', 'Water']);
  assert.equal(result.at(-1).unit, 'm³');
  assert.equal(result.at(-1).complete, false);
  const missing = dailyOverviewRows(recap, emptyMappings);
  assert.deepEqual(missing.map(row => row.label), ['Woningverbruik', 'Teruglevering']);
  assert.ok(missing.every(row => row.value === null));
});

test('recap berekent dagverbruik alleen bij volledige balansbronnen en ondersteunt losse batterijmetingen', () => {
  const mappings = { ...emptyMappings, solar: 'sensor.solar', gridImport: 'sensor.import', gridExport: 'sensor.export', batteryMode: 'none' };
  const recap = { rows: [['sensor.solar', 'Zonnepanelen', 5], ['sensor.import', 'Netafname', 3], ['sensor.export', 'Teruglevering', 2]].map(([entityId, label, energyKwh]) => ({ entityId, label, energyKwh, complete: true })) };
  assert.equal(dailyOverviewRows(recap, mappings)[0].value, 6);
  assert.equal(dailyOverviewRows({ rows: recap.rows.slice(1) }, mappings)[0].value, null);
  const inputs = { ...emptyMappings, batteryInputPower: 'sensor.input', batteryOutputPower: 'sensor.output' };
  assert.deepEqual(recapMeters(inputs, [sensor('sensor.input', 100), sensor('sensor.output', 50)]).map(row => row.label), ['Batterij laden', 'Batterij ontladen']);
});

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

test('zonne-uurwaarden tellen op tot dagopbrengst en verzinnen geen ontbrekende of toekomstige uren', () => {
  const meter = { id: 'sensor.solar', label: 'Zonnepanelen', kind: 'production', unit: 'W' };
  const now = new Date(2026, 9, 12, 3);
  const history = [Array.from({ length: 7 }, (_, index) => ({ last_changed: new Date(2026, 9, 12, 1, index * 15).toISOString(), state: index < 4 ? '1000' : '0' }))];
  const row = dailyEnergyRecap(history, [meter], now).rows[0];
  assert.equal(row.hours.length, 24);
  assert.equal(row.hours[0].energyKwh, null);
  assert.equal(row.hours[0].complete, false);
  assert.equal(row.hours[1].energyKwh, 1);
  assert.equal(row.hours[1].complete, true);
  assert.equal(row.hours[2].energyKwh, 0);
  assert.equal(row.hours[2].complete, true);
  assert.equal(row.hours[3].energyKwh, null);
  assert.equal(row.hours.reduce((total, bucket) => total + (bucket.energyKwh ?? 0), 0), row.energyKwh);
});

test('officiele Energie-totalen gaan voor en behouden opt-in voor gas en water', () => {
  const recap = { rows: [{ label: 'Woningverbruik', entityId: 'sensor.total', energyKwh: 11.43, complete: true }],
    officialRows: [{ label: 'Woningverbruik', value: 10.76, unit: 'kWh', source: 'home-assistant', complete: true },
      { label: 'Teruglevering', value: 0.05, unit: 'kWh', source: 'home-assistant', complete: true },
      { label: 'Gas', value: 1.49, unit: 'm³', source: 'home-assistant', complete: true }] };
  const mappings = { ...emptyMappings, totalConsumption: 'sensor.total' };
  const result = dailyOverviewRows(recap, mappings, { gas: { value: 1.5, complete: false } });
  assert.equal(result[0].value, 10.76);
  assert.equal(result[0].source, 'home-assistant');
  assert.equal(result.at(-1).value, 1.49);
  assert.ok(!dailyOverviewRows(recap, mappings).some(row => row.label === 'Gas'));
});