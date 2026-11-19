import test from 'node:test';
import assert from 'node:assert/strict';
import { readSolarConsumption, summarizeSolarConsumption } from '../src/solar-consumption.js';

const hour = 3600000;
const start = Date.parse('2026-10-31T23:00:00Z');
const today = Date.parse('2026-11-01T23:00:00Z');
const through = today + 2 * hour;
const now = new Date(through + 10 * 60000);
const electricity = { enabled: true, rateMode: 'single', rate: { source: 'manual', value: 0.3 } };
const groups = { solar: ['sensor.solar'], exported: ['sensor.export'], charged: [], discharged: [] };
function options() {
  const statistics = { 'sensor.solar': [], 'sensor.export': [] };
  for (let at = start; at < through; at += hour) {
    statistics['sensor.solar'].push({ start: at, end: at + hour, change: 2 });
    statistics['sensor.export'].push({ start: at, end: at + hour, change: 0.5 });
  }
  return { groups, statistics, mappings: { batteryMode: 'none' }, electricity, now, timeZone: 'Europe/Amsterdam' };
}

test('eigen zonnestroom voor vandaag en kalendermaand gebruikt dezelfde volledige uren en telt tarieven niet dubbel', () => {
  const summary = summarizeSolarConsumption(options());
  assert.equal(summary.today.energyKwh, 3);
  assert.equal(summary.today.productionKwh, 4);
  assert.equal(summary.today.percentage, 75);
  assert.equal(summary.today.avoidedCost, 3 * 0.3);
  assert.equal(summary.month.energyKwh, 39);
  assert.equal(summary.month.productionKwh, 52);
  assert.equal(summary.month.percentage, 75);
  assert.equal(summary.today.updatedThrough, new Date(through).toISOString());
  assert.equal(summary.month.periodStart, new Date(start).toISOString());
  assert.equal(summary.today.status, null);
});

test('ontbrekende maandhistorie blokkeert vandaag niet, nul blijft nul en een ongeldige balans wordt niet weggepoetst', () => {
  const input = options();
  input.statistics['sensor.export'].shift();
  let summary = summarizeSolarConsumption(input);
  assert.equal(summary.month.energyKwh, null);
  assert.match(summary.month.status, /ontbreken/);
  assert.equal(summary.today.energyKwh, 3);
  for (const points of Object.values(input.statistics)) for (const point of points) point.change = 0;
  summary = summarizeSolarConsumption(input);
  assert.equal(summary.today.energyKwh, 0);
  assert.equal(summary.today.percentage, null);
  assert.equal(summary.today.avoidedCost, 0);
  input.statistics['sensor.export'].at(-1).change = 1;
  summary = summarizeSolarConsumption(input);
  assert.equal(summary.today.energyKwh, null);
  assert.match(summary.today.status, /hoger dan zonneproductie/);
});

test('batterijen, onbekende configuratie, overlappende meters en ontbrekende teruglevering leveren geen misleidende cijfers', () => {
  const input = options();
  for (const mappings of [{ batteryMode: 'unknown' }, { batteryMode: 'measured' }, { batteryMode: 'none', batteries: [{}] }]) {
    const result = summarizeSolarConsumption({ ...input, mappings });
    assert.equal(result.today.energyKwh, null);
    assert.match(result.today.status, /batterij/);
  }
  const battery = summarizeSolarConsumption({ ...input, groups: { ...groups, discharged: ['sensor.battery'] } });
  assert.equal(battery.month.avoidedCost, null);
  const missing = summarizeSolarConsumption({ ...input, groups: { ...groups, exported: [] } });
  assert.match(missing.today.status, /teruglever/);
  const duplicate = summarizeSolarConsumption({ ...input, groups: { ...groups, exported: groups.solar } });
  assert.match(duplicate.today.status, /afzonderlijke meters/);
});

test('eigen zonnestroom gebruikt historische negatieve prijzen en geen huidige prijs als historie ontbreekt', () => {
  const input = options();
  input.electricity = { enabled: true, rate: { source: 'entity', entityId: 'sensor.price' } };
  input.priceHistory = { 'sensor.price': [
    { at: today, value: 0.4 }, { at: today + hour / 2, value: 0.2 }, { at: today + hour, value: -0.1 }
  ] };
  let summary = summarizeSolarConsumption(input);
  assert.ok(Math.abs(summary.today.avoidedCost - 0.3) < 1e-10);
  assert.equal(summary.month.avoidedCost, null);
  assert.match(summary.month.costStatus, /historische prijzen/);
  assert.equal(summary.month.energyKwh, 39);
  summary = summarizeSolarConsumption({ ...input, priceHistory: {} });
  assert.equal(summary.today.avoidedCost, null);
  assert.equal(summary.today.energyKwh, 3);
});

