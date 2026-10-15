import { DateTime } from 'luxon';
import { readStatisticsConnection } from './energy-statistics.js';

const unitKey = unit => String(unit ?? '').replaceAll('³', '3').replaceAll('€', 'EUR').replaceAll(' ', '').toLowerCase();
const maxSampleAgeMs = 65 * 60 * 1000;
const sampleIntervalMs = 55 * 60 * 1000;

export function validateEnergyCostPreferences(preferences, entities) {
  const rates = [
    [preferences.costs.electricity.lowRate, 'EUR/kWh'], [preferences.costs.electricity.highRate, 'EUR/kWh'],
    [preferences.costs.gas.rate, 'EUR/m³'], [preferences.costs.water.rate, 'EUR/m³']
  ];
  for (const [rate, expectedUnit] of rates) {
    if (rate.source !== 'entity' || !rate.entityId) continue;
    const entity = entities.find(item => item.id === rate.entityId);
    if (entity && (entity.domain !== 'sensor' || unitKey(entity.unit) !== unitKey(expectedUnit))) {
      throw new Error(`De prijssensor moet een sensor zijn met eenheid ${expectedUnit}.`);
    }
  }
}

function priceFor(rate, unit, entities) {
  if (rate.source === 'manual') return Number.isFinite(rate.value) ? rate.value : null;
  const entity = entities.find(item => item.id === rate.entityId);
  if (!entity?.available || entity.domain !== 'sensor' || unitKey(entity.unit) !== unitKey(unit)) return null;
  const state = String(entity.state ?? '').trim();
  const value = state ? Number(state) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

function periodUsage(points, start, end) {
  const changes = points.filter(point => Number.isFinite(point.end) && point.end > start && point.end <= end && Number.isFinite(point.change) && point.change >= 0);
  return changes.length ? changes.reduce((total, point) => total + point.change, 0) : null;
}

function intervalPrice(samples, start, end) {
  let sampleIndex = -1;
  for (let index = 0; index < samples.length && samples[index].at <= start; index++) sampleIndex = index;
  if (sampleIndex < 0) return null;
  let cursor = start;
  let weightedPrice = 0;
  while (cursor < end) {
    const sample = samples[sampleIndex];
    const next = samples[sampleIndex + 1];
    const segmentEnd = Math.min(end, next?.at ?? end);
    if (sample.value === null || cursor - sample.at > maxSampleAgeMs || segmentEnd - sample.at > maxSampleAgeMs) return null;
    weightedPrice += sample.value * (segmentEnd - cursor);
    cursor = segmentEnd;
    if (cursor < end) sampleIndex++;
  }
  return weightedPrice / (end - start);
}

function historicalCost(points, samples, start, end) {
  const changes = points.filter(point => Number.isFinite(point.end) && point.end > start && point.end <= end && Number.isFinite(point.change) && point.change >= 0);
  if (!changes.length) return null;
  let total = 0;
  for (const point of changes) {
    const intervalEnd = point.end;
    const intervalStart = Number.isFinite(point.start) ? point.start : intervalEnd - 60 * 60 * 1000;
    const overlapStart = Math.max(start, intervalStart);
    const overlapEnd = Math.min(end, intervalEnd);
    const price = intervalPrice(samples, overlapStart, overlapEnd);
    if (price === null) return null;
    total += point.change * ((overlapEnd - overlapStart) / (intervalEnd - intervalStart)) * price;
  }
  return total;
}

export function recordEnergyPrices(costs, entities, priceHistory, now = Date.now()) {
  const rates = [
    ...(costs.electricity.enabled ? [[costs.electricity.lowRate, 'EUR/kWh'], [costs.electricity.highRate, 'EUR/kWh']] : []),
    ...(costs.gas.enabled ? [[costs.gas.rate, 'EUR/m³']] : []),
    ...(costs.water.enabled ? [[costs.water.rate, 'EUR/m³']] : [])
  ].filter(([rate]) => rate.source === 'entity' && rate.entityId);
  const byId = new Map(rates.map(([rate, unit]) => [rate.entityId, unit]));
  return Promise.all([...byId].map(([entityId, expectedUnit]) => {
    const entity = entities.find(item => item.id === entityId);
    if (!entity?.available || entity.domain !== 'sensor' || unitKey(entity.unit) !== unitKey(expectedUnit)) return priceHistory.record(entityId, null, now);
    const state = String(entity.state ?? '').trim();
    const value = state ? Number(state) : Number.NaN;
    return priceHistory.record(entityId, Number.isFinite(value) ? value : null, now);
  }));
}

export function summarizeEnergyCosts({ costs, mappings, entities, statistics, priceHistory = {}, now = new Date(), timeZone }) {
  const localNow = DateTime.fromJSDate(now, { zone: timeZone });
  if (!localNow.isValid) throw new Error('Home Assistant-tijdzone is ongeldig.');
  const todayStart = localNow.startOf('day').toMillis();
  const monthStart = localNow.startOf('month').toMillis();
  const days30Start = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const resources = [
    { key: 'electricity', label: 'Stroom', enabled: costs.electricity.enabled, unit: 'kWh', meters: [
      { label: 'Laag', id: mappings.electricityLow, rate: costs.electricity.lowRate, priceUnit: 'EUR/kWh' },
      { label: 'Hoog', id: mappings.electricityHigh, rate: costs.electricity.highRate, priceUnit: 'EUR/kWh' }
    ] },
    { key: 'gas', label: 'Gas', enabled: costs.gas.enabled, unit: 'm³', meters: [
      { label: 'Gas', id: mappings.gasConsumption, rate: costs.gas.rate, priceUnit: 'EUR/m³' }
    ] },
    { key: 'water', label: 'Water', enabled: costs.water.enabled, unit: 'm³', meters: [
      { label: 'Water', id: mappings.waterConsumption, rate: costs.water.rate, priceUnit: 'EUR/m³' }
    ] }
  ];
  return {
    today: now.toISOString(),
    resources: resources.filter(resource => resource.enabled).map(resource => {
      const details = resource.meters.map(meter => {
        const price = priceFor(meter.rate, meter.priceUnit, entities);
        const hasRate = meter.rate.source === 'manual' ? meter.rate.value !== null : Boolean(meter.rate.entityId);
        const active = Boolean(meter.id && hasRate);
        const points = statistics[meter.id] ?? [];
        const todayUsage = meter.id ? periodUsage(points, todayStart, now.getTime()) : null;
        const monthUsage = meter.id ? periodUsage(points, monthStart, now.getTime()) : null;
        const days30Usage = meter.id ? periodUsage(points, days30Start, now.getTime()) : null;
        const todayCost = meter.rate.source === 'manual'
          ? todayUsage === null || price === null ? null : todayUsage * price
          : historicalCost(points, priceHistory[meter.rate.entityId] ?? [], todayStart, now.getTime());
        const monthCost = meter.rate.source === 'manual'
          ? monthUsage === null || price === null ? null : monthUsage * price
          : historicalCost(points, priceHistory[meter.rate.entityId] ?? [], monthStart, now.getTime());
        const days30Cost = meter.rate.source === 'manual'
          ? days30Usage === null || price === null ? null : days30Usage * price
          : historicalCost(points, priceHistory[meter.rate.entityId] ?? [], days30Start, now.getTime());
        return { label: meter.label, price, todayUsage, monthUsage, days30Usage,
          todayCost, monthCost, days30Cost, active };
      }).filter(detail => detail.active);
      const configured = details.length > 0 && details.every(detail => detail.todayCost !== null && detail.monthCost !== null && detail.days30Cost !== null);
      const total = key => configured ? details.reduce((sum, detail) => sum + detail[key], 0) : null;
      return { key: resource.key, label: resource.label, unit: resource.unit, today: total('todayCost'), month: total('monthCost'), days30: total('days30Cost'),
        status: details.length === 0 ? 'Stel een meter en tarief in' : configured ? null : 'Tarief of statistieken ontbreken',
        details: details.map(({ label, price, todayUsage, monthUsage, days30Usage, todayCost, monthCost, days30Cost }) => ({ label, price, todayUsage, monthUsage, days30Usage, todayCost, monthCost, days30Cost })) };
    })
  };
}

export async function readEnergyCosts(env, config, entities, now = new Date(), Socket = WebSocket, priceHistory = {}) {
  const costs = config.preferences.costs;
  const mappings = config.mappings;
  const ids = [...new Set([
    ...(costs.electricity.enabled ? [mappings.electricityLow, mappings.electricityHigh] : []),
    ...(costs.gas.enabled ? [mappings.gasConsumption] : []),
    ...(costs.water.enabled ? [mappings.waterConsumption] : [])
  ].filter(Boolean))];
  if (!ids.length) return summarizeEnergyCosts({ costs, mappings, entities, statistics: {}, priceHistory, now, timeZone: 'Europe/Amsterdam' });
  return readStatisticsConnection(env, async call => {
    const configResult = await call({ type: 'get_config' });
    const localNow = DateTime.fromJSDate(now, { zone: configResult.time_zone });
    if (!localNow.isValid) throw new Error('Home Assistant-tijdzone ontbreekt of is ongeldig.');
    const metadata = await call({ type: 'recorder/get_statistics_metadata', statistic_ids: ids });
    if (!Array.isArray(metadata)) throw new Error('Ongeldige meterstatistiekmetadata.');
    const unitClass = new Map([[mappings.electricityLow, 'energy'], [mappings.electricityHigh, 'energy'],
      [mappings.gasConsumption, 'volume'], [mappings.waterConsumption, 'volume']]);
    const validIds = metadata.filter(item => item.has_sum && item.unit_class === unitClass.get(item.statistic_id)).map(item => item.statistic_id);
    const statistics = validIds.length ? await call({ type: 'recorder/statistics_during_period',
      start_time: DateTime.fromMillis(now.getTime() - 30 * 24 * 60 * 60 * 1000, { zone: configResult.time_zone }).toUTC().toISO(), end_time: now.toISOString(), statistic_ids: validIds,
      period: 'hour', units: { energy: 'kWh', volume: 'm³' }, types: ['change'] }) : {};
    if (!statistics || typeof statistics !== 'object' || Array.isArray(statistics)) throw new Error('Ongeldige verbruiksstatistieken.');
    return summarizeEnergyCosts({ costs, mappings, entities, statistics, priceHistory, now, timeZone: configResult.time_zone });
  }, Socket);
}

export function demoEnergyCosts(config, entities, now = new Date()) {
  const localNow = DateTime.fromJSDate(now, { zone: 'Europe/Amsterdam' });
  const todayStart = localNow.startOf('day').toMillis();
  const monthStart = localNow.startOf('month').toMillis();
  const days30Start = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const values = {
    electricityLow: [125, 4.2], electricityHigh: [98, 3.4],
    gasConsumption: [14.5, 0.7], waterConsumption: [4.8, 0.18]
  };
  const mappingIds = {
    electricityLow: config.mappings.electricityLow, electricityHigh: config.mappings.electricityHigh,
    gasConsumption: config.mappings.gasConsumption, waterConsumption: config.mappings.waterConsumption
  };
  const statistics = {};
  for (const [key, id] of Object.entries(mappingIds)) {
    if (!id) continue;
    const [monthUsage, todayUsage] = values[key];
    statistics[id] = [
      { start: days30Start, end: monthStart, change: 0 },
      { start: monthStart, end: todayStart, change: Math.max(0, monthUsage - todayUsage) },
      { start: todayStart, end: now.getTime(), change: todayUsage }
    ];
  }
  const priceHistory = {};
  const rates = [
    ...(config.preferences.costs.electricity.enabled ? [config.preferences.costs.electricity.lowRate, config.preferences.costs.electricity.highRate] : []),
    ...(config.preferences.costs.gas.enabled ? [config.preferences.costs.gas.rate] : []),
    ...(config.preferences.costs.water.enabled ? [config.preferences.costs.water.rate] : [])
  ].filter(rate => rate.source === 'entity' && rate.entityId);
  for (const rate of rates) {
    const entity = entities.find(item => item.id === rate.entityId);
    const value = Number(entity?.state);
    if (!entity?.available || !Number.isFinite(value)) continue;
    priceHistory[rate.entityId] = [];
    for (let at = days30Start - sampleIntervalMs; at <= now.getTime(); at += sampleIntervalMs) priceHistory[rate.entityId].push({ at, value });
  }
  return summarizeEnergyCosts({ costs: config.preferences.costs, mappings: config.mappings, entities, statistics, priceHistory, now, timeZone: 'Europe/Amsterdam' });
}