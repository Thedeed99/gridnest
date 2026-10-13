import test from 'node:test';
import assert from 'node:assert/strict';
import { energyDayRange, energyStatisticGroups, officialEnergyRows, readOfficialEnergy } from '../src/energy-statistics.js';

test('officiele recap gebruikt de Energie-instellingen en geen vermogensschatting', () => {
  const preferences = { energy_sources: [
    { type: 'grid', flow_from: [{ stat_energy_from: 'sensor.import' }], flow_to: [{ stat_energy_to: 'sensor.export' }] },
    { type: 'solar', stat_energy_from: 'sensor.solar' }, { type: 'gas', stat_energy_from: 'sensor.gas' }
  ] };
  const groups = energyStatisticGroups(preferences);
  const statistics = { 'sensor.import': [{ change: 10.6 }], 'sensor.export': [{ change: 0.05 }], 'sensor.solar': [{ change: 0.21 }], 'sensor.gas': [{ change: 1.49 }] };
  const rows = officialEnergyRows(groups, statistics, [{ statistic_id: 'sensor.gas', statistics_unit_of_measurement: 'm³' }]);
  assert.ok(Math.abs(rows[0].value - 10.76) < 0.000001);
  assert.equal(rows[1].value, 0.05);
  assert.equal(rows[2].value, 1.49);
  assert.ok(rows.every(row => row.source === 'home-assistant'));
});

test('batterijrichtingen en laadpaalteller zijn expliciet; ontbrekende statistieken blijven onbekend', () => {
  const groups = energyStatisticGroups({ energy_sources: [{ type: 'grid', stat_energy_from: 'sensor.grid' },
    { type: 'battery', stat_energy_from: 'sensor.discharge', stat_energy_to: 'sensor.charge' }] }, { evEnergyTotal: 'sensor.ev_energy' });
  const rows = officialEnergyRows(groups, { 'sensor.grid': [{ change: 3 }], 'sensor.charge': [{ change: 1 }], 'sensor.discharge': [{ change: 2 }], 'sensor.ev_energy': [{ change: 0 }] });
  assert.equal(rows.find(row => row.label === 'Woningverbruik').value, 4);
  assert.equal(rows.find(row => row.label === 'Laadpaal').value, 0);
  assert.equal(rows.find(row => row.label === 'Batterij laden').value, 1);
  assert.equal(officialEnergyRows(groups, {}).find(row => row.label === 'Woningverbruik').value, null);
});

test('daggrens gebruikt Home Assistant-tijdzone, ook op zomertijdwissels', () => {
  assert.equal(energyDayRange(new Date('2026-10-12T18:47:00Z'), 'Europe/Amsterdam').start, '2026-10-11T22:00:00.000Z');
  assert.equal(energyDayRange(new Date('2026-03-29T21:00:00Z'), 'Europe/Amsterdam').start, '2026-03-28T23:00:00.000Z');
  assert.throws(() => energyDayRange(new Date(), 'No/such-zone'));
});

test('officiele energietotalen gebruiken alleen leescommando’s en houden het token op de server', async () => {
  const sent = [];
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
      sent.push(command);
      if (command.type === 'auth') {
        assert.equal(command.access_token, 'test-only-token');
        queueMicrotask(() => this.message({ type: 'auth_ok' }));
        return;
      }
      const results = {
        'energy/get_prefs': { energy_sources: [{ type: 'grid', stat_energy_from: 'sensor.grid' }] },
        get_config: { time_zone: 'Europe/Amsterdam' },
        'recorder/get_statistics_metadata': [{ statistic_id: 'sensor.grid', unit_class: 'energy' }],
        'recorder/statistics_during_period': { 'sensor.grid': [{ start: 1791756000000, end: 1791759600000, change: 10.6 }] }
      };
      assert.ok(Object.hasOwn(results, command.type));
      queueMicrotask(() => this.message({ id: command.id, type: 'result', success: true, result: results[command.type] }));
    }
    close() { closed = true; }
  }
  const result = await readOfficialEnergy({ SUPERVISOR_TOKEN: 'test-only-token' }, {}, new Date('2026-10-12T18:47:00Z'), FakeSocket);
  assert.equal(result.rows.find(row => row.label === 'Woningverbruik').value, 10.6);
  assert.equal(closed, true);
  assert.ok(!JSON.stringify(result).includes('test-only-token'));
  assert.ok(sent.every(command => command.type !== 'call_service'));
  assert.deepEqual(sent.at(-1).types, ['change']);
});