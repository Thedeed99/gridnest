import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnergyCosts, recordEnergyPrices, summarizeEnergyCosts, validateEnergyCostPreferences } from '../src/energy-costs.js';

const costs = {
  electricity: { enabled: true, lowRate: { source: 'manual', value: 0.2, entityId: null }, highRate: { source: 'entity', value: null, entityId: 'sensor.high_rate' } },
  gas: { enabled: true, rate: { source: 'manual', value: 1.25, entityId: null } },
  water: { enabled: true, rate: { source: 'entity', value: null, entityId: 'sensor.water_rate' } }
};

test('kosten groeperen laag/hoog, gas en water voor vandaag en deze maand', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const summary = summarizeEnergyCosts({
    costs,
    mappings: { electricityLow: 'sensor.low_kwh', electricityHigh: 'sensor.high_kwh', gasConsumption: 'sensor.gas', waterConsumption: 'sensor.water' },
    entities: [
      { id: 'sensor.high_rate', domain: 'sensor', state: '0.30', unit: 'EUR/kWh', available: true },
      { id: 'sensor.water_rate', domain: 'sensor', state: '1.50', unit: 'EUR/m³', available: true }
    ],
    statistics: {
      'sensor.low_kwh': [{ end: Date.parse('2026-10-02T12:00:00Z'), change: 10 }, { end: Date.parse('2026-10-15T11:00:00Z'), change: 2 }],
      'sensor.high_kwh': [{ end: Date.parse('2026-10-02T12:00:00Z'), change: 5 }, { end: Date.parse('2026-10-15T11:00:00Z'), change: 3 }],
      'sensor.gas': [{ end: Date.parse('2026-10-02T12:00:00Z'), change: 4 }, { end: Date.parse('2026-10-15T11:00:00Z'), change: 0.5 }],
      'sensor.water': [{ end: Date.parse('2026-10-02T12:00:00Z'), change: 2 }, { end: Date.parse('2026-10-15T11:00:00Z'), change: 0.2 }]
    },
    priceHistory: {
      'sensor.high_rate': [
        { at: Date.parse('2026-10-02T11:00:00Z'), value: 0.2 }, { at: Date.parse('2026-10-02T11:30:00Z'), value: 0.4 },
        { at: Date.parse('2026-10-15T10:00:00Z'), value: 0.3 }, { at: Date.parse('2026-10-15T10:30:00Z'), value: 0.3 }
      ],
      'sensor.water_rate': [
        { at: Date.parse('2026-10-02T11:00:00Z'), value: 1.5 }, { at: Date.parse('2026-10-02T11:30:00Z'), value: 1.5 },
        { at: Date.parse('2026-10-15T10:00:00Z'), value: 1.5 }, { at: Date.parse('2026-10-15T10:30:00Z'), value: 1.5 }
      ]
    },
    now,
    timeZone: 'Europe/Amsterdam'
  });
  assert.deepEqual(summary.resources.map(resource => [resource.key, Number(resource.today.toFixed(2)), Number(resource.month.toFixed(2))]), [
    ['electricity', 1.3, 4.8], ['gas', 0.63, 5.63], ['water', 0.3, 3.3]
  ]);
  assert.deepEqual(summary.resources.map(resource => Number(resource.days30.toFixed(2))), [4.8, 5.63, 3.3]);
  assert.equal(summary.resources[0].details[1].todayCost, 0.8999999999999999);
});

test('dynamische prijs wordt per uur tijdgewogen en ontbrekende prijshistorie blijft onvolledig', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const options = {
    costs: { ...costs, electricity: { ...costs.electricity, lowRate: { source: 'entity', value: null, entityId: 'sensor.high_rate' }, highRate: { source: 'manual', value: null, entityId: null } }, gas: { ...costs.gas, enabled: false }, water: { ...costs.water, enabled: false } },
    mappings: { electricityLow: 'sensor.low_kwh', electricityHigh: null, gasConsumption: null, waterConsumption: null },
    entities: [{ id: 'sensor.high_rate', domain: 'sensor', state: '-0.02', unit: 'EUR/kWh', available: true }],
    statistics: { 'sensor.low_kwh': [{ start: Date.parse('2026-10-15T10:00:00Z'), end: Date.parse('2026-10-15T11:00:00Z'), change: 2 }] },
    now, timeZone: 'Europe/Amsterdam'
  };
  const priced = summarizeEnergyCosts({ ...options, priceHistory: { 'sensor.high_rate': [
    { at: Date.parse('2026-10-15T10:00:00Z'), value: 0.2 }, { at: Date.parse('2026-10-15T10:30:00Z'), value: -0.1 }
  ] } });
  assert.equal(priced.resources[0].today, 0.1);
  const missing = summarizeEnergyCosts(options);
  assert.equal(missing.resources[0].today, null);
  assert.match(missing.resources[0].status, /tarief/i);
});

