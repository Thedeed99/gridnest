import { readStatisticsConnection } from './energy-statistics.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 30;

function buckets(now, count, interval) {
  const end = now.getTime();
  const start = end - count * interval;
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(start + index * interval).toISOString(),
    value: null
  }));
}

function addConsumption(bucket, value) {
  bucket.value = (bucket.value ?? 0) + value;
}

export function utilityPeriodTotals(series) {
  return Object.fromEntries(Object.entries(series).map(([key, buckets]) => {
    const values = buckets.map(bucket => bucket.value).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    return [key, { value: values.length ? values.reduce((total, value) => total + value, 0) : null,
      complete: buckets.length > 0 && values.length === buckets.length }];
  }));
}

function utilityTodayTotal(states, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const baseline = states.filter(point => point.timestamp <= start.getTime()).at(-1);
  const points = states.filter(point => point.timestamp > start.getTime() && point.timestamp <= now.getTime());
  if (!baseline || (!points.length && baseline.timestamp !== now.getTime())) return { value: null, complete: false };
  let previous = baseline;
  let value = 0;
  let complete = baseline.timestamp === start.getTime();
  for (const point of points) {
    if (point.timestamp - previous.timestamp > HOUR_MS || point.value < previous.value) complete = false;
    value += point.value >= previous.value ? point.value - previous.value : point.value;
    previous = point;
  }
  return { value, complete: complete && now.getTime() - previous.timestamp <= HOUR_MS };
}

export function utilityConsumptionSeries(history, now = new Date()) {
  const cutoff = now.getTime() - HISTORY_DAYS * DAY_MS;
  const states = (Array.isArray(history) ? history.flat() : [])
    .map(item => ({ timestamp: Date.parse(item.last_changed ?? item.last_updated), value: typeof item.state === 'string' && item.state.trim() !== '' ? Number(item.state) : NaN }))
    .filter(item => Number.isFinite(item.timestamp) && Number.isFinite(item.value) && item.value >= 0)
    .sort((first, second) => first.timestamp - second.timestamp);
  const previousState = states.filter(item => item.timestamp < cutoff).at(-1);
  const points = states.filter(item => item.timestamp >= cutoff && item.timestamp <= now.getTime());
  const series = {
    hours24: buckets(now, 24, HOUR_MS),
    days7: buckets(now, 7, DAY_MS),
    days30: buckets(now, 30, DAY_MS)
  };
  let previous = previousState?.value ?? null;
  let hasBaseline = previous !== null;

  for (const point of points) {
    if (previous !== null && hasBaseline) {
      const difference = point.value >= previous ? point.value - previous : point.value;
      const age = now.getTime() - point.timestamp;
      if (age >= 0 && age < 24 * HOUR_MS) addConsumption(series.hours24[Math.min(23, 23 - Math.floor(age / HOUR_MS))], difference);
      if (age >= 0 && age < 7 * DAY_MS) addConsumption(series.days7[Math.min(6, 6 - Math.floor(age / DAY_MS))], difference);
      if (age >= 0 && age < 30 * DAY_MS) addConsumption(series.days30[Math.min(29, 29 - Math.floor(age / DAY_MS))], difference);
    }
    previous = point.value;
    hasBaseline = true;
  }

  return { available: states.length > 1, series, totals: utilityPeriodTotals(series), today: utilityTodayTotal(states, now) };
}

