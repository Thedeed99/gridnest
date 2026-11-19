import { DateTime } from 'luxon';
import { electricityMeters, energyCostForPoints } from './energy-costs.js';
import { energyStatisticGroups, readStatisticsConnection } from './energy-statistics.js';
import { isCumulativeSolarMeter } from './solar-meter.js';

const hour = 3600000;

function solarConsumptionGroups(preferences, mappings, entities) {
  const groups = energyStatisticGroups(preferences);
  const solar = entities.find(entity => entity.id === mappings.solarToday);
  if (mappings.solarToday && isCumulativeSolarMeter(solar, mappings.solarTodayMode)) groups.solar = [mappings.solarToday];
  const exported = electricityMeters(mappings, 'return').map(meter => meter.id);
  if (exported.length) groups.exported = [...new Set(exported)];
  return groups;
}

export function summarizeSolarConsumption({ groups, mappings, statistics, electricity, priceHistory = {}, now = new Date(), timeZone }) {
  const localNow = DateTime.fromJSDate(now, { zone: timeZone });
  if (!localNow.isValid) throw new Error('Home Assistant-tijdzone ontbreekt of is ongeldig.');
  // Recorder needs a few minutes to finish the preceding hour.
  const through = localNow.minus({ minutes: 5 }).startOf('hour').toMillis();
  const ids = [...new Set([...groups.solar, ...groups.exported])];
  const sourceStatus = !groups.solar.length ? 'Koppel een zonne-totaalmeter of stel zonnepanelen in bij Home Assistant Energie.'
    : !groups.exported.length ? 'Koppel een teruglever-energiemeter of stel teruglevering in bij Home Assistant Energie.'
    : groups.solar.some(id => groups.exported.includes(id)) ? 'Zonneproductie en teruglevering moeten afzonderlijke meters zijn.'
    : groups.charged.length || groups.discharged.length || mappings.batteryMode === 'measured' || mappings.batteryPower || mappings.batterySoc || mappings.batteries?.length
      ? 'Met een thuisbatterij is de herkomst van opslag en export niet bekend; eigen zonneverbruik kan niet betrouwbaar worden bepaald.'
      : mappings.batteryMode !== 'none' ? 'Geef bij Koppelingen aan of er een thuisbatterij is.' : null;
  const periods = {};
  for (const [key, unit] of [['today', 'day'], ['month', 'month']]) {
    const start = localNow.startOf(unit).toMillis();
    const result = { energyKwh: null, percentage: null, avoidedCost: null, productionKwh: null,
      periodStart: new Date(start).toISOString(), updatedThrough: null, status: sourceStatus, costStatus: null };
    periods[key] = result;
    if (sourceStatus) continue;
    if (through <= start) {
      result.status = 'Nog geen volledig uur met energiestatistieken beschikbaar.';
      continue;
    }
    const byId = new Map(ids.map(id => [id, new Map((statistics[id] ?? []).map(point => [point.start, point]))]));
    const points = [];
    let production = 0;
    for (let at = start; at < through; at += hour) {
      const valid = ids.every(id => {
        const point = byId.get(id).get(at);
        return point?.end === at + hour && Number.isFinite(point.change) && point.change >= 0;
      });
      if (!valid) {
        result.status = 'Zonne- of terugleverstatistieken ontbreken voor een deel van deze periode.';
        break;
      }
      const sum = group => groups[group].reduce((total, id) => total + byId.get(id).get(at).change, 0);
      const solar = sum('solar');
      const exported = sum('exported');
      if (exported > solar + 0.000001) {
        result.status = 'Teruglevering is hoger dan zonneproductie; controleer de meters en eventuele batterij.';
        break;
      }
      production += solar;
      points.push({ start: at, end: at + hour, change: Math.max(0, solar - exported) });
    }
    if (result.status) continue;
    result.energyKwh = points.reduce((total, point) => total + point.change, 0);
    result.productionKwh = production;
    result.percentage = production > 0 ? result.energyKwh / production * 100 : null;
    result.updatedThrough = new Date(through).toISOString();
    if (!electricity.enabled) result.costStatus = 'Schakel het stroomtarief in bij Tarieven voor de vermeden inkoop.';
    else if (electricity.rateMode === 'dual') result.costStatus = 'Vermeden inkoop vereist een enkel stroomtarief; de laag/hoog-verdeling van eigen zonnestroom ontbreekt.';
    else {
      result.avoidedCost = energyCostForPoints(points, start, through, electricity.rate, electricity.interval ?? 'hour', priceHistory, timeZone);
      if (result.avoidedCost === null) result.costStatus = 'Stroomtarief of historische prijzen ontbreken voor deze periode.';
    }
  }
  return { ...periods, timeZone, source: 'home-assistant' };
}

export async function readSolarConsumption(env, config, entities, now = new Date(), Socket = WebSocket, priceHistory = {}) {
  return readStatisticsConnection(env, async call => {
    const preferences = await call({ type: 'energy/get_prefs' });
    if (!Array.isArray(preferences?.energy_sources)) throw new Error('Home Assistant Energie is niet ingesteld.');
    const settings = await call({ type: 'get_config' });
    const localNow = DateTime.fromJSDate(now, { zone: settings.time_zone });
    if (!settings.time_zone || !localNow.isValid) throw new Error('Home Assistant-tijdzone ontbreekt of is ongeldig.');
    const groups = solarConsumptionGroups(preferences, config.mappings, entities);
    const ids = [...new Set([...groups.solar, ...groups.exported])];
    let statistics = {};
    if (ids.length) {
      const metadata = await call({ type: 'recorder/get_statistics_metadata', statistic_ids: ids });
      if (!Array.isArray(metadata)) throw new Error('Ongeldige zonne-energiestatistiekmetadata.');
      const validIds = ids.filter(id => metadata.some(item => item.statistic_id === id && item.has_sum && item.unit_class === 'energy'));
      if (validIds.length) statistics = await call({ type: 'recorder/statistics_during_period',
        start_time: localNow.startOf('month').toUTC().toISO(), end_time: now.toISOString(), statistic_ids: validIds,
        period: 'hour', units: { energy: 'kWh' }, types: ['change'] });
      if (!statistics || typeof statistics !== 'object' || Array.isArray(statistics)) throw new Error('Ongeldige zonne-energiestatistieken.');
    }
    return summarizeSolarConsumption({ groups, mappings: config.mappings, statistics, electricity: config.preferences.costs.electricity,
      priceHistory, now, timeZone: settings.time_zone });
  }, Socket);
}

export function demoSolarConsumption(config, now = new Date()) {
  const localNow = DateTime.fromJSDate(now, { zone: 'Europe/Amsterdam' });
  const statistics = { solar: [], exported: [] };
  for (let at = localNow.startOf('month').toMillis(); at + hour <= now.getTime(); at += hour) {
    const daylight = DateTime.fromMillis(at, { zone: 'Europe/Amsterdam' }).hour;
    const solar = daylight >= 8 && daylight < 17 ? 0.8 : 0;
    statistics.solar.push({ start: at, end: at + hour, change: solar });
    statistics.exported.push({ start: at, end: at + hour, change: solar * 0.35 });
  }
  return { ...summarizeSolarConsumption({ groups: { solar: ['solar'], exported: ['exported'], charged: [], discharged: [] },
    mappings: config.mappings, statistics, electricity: config.preferences.costs.electricity, now, timeZone: 'Europe/Amsterdam' }), source: 'demo' };
}
