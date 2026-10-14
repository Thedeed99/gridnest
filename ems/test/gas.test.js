import test from 'node:test';
import assert from 'node:assert/strict';
import { demoUtilityHistory, readUtilityHistory, readUtilityStatistics, utilityConsumptionSeries, utilityPeriodTotals } from '../src/gas.js';

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
  assert.ok(Math.abs(result.totals.hours24.value - 0.24) < 0.000001);
  assert.ok(Math.abs(result.totals.days7.value - 1.68) < 0.000001);
  assert.ok(Math.abs(result.totals.days30.value - 7.2) < 0.000001);
  assert.equal(result.totals.hours24.complete, true);
});

test('periodetotalen behouden nulverbruik en markeren ontbrekende meetpunten als onvolledig', () => {
  const totals = utilityPeriodTotals({ hours24: [{ value: 0 }, { value: 0 }], days7: [{ value: 1 }, { value: null }, { value: 2 }], days30: [{ value: null }] });
  assert.deepEqual(totals.hours24, { value: 0, complete: true });
  assert.deepEqual(totals.days7, { value: 3, complete: false });
  assert.deepEqual(totals.days30, { value: null, complete: false });
});

test('lege of ongeldige gasgeschiedenis wordt als niet beschikbaar gemarkeerd', () => {
  assert.equal(utilityConsumptionSeries([], new Date()).available, false);
  assert.equal(utilityConsumptionSeries([[{ last_changed: 'invalid', state: 'unknown' }]], new Date()).available, false);
});

test('vandaag begint om middernacht en is niet het rollende 24-uurtotaal', () => {
  const now = new Date(2026, 9, 12, 12);
  const history = [
    { last_changed: new Date(2026, 9, 11, 18).toISOString(), state: '80' },
    ...Array.from({ length: 13 }, (_, hour) => ({ last_changed: new Date(2026, 9, 12, hour).toISOString(), state: String(100 + hour * 0.1) }))
  ];
  const result = utilityConsumptionSeries([history], now);
  assert.ok(Math.abs(result.today.value - 1.2) < 0.000001);
  assert.equal(result.today.complete, true);
  assert.ok(result.totals.hours24.value > result.today.value);
  assert.deepEqual(utilityConsumptionSeries([history.slice(2)], now).today, { value: null, complete: false });
  assert.equal(utilityConsumptionSeries([[{ last_changed: now.toISOString(), state: '' }]], now).available, false);
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
  }, now, async () => { throw new Error('Geen statistieken.'); });
  assert.equal(requested.url.pathname.includes('/history/period/'), true);
  assert.equal(requested.url.searchParams.get('filter_entity_id'), 'sensor.gas_total');
  assert.equal(requested.url.searchParams.has('minimal_response'), true);
  assert.equal(requested.options.headers.Authorization, 'Bearer test-token');
  assert.equal(result.available, false);
});

test('gas en water vullen oudere dagen aan zonder recente historie dubbel te tellen', async () => {
  const now = new Date('2026-10-14T12:00:00Z');
  for (const utility of ['gas', 'water']) {
    const entityId = `sensor.${utility}_total`;
    const statisticHistory = Array.from({ length: 722 }, (_, index) => ({
      last_changed: new Date(now.getTime() - (721 - index) * 3600000).toISOString(), state: String(index)
    }));
    const statistical = utilityConsumptionSeries([statisticHistory], now);
    const history = statisticHistory.slice(-25);
    const result = await readUtilityHistory({ SUPERVISOR_TOKEN: 'test-token' }, entityId,
      async () => ({ ok: true, json: async () => [history] }), now,
      async (_env, requestedId) => { assert.equal(requestedId, entityId); return statistical; });
    assert.equal(result.series.days30.length, 30);
    assert.ok(result.series.days30.every(bucket => bucket.value === 24));
    assert.equal(result.totals.days30.value, 720);
    assert.equal(result.totals.hours24.value, 24);
  }
});

test('meterhistorie blijft beschikbaar bij statistiekuitval en statistieken bij historieuitval', async () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const history = [{ last_changed: '2026-10-14T10:00:00Z', state: '100' },
    { last_changed: '2026-10-14T11:00:00Z', state: '101' }];
  const expected = utilityConsumptionSeries([history], now);
  const fallback = await readUtilityHistory({ SUPERVISOR_TOKEN: 'test-token' }, 'sensor.water',
    async () => ({ ok: true, json: async () => [history] }), now,
    async () => { throw new Error('Statistieken uitgevallen.'); });
  assert.deepEqual(fallback, expected);
  const statisticsOnly = await readUtilityHistory({ SUPERVISOR_TOKEN: 'test-token' }, 'sensor.water',
    async () => { throw new Error('Historie uitgevallen.'); }, now, async () => expected);
  assert.deepEqual(statisticsOnly, expected);
  await assert.rejects(readUtilityHistory({ SUPERVISOR_TOKEN: 'test-token' }, 'sensor.water',
    async () => { throw new Error('Historie uitgevallen.'); }, now,
    async () => utilityConsumptionSeries([], now)), /Historie uitgevallen/);
});

test('gas- en waterstatistieken gebruiken alleen de gekoppelde volumemeter en m3-conversie', async () => {
  const now = new Date('2026-10-14T12:00:00Z');
  for (const [entityId, unit] of [['sensor.gas', 'm³'], ['sensor.water', 'L']]) {
    const commands = [];
    let closed = false;
    class FakeSocket extends EventTarget {
      constructor(url) {
        super();
        assert.equal(url, 'ws://supervisor/core/websocket');
        queueMicrotask(() => this.message({ type: 'auth_required' }));
      }
      message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
      send(payload) {
        const command = JSON.parse(payload);
        commands.push(command);
        if (command.type === 'auth') {
          queueMicrotask(() => this.message({ type: 'auth_ok' }));
          return;
        }
        assert.deepEqual(command.statistic_ids, [entityId]);
        const result = command.type === 'recorder/get_statistics_metadata'
          ? [{ statistic_id: entityId, has_sum: true, statistics_unit_of_measurement: unit }]
          : { [entityId]: [
            { start: now.getTime() - 20 * 86400000, end: now.getTime() - 20 * 86400000 + 3600000, change: 0.5 },
            { start: now.getTime() - 3600000, end: now.getTime(), change: 0 },
            { start: now.getTime() - 3600000, end: now.getTime(), change: -1 },
            { start: now.getTime(), end: now.getTime() + 3600000, change: 50 }
          ] };
        queueMicrotask(() => this.message({ type: 'result', id: command.id, success: true, result }));
      }
      close() { closed = true; }
    }
    const result = await readUtilityStatistics({ SUPERVISOR_TOKEN: 'test-token' }, entityId, now, FakeSocket);
    assert.equal(result.available, true);
    assert.equal(result.totals.days30.value, 0.5);
    assert.equal(result.series.days30.at(-1).value, 0);
    assert.equal(closed, true);
    assert.deepEqual(commands.map(command => command.type), ['auth', 'recorder/get_statistics_metadata', 'recorder/statistics_during_period']);
    assert.deepEqual(commands.at(-1).units, { volume: 'm³' });
    assert.equal(commands.at(-1).period, 'hour');
    assert.deepEqual(commands.at(-1).types, ['change']);
    assert.equal(commands.at(-1).end_time, now.toISOString());
    assert.ok(!JSON.stringify(result).includes('test-token'));
  }
});