export async function readUtilityStatistics(env, entityId, now = new Date(), Socket = WebSocket) {
  return readStatisticsConnection(env, async call => {
    const metadata = await call({ type: 'recorder/get_statistics_metadata', statistic_ids: [entityId] });
    const info = Array.isArray(metadata) ? metadata.find(item => item.statistic_id === entityId) : null;
    const unit = info?.statistics_unit_of_measurement ?? info?.unit_of_measurement;
    if (!info?.has_sum || !(info.unit_class === 'volume' || ['m³', 'm3', 'L', 'gal', 'ft³'].includes(unit))) {
      throw new Error('Geen volumestatistieken beschikbaar voor deze meter.');
    }
    const statistics = await call({ type: 'recorder/statistics_during_period',
      start_time: new Date(now.getTime() - HISTORY_DAYS * DAY_MS - HOUR_MS).toISOString(), end_time: now.toISOString(),
      statistic_ids: [entityId], period: 'hour', units: { volume: 'm³' }, types: ['change'] });
    const points = statistics?.[entityId];
    if (!Array.isArray(points)) throw new Error('Meterstatistieken niet beschikbaar.');
    const series = { hours24: buckets(now, 24, HOUR_MS), days7: buckets(now, 7, DAY_MS), days30: buckets(now, 30, DAY_MS) };
    for (const point of points) {
      if (!Number.isFinite(point.start) || !Number.isFinite(point.end) || !Number.isFinite(point.change) || point.change < 0 || point.end <= point.start) continue;
      const age = now.getTime() - point.end;
      for (const [key, count, interval] of [['hours24', 24, HOUR_MS], ['days7', 7, DAY_MS], ['days30', 30, DAY_MS]]) {
        if (age >= 0 && age < count * interval) addConsumption(series[key][count - 1 - Math.floor(age / interval)], point.change);
      }
    }
    return { available: series.days30.some(bucket => bucket.value !== null), series, totals: utilityPeriodTotals(series), today: { value: null, complete: false } };
  }, Socket);
}

export async function readUtilityHistory(env, entityId, request = fetch, now = new Date(), statisticsProvider = readUtilityStatistics) {
  const [history, statistics] = await Promise.allSettled([
    readUtilityRawHistory(env, entityId, request, now), statisticsProvider(env, entityId, now)
  ]);
  if (history.status === 'rejected') {
    if (statistics.status === 'fulfilled' && statistics.value.available) return statistics.value;
    throw history.reason;
  }
  const result = history.value;
  if (statistics.status === 'fulfilled' && statistics.value.available) {
    for (const key of ['hours24', 'days7', 'days30']) {
      result.series[key] = result.series[key].map((bucket, index) => {
        const statistical = statistics.value.series[key][index];
        return bucket.value === null && statistical?.value !== null ? statistical : bucket;
      });
    }
    result.available = true;
    result.totals = utilityPeriodTotals(result.series);
  }
  return result;
}

async function readUtilityRawHistory(env, entityId, request, now) {
  const supervisor = Boolean(env.SUPERVISOR_TOKEN);
  const token = supervisor ? env.SUPERVISOR_TOKEN : env.HA_TOKEN;
  const base = supervisor ? 'http://supervisor/core/api' : env.HA_URL;
  if (!token || !base) throw new Error('Home Assistant-geschiedenis niet beschikbaar.');
  const start = new Date(now.getTime() - (HISTORY_DAYS * DAY_MS) - HOUR_MS);
  const url = new URL(`${base.replace(/\/$/, '')}/history/period/${encodeURIComponent(start.toISOString())}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ongeldig Home Assistant-adres.');
  url.searchParams.set('filter_entity_id', entityId);
  url.searchParams.set('end_time', now.toISOString());
  url.searchParams.set('minimal_response', '');
  url.searchParams.set('no_attributes', '');
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Metergeschiedenis niet beschikbaar (HTTP ${response.status}).`);
  return utilityConsumptionSeries(await response.json(), now);
}

export function demoUtilityHistory(utility, now = new Date()) {
  const start = now.getTime() - (HISTORY_DAYS * DAY_MS) - HOUR_MS;
  const history = [];
  let total = utility === 'water' ? 320 : 1250;
  for (let timestamp = start; timestamp <= now.getTime(); timestamp += HOUR_MS) {
    const hour = new Date(timestamp).getHours();
    total += utility === 'water'
      ? hour >= 6 && hour <= 9 ? 0.018 : hour >= 17 && hour <= 21 ? 0.024 : 0.004
      : hour >= 6 && hour <= 9 ? 0.045 : hour >= 17 && hour <= 21 ? 0.055 : 0.012;
    history.push({ last_changed: new Date(timestamp).toISOString(), state: total.toFixed(3) });
  }
  return utilityConsumptionSeries([history], now);
}