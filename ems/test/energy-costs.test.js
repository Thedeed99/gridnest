import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnergyCosts, recordEnergyPrices, summarizeEnergyCosts, validateEnergyCostPreferences } from '../src/energy-costs.js';

const costs = {
  electricity: { enabled: true, rate: { source: 'manual', value: 0.2, entityId: null } },
  gas: { enabled: true, rate: { source: 'manual', value: 1.25, entityId: null } },
  water: { enabled: true, rate: { source: 'entity', value: null, entityId: 'sensor.water_rate' } }
};

test('één all-in tarief geldt voor laag/hoog naast gas en water voor vandaag en deze maand', () => {
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
    ['electricity', 1, 4], ['gas', 0.63, 5.63], ['water', 0.3, 3.3]
  ]);
  assert.equal(summary.resources[0].days30, undefined);
  assert.equal(summary.resources[0].details[1].todayCost, 0.6000000000000001);
});

test('dynamische prijs wordt per uur tijdgewogen en ontbrekende prijshistorie blijft onvolledig', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const options = {
    costs: { ...costs, electricity: { ...costs.electricity, rate: { source: 'entity', value: null, entityId: 'sensor.high_rate' } }, gas: { ...costs.gas, enabled: false }, water: { ...costs.water, enabled: false } },
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
  await recordEnergyPrices({ ...costs, electricity: { ...costs.electricity, rate: { source: 'entity', value: null, entityId: 'sensor.high_rate' } } }, [
    { id: 'sensor.high_rate', domain: 'sensor', state: '-0.04', unit: '€/kWh', available: true },
    { id: 'sensor.water_rate', domain: 'sensor', state: 'unknown', unit: 'EUR/m³', available: false }
  ], priceHistory, 1234);
  assert.deepEqual(recorded, [['sensor.high_rate', -0.04, 1234], ['sensor.water_rate', null, 1234]]);
});

test('kosten blijven verborgen als de bron uit staat en missen geen tarief stilzwijgend', () => {
  const summary = summarizeEnergyCosts({
    costs: { ...costs, electricity: { ...costs.electricity, rate: { source: 'entity', value: null, entityId: 'sensor.missing_rate' } }, water: { ...costs.water, enabled: false } },
    mappings: { electricityLow: 'sensor.low_kwh', electricityHigh: null, gasConsumption: null, waterConsumption: null },
    entities: [], statistics: { 'sensor.low_kwh': [{ end: Date.parse('2026-10-15T11:00:00Z'), change: 2 }] },
    now: new Date('2026-10-15T12:00:00Z'), timeZone: 'Europe/Amsterdam'
  });
  assert.deepEqual(summary.resources.map(resource => resource.key), ['electricity', 'gas']);
  assert.equal(summary.resources[0].today, null);
  assert.match(summary.resources[0].status, /tarief/i);
});

test('prijssensoren moeten de juiste euro-eenheid hebben', () => {
  const preferences = { costs: { ...costs, electricity: { ...costs.electricity, rate: { source: 'entity', value: null, entityId: 'sensor.high_rate' } } } };
  assert.doesNotThrow(() => validateEnergyCostPreferences(preferences, [
    { id: 'sensor.high_rate', domain: 'sensor', unit: '€/kWh' },
    { id: 'sensor.water_rate', domain: 'sensor', unit: 'EUR/m³' }
  ]));
  assert.throws(() => validateEnergyCostPreferences(preferences, [
    { id: 'sensor.high_rate', domain: 'sensor', unit: '%' },
    { id: 'sensor.water_rate', domain: 'sensor', unit: 'EUR/m³' }
  ]), /EUR\/kWh/);
});

test('Home Assistant vraagt alleen statistieken op voor gekoppelde verbruiks- en teruglevermeters', async () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const config = {
    mappings: { electricityLow: 'sensor.low', electricityHigh: null, electricityReturnLow: 'sensor.return_low', electricityReturnHigh: null,
      gasConsumption: 'sensor.gas', waterConsumption: null },
    preferences: { costs: {
      electricity: { enabled: true, rate: { source: 'manual', value: 0.2 } },
      feedIn: { enabled: true, rate: { source: 'manual', value: 0.1 } },
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
        unit_class: ['sensor.low', 'sensor.return_low'].includes(statistic_id) ? 'energy' : 'volume' }));
      if (command.type === 'recorder/statistics_during_period') {
        requestedIds = command.statistic_ids;
        requestedStartTime = command.start_time;
        result = Object.fromEntries(command.statistic_ids.map(id => [id, [{ start: now.getTime() - 3600000, end: now.getTime(), change: id === 'sensor.low' ? 2 : id === 'sensor.return_low' ? 3 : 0.5 }]]));
      }
      queueMicrotask(() => this.message({ id: command.id, type: 'result', success: true, result }));
    }
    close() {}
  }
  const result = await readEnergyCosts({ SUPERVISOR_TOKEN: 'test-token' }, config, [], now, FakeSocket);
  assert.deepEqual(requestedIds, ['sensor.low', 'sensor.return_low', 'sensor.gas']);
  assert.equal(requestedStartTime, '2026-09-30T22:00:00.000Z');
  assert.deepEqual(result.resources.map(resource => [resource.key, Number(resource.today.toFixed(3))]), [['electricity', 0.4], ['feedIn', 0.3], ['gas', 0.625]]);
});

