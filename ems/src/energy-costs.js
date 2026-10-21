import { DateTime } from 'luxon';
import { readStatisticsConnection } from './energy-statistics.js';

const unitKey = unit => String(unit ?? '').replaceAll('³', '3').replaceAll('€', 'EUR').replaceAll(' ', '').toLowerCase();
const sampleIntervalMs = 55 * 60 * 1000;

function intervalMilliseconds(interval) {
  return interval === '15min' ? 15 * 60 * 1000 : interval === 'day' ? 23 * 60 * 60 * 1000 : sampleIntervalMs;
}

function maxSampleAge(interval) {
  return interval === '15min' ? 20 * 60 * 1000 : interval === 'day' ? 26 * 60 * 60 * 1000 : 65 * 60 * 1000;
}

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

function tariffEntries(costs) {
  const entries = [];
  const add = (resourceKey, unit, resource, slots) => {
    for (const [slot, label, rate] of slots) entries.push({
      key: `rate.${resourceKey}_${slot}`, label, unit, interval: resource.interval ?? 'hour', rate,
      contractType: resource.contractType ?? (rate?.source === 'entity' ? 'dynamic' : 'fixed'),
      historyKey: rate?.source === 'entity' && rate.entityId ? rate.entityId : `rate.${resourceKey}_${slot}`
    });
  };
  add('electricity', 'kWh', costs.electricity, costs.electricity.rateMode === 'dual'
    ? [['low', 'Stroom · laag', costs.electricity.lowRate], ['high', 'Stroom · hoog', costs.electricity.highRate]]
    : [['single', 'Stroom · all-in', costs.electricity.rate]]);
  const feedIn = costs.feedIn ?? {};
  add('feedin', 'kWh', feedIn, feedIn.rateMode === 'dual'
    ? [['low', 'Teruglevering · laag', feedIn.lowRate], ['high', 'Teruglevering · hoog', feedIn.highRate]]
    : [['single', 'Terugleververgoeding', feedIn.rate]]);
  add('gas', 'm³', costs.gas, [['single', 'Gas', costs.gas.rate]]);
  add('water', 'm³', costs.water, [['single', 'Water', costs.water.rate]]);
  return entries;
}

export function energyTariffHistory(costs, histories) {
  return tariffEntries(costs).map(({ key, label, unit, interval, contractType, rate, historyKey }) => ({
    key, label, unit, interval, contractType,
    current: rate?.source === 'entity' ? null : fixedRateAt(rate, Date.now()),
    futureRates: rate?.futureRates ?? [],
    entityId: rate?.source === 'entity' ? rate.entityId : null,
    samples: histories[historyKey] ?? []
  }));
}

function activeRates(resource) {
  if (!resource) return [];
  return resource.rateMode === 'dual' ? [resource.lowRate, resource.highRate] : [resource.rate];
}

function ratesForMeters(resource, meters) {
  return meters.map(meter => ({ ...meter,
    rate: resource.rateMode === 'dual' ? meter.label === 'Laag' ? resource.lowRate : meter.label === 'Hoog' ? resource.highRate : null : resource.rate,
    interval: resource.interval ?? 'hour', priceUnit: 'EUR/kWh'
  }));
}

function fixedRateAt(rate, at, timeZone = 'Europe/Amsterdam') {
  let value = rate?.value;
  for (const scheduled of [...(rate?.futureRates ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))) {
    const effectiveAt = DateTime.fromISO(scheduled.effectiveDate, { zone: timeZone }).startOf('day').toMillis();
    if (at < effectiveAt) break;
    value = scheduled.value;
  }
  return Number.isFinite(value) ? value : null;
}

function scheduledFixedCost(points, start, end, rate, timeZone) {
  const changes = points.filter(point => Number.isFinite(point.end) && point.end > start && point.end <= end && Number.isFinite(point.change) && point.change >= 0);
  if (!changes.length) return null;
  const transitions = (rate.futureRates ?? []).map(item => DateTime.fromISO(item.effectiveDate, { zone: timeZone }).startOf('day').toMillis()).sort((a, b) => a - b);
  let total = 0;
  for (const point of changes) {
    const intervalStart = Number.isFinite(point.start) ? point.start : point.end - 60 * 60 * 1000;
    const overlapStart = Math.max(start, intervalStart);
    const overlapEnd = Math.min(end, point.end);
    const boundaries = [overlapStart, ...transitions.filter(at => at > overlapStart && at < overlapEnd), overlapEnd];
    for (let index = 1; index < boundaries.length; index++) {
      const segmentStart = boundaries[index - 1];
      const segmentEnd = boundaries[index];
      const price = fixedRateAt(rate, segmentStart, timeZone);
      if (price === null) return null;
      total += point.change * ((segmentEnd - segmentStart) / (point.end - intervalStart)) * price;
    }
  }
  return total;
}

