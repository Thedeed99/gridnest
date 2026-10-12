import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMappings, mappingsSchema, validateMappings } from '../src/home-assistant.js';
import { energySummary } from '../src/energy.js';
import { defaultPreferences, preferencesSchema } from '../src/store.js';

test('verversingsinterval is instelbaar en bestaande voorkeuren blijven op tien seconden', () => {
  const { refreshSeconds, ...legacyPreferences } = defaultPreferences;
  assert.equal(preferencesSchema.parse(legacyPreferences).refreshSeconds, 10);
  for (const seconds of [0, 5, 10, 30, 60]) {
    assert.equal(preferencesSchema.parse({ ...defaultPreferences, refreshSeconds: seconds }).refreshSeconds, seconds);
  }
  for (const seconds of [-1, 1, 15, 5.5, 120]) {
    assert.throws(() => preferencesSchema.parse({ ...defaultPreferences, refreshSeconds: seconds }));
  }
});

const sensor = (id, state, unit = 'W') => ({ id, name: id, domain: 'sensor', state: String(state), unit, available: !['unknown', 'unavailable'].includes(String(state)) });
const signedMappings = { ...emptyMappings, gridMode: 'signed', gridPower: 'sensor.net', solar: 'sensor.pv', batteryMode: 'none' };

test('positieve afname en negatieve export worden gesplitst zonder negatief verbruik', () => {
  const imported = energySummary(signedMappings, [sensor('sensor.net', 1000), sensor('sensor.pv', 2000)]);
  assert.equal(imported.importKw, 1);
  assert.equal(imported.exportKw, 0);
  assert.equal(imported.totalKw, 3);
  const exported = energySummary(signedMappings, [sensor('sensor.net', -1000), sensor('sensor.pv', 2000)]);
  assert.equal(exported.importKw, 0);
  assert.equal(exported.exportKw, 1);
  assert.equal(exported.totalKw, 1);
});

test('omgekeerde tekenrichting, kW en nulvermogen worden expliciet ondersteund', () => {
  const reversed = energySummary({ ...signedMappings, gridDirection: 'positive-export' }, [sensor('sensor.net', 1, 'kW'), sensor('sensor.pv', 2, 'kW')]);
  assert.equal(reversed.exportKw, 1);
  assert.equal(reversed.totalKw, 1);
  const zero = energySummary(signedMappings, [sensor('sensor.net', 0), sensor('sensor.pv', 0)]);
  assert.equal(zero.totalKw, 0);
});

test('netvermogen alleen of onbekende batterij levert geen verzonnen woningverbruik op', () => {
  assert.equal(energySummary(signedMappings, [sensor('sensor.net', 1000)]).totalKw, null);
  assert.equal(energySummary({ ...signedMappings, batteryMode: 'unknown' }, [sensor('sensor.net', 1000), sensor('sensor.pv', 2000)]).totalKw, null);
});

test('batterijladen wordt afgetrokken en ontladen opgeteld aan woningzijde', () => {
  const mappings = { ...signedMappings, batteryMode: 'measured', batteryPower: 'sensor.battery' };
  const entities = [sensor('sensor.net', 1000), sensor('sensor.pv', 2000)];
  assert.equal(energySummary(mappings, [...entities, sensor('sensor.battery', 500)]).totalKw, 2.5);
  assert.equal(energySummary(mappings, [...entities, sensor('sensor.battery', -500)]).totalKw, 3.5);
  assert.equal(energySummary({ ...mappings, batteryDirection: 'positive-discharge' }, [...entities, sensor('sensor.battery', 500)]).totalKw, 3.5);
});

test('directe woningmeting heeft voorrang, bekende apparaten worden een keer geteld', () => {
  const entities = [sensor('sensor.total', 3000), sensor('sensor.ev', 1.2, 'kW'), sensor('sensor.heating', 800)];
  const mappings = validateMappings({ ...emptyMappings, totalConsumption: 'sensor.total', evPower: 'sensor.ev', knownConsumers: ['sensor.ev', 'sensor.heating'] }, entities);
  const result = energySummary(mappings, entities);
  assert.equal(result.totalSource, 'sensor');
  assert.equal(result.totalKw, 3);
  assert.equal(result.knownKw, 2);
  assert.equal(result.unknownKw, 1);
});

test('eigen verbruikersnamen overschrijven alleen de getoonde naam', () => {
  const mappings = { ...emptyMappings, knownConsumers: ['sensor.ev'], knownConsumerNames: { 'sensor.ev': 'Auto laden' } };
  const result = energySummary(mappings, [sensor('sensor.ev', 1200)]);
  assert.equal(result.consumers[0].name, 'Auto laden');
  assert.equal(result.consumers[0].powerKw, 1.2);
});

test('bekende totaalsensor en afzonderlijke apparaten worden nooit opgeteld', () => {
  const result = energySummary({ ...emptyMappings, totalConsumption: 'sensor.total', knownConsumption: 'sensor.known', knownSource: 'aggregate', knownConsumers: ['sensor.ev'] }, [sensor('sensor.total', 3000), sensor('sensor.known', 2000), sensor('sensor.ev', 1000)]);
  assert.equal(result.knownKw, 2);
  assert.equal(result.unknownKw, 1);
  assert.deepEqual(result.consumers, []);
});