test('zes decimalen blijven behouden en oude totaalmeter werkt als terugval', () => {
  const summary = summarizeEnergyCosts({
    costs: { ...costs, electricity: { enabled: true, rate: { source: 'manual', value: 0.234567 } },
      gas: { ...costs.gas, enabled: false }, water: { ...costs.water, enabled: false },
      feedIn: { enabled: true, rate: { source: 'manual', value: 0.123456 } } },
    mappings: { electricityConsumption: 'sensor.import', electricityLow: 'sensor.low', electricityHigh: 'sensor.high', electricityReturn: 'sensor.export' },
    statistics: Object.fromEntries([['sensor.import', 10], ['sensor.low', 4], ['sensor.high', 6], ['sensor.export', 3]].map(([id, change]) => [id, [{ end: Date.parse('2026-10-15T11:00:00Z'), change }]])),
    entities: [], now: new Date('2026-10-15T12:00:00Z'), timeZone: 'Europe/Amsterdam'
  });
  assert.equal(summary.resources[0].today, 10 * 0.234567);
  assert.equal(summary.resources[0].details.length, 2);
  assert.equal(summary.resources[1].today, 3 * 0.123456);
  assert.equal(summary.resources[1].month, 3 * 0.123456);
  assert.equal(summary.resources[1].status, null);
});

test('laag en hoog worden apart gekoppeld voor zowel verbruik als teruglevering', () => {
  const summary = summarizeEnergyCosts({
    costs: { ...costs, electricity: { enabled: true, rate: { source: 'manual', value: 0.2 } },
      feedIn: { enabled: true, rate: { source: 'manual', value: 0.1 } }, gas: { ...costs.gas, enabled: false }, water: { ...costs.water, enabled: false } },
    mappings: { electricityLow: 'sensor.import_low', electricityHigh: 'sensor.import_high',
      electricityReturnLow: 'sensor.export_low', electricityReturnHigh: 'sensor.export_high' },
    statistics: Object.fromEntries([['sensor.import_low', 2], ['sensor.import_high', 3], ['sensor.export_low', 4], ['sensor.export_high', 5]]
      .map(([id, change]) => [id, [{ end: Date.parse('2026-10-15T11:00:00Z'), change }]])),
    entities: [], now: new Date('2026-10-15T12:00:00Z'), timeZone: 'Europe/Amsterdam'
  });
  assert.deepEqual(summary.resources.map(resource => [resource.key, resource.today, resource.details.map(detail => detail.label)]), [
    ['electricity', 1, ['Laag', 'Hoog']], ['feedIn', 0.9, ['Laag', 'Hoog']]
  ]);
});

test('ontbrekende maandprijzen verbergen een bekende dagopbrengst niet', () => {
  const options = {
    costs: { ...costs, electricity: { ...costs.electricity, enabled: false }, gas: { ...costs.gas, enabled: false }, water: { ...costs.water, enabled: false },
      feedIn: { enabled: true, rate: { source: 'entity', entityId: 'sensor.price' } } },
    mappings: { electricityReturn: 'sensor.export' },
    entities: [{ id: 'sensor.price', domain: 'sensor', state: '0.123456', unit: 'EUR/kWh', available: true }],
    statistics: { 'sensor.export': [
      { end: Date.parse('2026-10-02T11:00:00Z'), change: 5 },
      { end: Date.parse('2026-10-15T11:00:00Z'), change: 2 }
    ] },
    priceHistory: { 'sensor.price': [{ at: Date.parse('2026-10-15T10:00:00Z'), value: 0.123456 }] },
    now: new Date('2026-10-15T12:00:00Z'), timeZone: 'Europe/Amsterdam'
  };
  const resource = summarizeEnergyCosts(options).resources[0];
  assert.equal(resource.today, 2 * 0.123456);
  assert.equal(resource.month, null);
  assert.match(resource.status, /historie/);
  const missing = summarizeEnergyCosts({ ...options, mappings: {} }).resources[0];
  assert.match(missing.status, /Koppel een kWh-meter/);
  assert.equal(missing.today, null);
  const zero = summarizeEnergyCosts({ ...options, statistics: { 'sensor.export': [{ end: Date.parse('2026-10-15T11:00:00Z'), change: 0 }] } }).resources[0];
  assert.equal(zero.today, 0);
});