function priceFor(rate, unit, entities, at, timeZone) {
  if (rate.source === 'manual') return fixedRateAt(rate, at, timeZone);
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

function intervalPrice(samples, start, end, maxSampleAgeMs) {
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

function historicalCost(points, samples, start, end, interval) {
  const changes = points.filter(point => Number.isFinite(point.end) && point.end > start && point.end <= end && Number.isFinite(point.change) && point.change >= 0);
  if (!changes.length) return null;
  let total = 0;
  for (const point of changes) {
    const intervalEnd = point.end;
    const intervalStart = Number.isFinite(point.start) ? point.start : intervalEnd - 60 * 60 * 1000;
    const overlapStart = Math.max(start, intervalStart);
    const overlapEnd = Math.min(end, intervalEnd);
    const price = intervalPrice(samples, overlapStart, overlapEnd, maxSampleAge(interval));
    if (price === null) return null;
    total += point.change * ((overlapEnd - overlapStart) / (intervalEnd - intervalStart)) * price;
  }
  return total;
}

export function recordEnergyPrices(costs, entities, priceHistory, now = Date.now()) {
  const byId = new Map();
  for (const entry of tariffEntries(costs)) {
    const { rate, unit, interval, historyKey } = entry;
    if (!rate || rate.source === 'entity' && !rate.entityId) continue;
    let value = rate.source === 'manual' ? fixedRateAt(rate, now) : null;
    if (rate.source === 'manual' && value === null) continue;
    if (rate.source === 'entity' && rate.entityId) {
      const entity = entities.find(item => item.id === rate.entityId);
      if (entity?.available && entity.domain === 'sensor' && unitKey(entity.unit) === unitKey(`EUR/${unit}`)) {
        const state = String(entity.state ?? '').trim();
        const parsed = state ? Number(state) : Number.NaN;
        value = Number.isFinite(parsed) ? parsed : null;
      }
    }
    const minimumInterval = rate.source === 'manual' ? intervalMilliseconds('day') : intervalMilliseconds(interval);
    const previous = byId.get(historyKey);
    byId.set(historyKey, { value, minimumInterval: previous ? Math.min(previous.minimumInterval, minimumInterval) : minimumInterval });
  }
  return Promise.all([...byId].map(([historyKey, item]) => priceHistory.record(historyKey, item.value, now, item.minimumInterval)));
}

export function summarizeEnergyCosts({ costs, mappings, entities, statistics, priceHistory = {}, now = new Date(), timeZone }) {
  const localNow = DateTime.fromJSDate(now, { zone: timeZone });
  if (!localNow.isValid) throw new Error('Home Assistant-tijdzone is ongeldig.');
  const todayStart = localNow.startOf('day').toMillis();
  const monthStart = localNow.startOf('month').toMillis();
  const resources = [
    { key: 'electricity', label: 'Stroom', enabled: costs.electricity.enabled, unit: 'kWh', rateMode: costs.electricity.rateMode,
      meters: ratesForMeters(costs.electricity, electricityMeters(mappings, 'consumption')) },
    { key: 'evCharging', label: 'Waarvan auto laden', enabled: costs.electricity.enabled && Boolean(mappings.evEnergyTotal || mappings.evPower), unit: 'kWh',
      meters: [{ label: 'Auto laden', id: mappings.evEnergyTotal, rate: costs.electricity.rateMode === 'dual' ? null : costs.electricity.rate,
        interval: costs.electricity.interval ?? 'hour', priceUnit: 'EUR/kWh' }] },
    { key: 'feedIn', label: 'Terugleveropbrengst', enabled: costs.feedIn?.enabled, unit: 'kWh', rateMode: costs.feedIn?.rateMode,
      meters: ratesForMeters(costs.feedIn, electricityMeters(mappings, 'return')) },
    { key: 'gas', label: 'Gas', enabled: costs.gas.enabled, unit: 'm³', meters: [
      { label: 'Gas', id: mappings.gasConsumption, rate: costs.gas.rate, priceUnit: 'EUR/m³' }
    ] },
    { key: 'water', label: 'Water', enabled: costs.water.enabled, unit: 'm³', meters: [
      { label: 'Water', id: mappings.waterConsumption, rate: costs.water.rate, priceUnit: 'EUR/m³' }
    ] }
  ];
  const calculated = resources.filter(resource => resource.enabled).map(resource => {
      const details = resource.meters.filter(meter => meter.id).map(meter => {
        const rate = meter.rate;
        const price = rate ? priceFor(rate, meter.priceUnit, entities, now.getTime(), timeZone) : null;
        const points = statistics[meter.id] ?? [];
        const todayUsage = meter.id ? periodUsage(points, todayStart, now.getTime()) : null;
        const monthUsage = meter.id ? periodUsage(points, monthStart, now.getTime()) : null;
        const todayCost = !rate ? null : rate.source === 'manual'
          ? rate.futureRates?.length ? scheduledFixedCost(points, todayStart, now.getTime(), rate, timeZone)
            : todayUsage === null || price === null ? null : todayUsage * price
          : historicalCost(points, priceHistory[rate.entityId] ?? [], todayStart, now.getTime(), meter.interval);
        const monthCost = !rate ? null : rate.source === 'manual'
          ? rate.futureRates?.length ? scheduledFixedCost(points, monthStart, now.getTime(), rate, timeZone)
            : monthUsage === null || price === null ? null : monthUsage * price
          : historicalCost(points, priceHistory[rate.entityId] ?? [], monthStart, now.getTime(), meter.interval);
        return { label: meter.label, rate, price, todayUsage, monthUsage, todayCost, monthCost };
      });
      const total = key => details.length && details.every(detail => detail[key] !== null) ? details.reduce((sum, detail) => sum + detail[key], 0) : null;
      const today = total('todayCost');
      const month = total('monthCost');
      const hasRate = details.length > 0 && details.every(detail => detail.rate &&
        (detail.rate.source === 'manual' ? detail.rate.value !== null : Boolean(detail.rate.entityId)));
      const missingSplitMeter = resource.rateMode === 'dual' && (details.length !== 2 || details.some(detail => !detail.rate));
      return { key: resource.key, label: resource.label, unit: resource.unit, today, month,
        status: !details.length ? `Koppel een ${resource.unit}-meter onder Koppelingen` : missingSplitMeter ? 'Koppel de lage en hoge meter onder Koppelingen' : !hasRate ? 'Vul het tarief in bij Mijn wensen' : today === null || month === null ? 'Tariefhistorie of meterstatistieken ontbreken' : null,
        details };
    });
  const charging = calculated.find(resource => resource.key === 'evCharging');
  if (charging) {
    if (!mappings.evEnergyTotal) charging.status = 'Koppel de laadpaal-energiemeter onder Koppelingen';
    else if (costs.electricity.rateMode === 'dual') charging.status = 'Laadkosten vereisen een enkel stroomtarief; laag/hoog-verdeling van de laadenergie ontbreekt';
    calculated.find(resource => resource.key === 'electricity').breakdown = [charging];
  }
  return { today: now.toISOString(), resources: calculated.filter(resource => resource.key !== 'evCharging') };
}

export async function readEnergyCosts(env, config, entities, now = new Date(), Socket = WebSocket, priceHistory = {}) {
  const costs = config.preferences.costs;
  const mappings = config.mappings;
  const ids = [...new Set([
    ...(costs.electricity.enabled ? electricityMeters(mappings, 'consumption').map(meter => meter.id) : []),
    ...(costs.electricity.enabled ? [mappings.evEnergyTotal] : []),
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
      [mappings.evEnergyTotal, 'energy'],
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
    gasConsumption: [14.5, 0.7], waterConsumption: [4.8, 0.18], evEnergyTotal: [60, 2.4]
  };
  const mappingIds = {
    electricityConsumption: config.mappings.electricityConsumption, electricityReturn: config.mappings.electricityReturn,
    electricityLow: config.mappings.electricityLow, electricityHigh: config.mappings.electricityHigh,
    electricityReturnLow: config.mappings.electricityReturnLow, electricityReturnHigh: config.mappings.electricityReturnHigh,
    gasConsumption: config.mappings.gasConsumption, waterConsumption: config.mappings.waterConsumption,
    evEnergyTotal: config.mappings.evEnergyTotal
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
  const rates = tariffEntries(config.preferences.costs).filter(entry => entry.rate?.source === 'entity' && entry.rate.entityId);
  for (const entry of rates) {
    const entity = entities.find(item => item.id === entry.rate.entityId);
    const value = Number(entity?.state);
    if (!entity?.available || !Number.isFinite(value)) continue;
    priceHistory[entry.historyKey] = [];
    const sampleInterval = intervalMilliseconds(entry.interval);
    for (let at = monthStart - sampleInterval; at <= now.getTime(); at += sampleInterval) priceHistory[entry.historyKey].push({ at, value });
  }
  return summarizeEnergyCosts({ costs: config.preferences.costs, mappings: config.mappings, entities, statistics, priceHistory, now, timeZone: 'Europe/Amsterdam' });
}