test('prijsopname volgt alleen actieve sensoren en bewaart negatieve of onbeschikbare tarieven', async () => {
  const recorded = [];
  const priceHistory = { record: async (...sample) => recorded.push(sample) };
  await recordEnergyPrices(costs, [
    { id: 'sensor.high_rate', domain: 'sensor', state: '-0.04', unit: '€/kWh', available: true },
    { id: 'sensor.water_rate', domain: 'sensor', state: 'unknown', unit: 'EUR/m³', available: false }
  ], priceHistory, 1234);
  assert.deepEqual(recorded, [['sensor.high_rate', -0.04, 1234], ['sensor.water_rate', null, 1234]]);
});

test('kosten blijven verborgen als de bron uit staat en missen geen tarief stilzwijgend', () => {
  const summary = summarizeEnergyCosts({
    costs: { ...costs, electricity: { ...costs.electricity, lowRate: { source: 'entity', value: null, entityId: 'sensor.missing_rate' } }, water: { ...costs.water, enabled: false } },
    mappings: { electricityLow: 'sensor.low_kwh', electricityHigh: null, gasConsumption: null, waterConsumption: null },
    entities: [], statistics: { 'sensor.low_kwh': [{ end: Date.parse('2026-10-15T11:00:00Z'), change: 2 }] },
    now: new Date('2026-10-15T12:00:00Z'), timeZone: 'Europe/Amsterdam'
  });
  assert.deepEqual(summary.resources.map(resource => resource.key), ['electricity', 'gas']);
  assert.equal(summary.resources[0].today, null);
  assert.match(summary.resources[0].status, /tarief/i);
});

test('prijssensoren moeten de juiste euro-eenheid hebben', () => {
  const preferences = { costs };
  assert.doesNotThrow(() => validateEnergyCostPreferences(preferences, [
    { id: 'sensor.high_rate', domain: 'sensor', unit: '€/kWh' },
    { id: 'sensor.water_rate', domain: 'sensor', unit: 'EUR/m³' }
  ]));
  assert.throws(() => validateEnergyCostPreferences(preferences, [
    { id: 'sensor.high_rate', domain: 'sensor', unit: '%' },
    { id: 'sensor.water_rate', domain: 'sensor', unit: 'EUR/m³' }
  ]), /EUR\/kWh/);
});

test('Home Assistant levert alleen statistieken van ingeschakelde gekoppelde meters', async () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const config = {
    mappings: { electricityLow: 'sensor.low', electricityHigh: null, gasConsumption: 'sensor.gas', waterConsumption: null },
    preferences: { costs: {
      electricity: { enabled: true, lowRate: { source: 'manual', value: 0.2 }, highRate: { source: 'manual', value: 0.3 } },
      gas: { enabled: true, rate: { source: 'manual', value: 1.25 } },
      water: { enabled: false, rate: { source: 'manual', value: 1.5 } }
    } }
  };
  let requestedIds;
  let requestedStartTime;
  class FakeSocket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.message({ type: 'auth_required' })); }
    message(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
    send(payload) {
      const command = JSON.parse(payload);
      if (command.type === 'auth') { queueMicrotask(() => this.message({ type: 'auth_ok' })); return; }
      let result;
      if (command.type === 'get_config') result = { time_zone: 'Europe/Amsterdam' };
      if (command.type === 'recorder/get_statistics_metadata') result = command.statistic_ids.map(statistic_id => ({ statistic_id, has_sum: true,
        unit_class: statistic_id === 'sensor.low' ? 'energy' : 'volume' }));
      if (command.type === 'recorder/statistics_during_period') {
        requestedIds = command.statistic_ids;
        requestedStartTime = command.start_time;
        result = Object.fromEntries(command.statistic_ids.map(id => [id, [{ start: now.getTime() - 3600000, end: now.getTime(), change: id === 'sensor.low' ? 2 : 0.5 }]]));
      }
      queueMicrotask(() => this.message({ id: command.id, type: 'result', success: true, result }));
    }
    close() {}
  }
  const result = await readEnergyCosts({ SUPERVISOR_TOKEN: 'test-token' }, config, [], now, FakeSocket);
  assert.deepEqual(requestedIds, ['sensor.low', 'sensor.gas']);
  assert.equal(Date.parse(requestedStartTime), now.getTime() - 30 * 24 * 60 * 60 * 1000);
  assert.deepEqual(result.resources.map(resource => [resource.key, resource.today]), [['electricity', 0.4], ['gas', 0.625]]);
});