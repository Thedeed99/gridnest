import test from 'node:test';
import assert from 'node:assert/strict';
import { demoUtilityHistory, readUtilityHistory, utilityConsumptionSeries } from '../src/gas.js';

test('gasstandverschillen worden naar 24 uur, 7 dagen en 30 dagen geaggregeerd', () => {
  const now = new Date('2026-10-12T12:00:00.000Z');
  const history = [];
  for (let offset = 30 * 24 + 1; offset >= 0; offset--) {
    history.push({ last_changed: new Date(now.getTime() - offset * 60 * 60 * 1000).toISOString(), state: String(100 + (30 * 24 + 1 - offset) * 0.01) });
  }
  const result = utilityConsumptionSeries([history], now);
  assert.equal(result.available, true);
  assert.equal(result.series.hours24.length, 24);
  assert.equal(result.series.days7.length, 7);
  assert.equal(result.series.days30.length, 30);
  assert.ok(result.series.hours24.every(bucket => Math.abs(bucket.value - 0.01) < 0.000001));
  assert.ok(Math.abs(result.series.days7.reduce((sum, bucket) => sum + bucket.value, 0) - 1.68) < 0.000001);
});

test('lege of ongeldige gasgeschiedenis wordt als niet beschikbaar gemarkeerd', () => {
  assert.equal(utilityConsumptionSeries([], new Date()).available, false);
  assert.equal(utilityConsumptionSeries([[{ last_changed: 'invalid', state: 'unknown' }]], new Date()).available, false);
});

test('demo levert gas- en waterreeksen voor alle gevraagde perioden', () => {
  const gas = demoUtilityHistory('gas', new Date('2026-10-12T12:00:00.000Z'));
  const water = demoUtilityHistory('water', new Date('2026-10-12T12:00:00.000Z'));
  const result = gas;
  assert.equal(result.available, true);
  assert.equal(result.series.hours24.length, 24);
  assert.equal(result.series.days7.length, 7);
  assert.equal(result.series.days30.length, 30);
  assert.ok(water.series.days30.reduce((sum, bucket) => sum + bucket.value, 0) < gas.series.days30.reduce((sum, bucket) => sum + bucket.value, 0));
});

test('metergeschiedenis gebruikt uitsluitend de geselecteerde entiteit via HA history API', async () => {
  const now = new Date('2026-10-12T12:00:00.000Z');
  let requested;
  const result = await readUtilityHistory({ SUPERVISOR_TOKEN: 'test-token' }, 'sensor.gas_total', async (url, options) => {
    requested = { url: new URL(url), options };
    return { ok: true, json: async () => [[]] };
  }, now);
  assert.equal(requested.url.pathname.includes('/history/period/'), true);
  assert.equal(requested.url.searchParams.get('filter_entity_id'), 'sensor.gas_total');
  assert.equal(requested.url.searchParams.has('minimal_response'), true);
  assert.equal(requested.options.headers.Authorization, 'Bearer test-token');
  assert.equal(result.available, false);
});