test('vaste prijswijzigingen volgen de lokale datum en laag/hoog of uitgeschakelde prijzen blokkeren alleen euros', () => {
  const input = options();
  input.electricity = { ...electricity, rate: { source: 'manual', value: 0.2, futureRates: [{ effectiveDate: '2026-11-02', value: 0.4 }] } };
  const summary = summarizeSolarConsumption(input);
  assert.ok(Math.abs(summary.today.avoidedCost - 1.2) < 1e-10);
  assert.ok(Math.abs(summary.month.avoidedCost - 8.4) < 1e-10);
  for (const rate of [{ ...electricity, rateMode: 'dual' }, { ...electricity, enabled: false }]) {
    const result = summarizeSolarConsumption({ ...input, electricity: rate });
    assert.equal(result.today.energyKwh, 3);
    assert.equal(result.today.avoidedCost, null);
    assert.ok(result.today.costStatus);
  }
});

test('afgeronde uren en daggrenzen volgen de HA-tijdzone, ook op een wintertijd-dag', () => {
  const input = options();
  const result = summarizeSolarConsumption({ ...input, now: new Date('2026-11-02T00:03:00Z') });
  assert.equal(result.today.updatedThrough, null);
  assert.equal(result.today.energyKwh, null);
  assert.match(result.today.status, /Nog geen volledig uur/);
  const dst = options();
  dst.statistics = { 'sensor.solar': [], 'sensor.export': [] };
  const dayStart = Date.parse('2026-10-24T22:00:00Z');
  const dayEnd = Date.parse('2026-10-25T23:00:00Z');
  for (let at = dayStart; at < dayEnd; at += hour) {
    dst.statistics['sensor.solar'].push({ start: at, end: at + hour, change: 2 });
    dst.statistics['sensor.export'].push({ start: at, end: at + hour, change: 1 });
  }
  const beforeMidnight = summarizeSolarConsumption({ ...dst, now: new Date(dayEnd - 1) });
  assert.equal(beforeMidnight.today.energyKwh, 24);
  assert.equal(beforeMidnight.today.percentage, 50);
});

test('HA leest cumulatieve zonne- en lage/hoge exportmeters als energie in kWh vanaf de maandgrens', async () => {
  const commands = [];
  const config = { mappings: { batteryMode: 'none', solarToday: 'sensor.solar', solarTodayMode: 'total',
    electricityReturnLow: 'sensor.export', electricityReturnHigh: 'sensor.export_high' }, preferences: { costs: { electricity } } };
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.message({ type: 'auth_required' })); }
    message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
    send(payload) {
      const command = JSON.parse(payload);
      commands.push(command);
      if (command.type === 'auth') { queueMicrotask(() => this.message({ type: 'auth_ok' })); return; }
      let result;
      if (command.type === 'energy/get_prefs') result = { energy_sources: [{ type: 'solar', stat_energy_from: 'sensor.other_solar' }] };
      if (command.type === 'get_config') result = { time_zone: 'Europe/Amsterdam' };
      if (command.type === 'recorder/get_statistics_metadata') result = command.statistic_ids.map(statistic_id => ({ statistic_id, has_sum: true, unit_class: 'energy' }));
      if (command.type === 'recorder/statistics_during_period') {
        result = options().statistics;
        result['sensor.export_high'] = result['sensor.export'].map(point => ({ ...point, change: 0 }));
      }
      queueMicrotask(() => this.message({ id: command.id, type: 'result', success: true, result }));
    }
    close() {}
  }
  const result = await readSolarConsumption({ SUPERVISOR_TOKEN: 'test-token' }, config, [], now, Socket);
  const request = commands.find(command => command.type === 'recorder/statistics_during_period');
  assert.deepEqual(request.statistic_ids, ['sensor.solar', 'sensor.export', 'sensor.export_high']);
  assert.equal(request.start_time, '2026-10-31T23:00:00.000Z');
  assert.deepEqual(request.units, { energy: 'kWh' });
  assert.equal(result.today.energyKwh, 3);
  assert.equal(result.today.percentage, 75);
});
