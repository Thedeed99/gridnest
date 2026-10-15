import { DateTime } from 'luxon';
import { readStatisticsConnection } from './energy-statistics.js';

const unitKey = unit => String(unit ?? '').replaceAll('³', '3').replaceAll('€', 'EUR').replaceAll(' ', '').toLowerCase();
const maxSampleAgeMs = 65 * 60 * 1000;
const sampleIntervalMs = 55 * 60 * 1000;

function electricityMeters(mappings, direction) {
  const lowId = direction === 'return' ? mappings.electricityReturnLow : mappings.electricityLow;
  const highId = direction === 'return' ? mappings.electricityReturnHigh : mappings.electricityHigh;
  if (lowId || highId) return [lowId && { label: 'Laag', id: lowId }, highId && { label: 'Hoog', id: highId }].filter(Boolean);
  const totalId = direction === 'return' ? mappings.electricityReturn : mappings.electricityConsumption;
  return totalId ? [{ label: direction === 'return' ? 'Teruglevering' : 'Netafname', id: totalId }] : [];
}

export function validateEnergyCostPreferences(preferences, entities) {
  const rates = [
    ...activeRates(preferences.costs.electricity).map(rate => [rate, 'EUR/kWh']),
    ...activeRates(preferences.costs.feedIn).map(rate => [rate, 'EUR/kWh']),
    [preferences.costs.gas.rate, 'EUR/m³'], [preferences.costs.water.rate, 'EUR/m³']
  ];
  for (const [rate, expectedUnit] of rates) {
    if (!rate || rate.source !== 'entity' || !rate.entityId) continue;
    const entity = entities.find(item => item.id === rate.entityId);
    if (entity && (entity.domain !== 'sensor' || unitKey(entity.unit) !== unitKey(expectedUnit))) {
      throw new Error(`De prijssensor moet een sensor zijn met eenheid ${expectedUnit}.`);
    }
  }
}

function activeRates(resource) {
  if (!resource) return [];
  return resource.rateMode === 'dual' ? [resource.lowRate, resource.highRate] : [resource.rate];
}

function ratesForMeters(resource, meters) {
  return meters.map(meter => ({ ...meter,
    rate: resource.rateMode === 'dual' ? meter.label === 'Laag' ? resource.lowRate : meter.label === 'Hoog' ? resource.highRate : null : resource.rate,
    priceUnit: 'EUR/kWh'
  }));
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
    ...(costs.electricity.enabled ? activeRates(costs.electricity).map(rate => [rate, 'EUR/kWh']) : []),
    ...(costs.feedIn?.enabled ? activeRates(costs.feedIn).map(rate => [rate, 'EUR/kWh']) : []),
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
  const resources = [
    { key: 'electricity', label: 'Stroom', enabled: costs.electricity.enabled, unit: 'kWh', rateMode: costs.electricity.rateMode,
      meters: ratesForMeters(costs.electricity, electricityMeters(mappings, 'consumption')) },
    { key: 'feedIn', label: 'Terugleveropbrengst', enabled: costs.feedIn?.enabled, unit: 'kWh', rateMode: costs.feedIn?.rateMode,
      meters: ratesForMeters(costs.feedIn, electricityMeters(mappings, 'return')) },
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
      const details = resource.meters.filter(meter => meter.id).map(meter => {
        const rate = meter.rate;
        const price = rate ? priceFor(rate, meter.priceUnit, entities) : null;
        const points = statistics[meter.id] ?? [];
        const todayUsage = meter.id ? periodUsage(points, todayStart, now.getTime()) : null;
        const monthUsage = meter.id ? periodUsage(points, monthStart, now.getTime()) : null;
        const todayCost = !rate ? null : rate.source === 'manual'
          ? todayUsage === null || price === null ? null : todayUsage * price
          : historicalCost(points, priceHistory[rate.entityId] ?? [], todayStart, now.getTime());
        const monthCost = !rate ? null : rate.source === 'manual'
          ? monthUsage === null || price === null ? null : monthUsage * price
          : historicalCost(points, priceHistory[rate.entityId] ?? [], monthStart, now.getTime());
        return { label: meter.label, rate, price, todayUsage, monthUsage, todayCost, monthCost };
      });
      const total = key => details.length && details.every(detail => detail[key] !== null) ? details.reduce((sum, detail) => sum + detail[key], 0) : null;
      const today = total('todayCost');
      const month = total('monthCost');
      const hasRate = details.length > 0 && details.every(detail => detail.rate &&
        (detail.rate.source === 'manual' ? detail.rate.value !== null : Boolean(detail.rate.entityId)));
      return { key: resource.key, label: resource.label, unit: resource.unit, today, month,
        status: !details.length ? `Koppel een ${resource.unit}-meter onder Koppelingen` : !hasRate ? 'Vul het tarief in bij Mijn wensen' : today === null || month === null ? 'Tariefhistorie of meterstatistieken ontbreken' : null,
        details };
    })
  };
}