test('onbekende, ontbrekende en negatieve apparaatmetingen worden niet nul', () => {
  for (const value of ['unavailable', 'unknown', '', 'abc', -100]) {
    const result = energySummary({ ...emptyMappings, totalConsumption: 'sensor.total', knownConsumers: ['sensor.ev'] }, [sensor('sensor.total', 3000), sensor('sensor.ev', value)]);
    assert.equal(result.knownKw, null);
    assert.equal(result.unknownKw, null);
  }
  const failedNet = energySummary(signedMappings, [sensor('sensor.net', 'unavailable'), sensor('sensor.pv', 2000)]);
  assert.equal(failedNet.importKw, null);
  assert.equal(failedNet.exportKw, null);
});

test('inconsistente energiebalans of te hoge bekende som krijgt geen negatieve rest', () => {
  assert.equal(energySummary(signedMappings, [sensor('sensor.net', -3000), sensor('sensor.pv', 1000)]).totalKw, null);
  const result = energySummary({ ...emptyMappings, totalConsumption: 'sensor.total', knownConsumers: ['sensor.ev'] }, [sensor('sensor.total', 1000), sensor('sensor.ev', 1200)]);
  assert.equal(result.status, 'mismatch');
  assert.equal(result.unknownKw, null);
});

test('dubbele selecties en productie- of totaalmeters als apparaat worden geweigerd', () => {
  const entities = [sensor('sensor.total', 3000), sensor('sensor.ev', 1000), sensor('sensor.pv', 2000)];
  assert.throws(() => validateMappings({ ...emptyMappings, knownConsumers: ['sensor.ev', 'sensor.ev'] }, entities));
  assert.throws(() => validateMappings({ ...emptyMappings, totalConsumption: 'sensor.total', knownConsumers: ['sensor.total'] }, entities));
  assert.throws(() => validateMappings({ ...emptyMappings, solar: 'sensor.pv', knownConsumers: ['sensor.pv'] }, entities));
});

test('bestaande koppelingen en wensen krijgen veilige standaardwaarden', () => {
  const { heatingProfile, ...legacyPreferences } = defaultPreferences;
  assert.equal(preferencesSchema.parse(legacyPreferences).heatingProfile, 'unspecified');
  assert.equal(mappingsSchema.parse({ gridImport: 'sensor.net' }).gridMode, 'separate');
  assert.equal(mappingsSchema.parse({}).batteryMode, 'unknown');
  assert.deepEqual(mappingsSchema.parse({}).knownConsumerNames, {});
  assert.equal(preferencesSchema.parse(legacyPreferences).showGas, false);
  assert.equal(preferencesSchema.parse(legacyPreferences).showWater, false);
  assert.throws(() => preferencesSchema.parse({ ...defaultPreferences, heatingProfile: 'always-on' }));
});

test('fasestroom en spanning worden per fase als schijnbaar vermogen in VA berekend', () => {
  const mappings = { ...emptyMappings, phase1Current: 'sensor.l1_current', phase1Voltage: 'sensor.l1_voltage' };
  const result = energySummary(mappings, [
    sensor('sensor.l1_current', 5, 'A'), sensor('sensor.l1_voltage', 230, 'V')
  ]);
  assert.deepEqual(result.phaseLoads[0], { phase: 'L1', currentA: 5, voltageV: 230, activePowerKw: null, apparentPowerVA: 1150 });
  assert.deepEqual(result.phaseLoads.slice(1), [
    { phase: 'L2', currentA: null, voltageV: null, activePowerKw: null, apparentPowerVA: null },
    { phase: 'L3', currentA: null, voltageV: null, activePowerKw: null, apparentPowerVA: null }
  ]);
});

test('zonneverwachting vergelijkt forecast sensoren met actuele productie', () => {
  const mappings = { ...emptyMappings, solar: 'sensor.solar', solarExpectedNow: 'sensor.forecast_now', solarExpectedToday: 'sensor.forecast_today' };
  const entities = [sensor('sensor.solar', 2100), sensor('sensor.forecast_now', 2500), sensor('sensor.forecast_today', 9.55, 'kWh')];
  const result = energySummary(mappings, entities);
  assert.equal(result.solarOutlook.actualNowKw, 2.1);
  assert.equal(result.solarOutlook.expectedNowKw, 2.5);
  assert.equal(result.solarOutlook.expectedTodayKwh, 9.55);
});

test('gemeten fasevermogen in kW heeft voorrang op de VA-schatting', () => {
  const mappings = { ...emptyMappings, phase1Current: 'sensor.l1_current', phase1Voltage: 'sensor.l1_voltage', phase1Power: 'sensor.l1_power' };
  const result = energySummary(mappings, [sensor('sensor.l1_current', 5, 'A'), sensor('sensor.l1_voltage', 230, 'V'), sensor('sensor.l1_power', 0.15, 'kW')]);
  assert.equal(result.phaseLoads[0].activePowerKw, 0.15);
  assert.equal(result.phaseLoads[0].apparentPowerVA, 1150);
});

test('gekoppelde zonne-dagopbrengst normaliseert Wh en kWh zonder ontbrekende waarden als nul te tonen', () => {
  const mappings = { ...emptyMappings, solarToday: 'sensor.solar_today' };
  const value = entity => energySummary(mappings, entity ? [entity] : []).solarOutlook.actualTodayKwh;
  assert.equal(value(sensor('sensor.solar_today', 210, 'Wh')), 0.21);
  assert.equal(value(sensor('sensor.solar_today', 0.21, 'kWh')), 0.21);
  assert.equal(value(sensor('sensor.solar_today', 0, 'kWh')), 0);
  for (const state of ['unknown', 'unavailable', '', 'abc', -1]) {
    assert.equal(value(sensor('sensor.solar_today', state, 'kWh')), null);
  }
  assert.equal(value(sensor('sensor.solar_today', 210, 'W')), null);
  assert.equal(value(), null);
});