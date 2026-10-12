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

export async function readUtilityHistory(env, entityId, request = fetch, now = new Date()) {
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