export async function readEnergyCosts(env, config, entities, now = new Date(), Socket = WebSocket, priceHistory = {}) {
  const costs = config.preferences.costs;
  const mappings = config.mappings;
  const ids = [...new Set([
    ...(costs.electricity.enabled ? electricityMeters(mappings, 'consumption').map(meter => meter.id) : []),
    ...(costs.feedIn?.enabled ? electricityMeters(mappings, 'return').map(meter => meter.id) : []),
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
    const unitClass = new Map([
      ...[...electricityMeters(mappings, 'consumption'), ...electricityMeters(mappings, 'return')].map(meter => [meter.id, 'energy']),
      [mappings.gasConsumption, 'volume'], [mappings.waterConsumption, 'volume']
    ]);
    const validIds = metadata.filter(item => item.has_sum && item.unit_class === unitClass.get(item.statistic_id)).map(item => item.statistic_id);
    const statistics = validIds.length ? await call({ type: 'recorder/statistics_during_period',
      start_time: localNow.startOf('month').toUTC().toISO(), end_time: now.toISOString(), statistic_ids: validIds,
      period: 'hour', units: { energy: 'kWh', volume: 'm³' }, types: ['change'] }) : {};
    if (!statistics || typeof statistics !== 'object' || Array.isArray(statistics)) throw new Error('Ongeldige verbruiksstatistieken.');
    return summarizeEnergyCosts({ costs, mappings, entities, statistics, priceHistory, now, timeZone: configResult.time_zone });
  }, Socket);
}

export function demoEnergyCosts(config, entities, now = new Date()) {
  const localNow = DateTime.fromJSDate(now, { zone: 'Europe/Amsterdam' });
  const todayStart = localNow.startOf('day').toMillis();
  const monthStart = localNow.startOf('month').toMillis();
  const values = {
    electricityConsumption: [223, 7.6], electricityReturn: [80, 3.2],
    electricityLow: [125, 4.2], electricityHigh: [98, 3.4],
    electricityReturnLow: [35, 1.4], electricityReturnHigh: [45, 1.8],
    gasConsumption: [14.5, 0.7], waterConsumption: [4.8, 0.18]
  };
  const mappingIds = {
    electricityConsumption: config.mappings.electricityConsumption, electricityReturn: config.mappings.electricityReturn,
    electricityLow: config.mappings.electricityLow, electricityHigh: config.mappings.electricityHigh,
    electricityReturnLow: config.mappings.electricityReturnLow, electricityReturnHigh: config.mappings.electricityReturnHigh,
    gasConsumption: config.mappings.gasConsumption, waterConsumption: config.mappings.waterConsumption
  };
  const statistics = {};
  for (const [key, id] of Object.entries(mappingIds)) {
    if (!id) continue;
    const [monthUsage, todayUsage] = values[key];
    statistics[id] = [
      { start: monthStart, end: todayStart, change: Math.max(0, monthUsage - todayUsage) },
      { start: todayStart, end: now.getTime(), change: todayUsage }
    ];
  }
  const priceHistory = {};
  const rates = [
    ...(config.preferences.costs.electricity.enabled ? [config.preferences.costs.electricity.rate] : []),
    ...(config.preferences.costs.electricity.enabled ? activeRates(config.preferences.costs.electricity) : []),
    ...(config.preferences.costs.feedIn?.enabled ? activeRates(config.preferences.costs.feedIn) : []),
    ...(config.preferences.costs.gas.enabled ? [config.preferences.costs.gas.rate] : []),
    ...(config.preferences.costs.water.enabled ? [config.preferences.costs.water.rate] : [])
  ].filter(rate => rate.source === 'entity' && rate.entityId);
  for (const rate of rates) {
    const entity = entities.find(item => item.id === rate.entityId);
    const value = Number(entity?.state);
    if (!entity?.available || !Number.isFinite(value)) continue;
    priceHistory[rate.entityId] = [];
    for (let at = monthStart - sampleIntervalMs; at <= now.getTime(); at += sampleIntervalMs) priceHistory[rate.entityId].push({ at, value });
  }
  return summarizeEnergyCosts({ costs: config.preferences.costs, mappings: config.mappings, entities, statistics, priceHistory, now, timeZone: 'Europe/Amsterdam' });
}