import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMappings, mappingsSchema, validateMappings } from '../src/home-assistant.js';
import { energySummary } from '../src/energy.js';
import { defaultPreferences, preferencesSchema } from '../src/store.js';

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
  assert.throws(() => preferencesSchema.parse({ ...defaultPreferences, heatingProfile: 'always-on' }));
});