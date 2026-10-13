import { energyDayRange } from './energy-statistics.js';

export function isCumulativeSolarMeter(entity, mode) {
  return mode === 'total' || entity?.stateClass === 'total_increasing';
}

export function cumulativeSolarToday(history, entity, now = new Date(), timeZone = 'Europe/Amsterdam') {
  const range = energyDayRange(now, timeZone);
  const start = Date.parse(range.start);
  const result = { energyKwh: null, complete: false, source: 'cumulative-meter', periodStart: range.start, updatedThrough: null };
  if (!entity?.available || !['Wh', 'kWh'].includes(entity.unit) || entity.state.trim() === '' || !Number.isFinite(Number(entity.state)) || Number(entity.state) < 0) return result;
  const points = (Array.isArray(history) ? history.flat() : []).map(item => ({
    time: Date.parse(item.last_updated ?? item.last_changed),
    value: typeof item.state === 'string' && item.state.trim() !== '' ? Number(item.state) : NaN
  })).filter(point => Number.isFinite(point.time) && point.time <= now.getTime()).sort((first, second) => first.time - second.time);
  const baseline = points.filter(point => point.time <= start).at(-1);
  if (!baseline || !Number.isFinite(baseline.value) || baseline.value < 0) return result;
  let previous = baseline.value;
  for (const point of [...points.filter(point => point.time > start), { value: Number(entity.state) }]) {
    if (!Number.isFinite(point.value) || point.value < previous) return result;
    previous = point.value;
  }
  return { ...result, energyKwh: (previous - baseline.value) / (entity.unit === 'Wh' ? 1000 : 1), complete: true, updatedThrough: now.toISOString() };
}

export async function readSolarMeterToday(env, entity, request = fetch, now = new Date()) {
  const token = env.SUPERVISOR_TOKEN || env.HA_TOKEN;
  const base = env.SUPERVISOR_TOKEN ? 'http://supervisor/core/api' : env.HA_URL;
  if (!token || !base) throw new Error('Home Assistant-meterhistorie niet beschikbaar.');
  const configUrl = new URL(`${base.replace(/\/$/, '')}/config`);
  if (!['http:', 'https:'].includes(configUrl.protocol) || configUrl.username || configUrl.password) throw new Error('Ongeldig Home Assistant-adres.');
  const options = { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) };
  const configResponse = await request(configUrl, options);
  if (!configResponse.ok) throw new Error('Home Assistant-tijdzone niet beschikbaar.');
  const config = await configResponse.json();
  const range = energyDayRange(now, config.time_zone);
  const url = new URL(`${base.replace(/\/$/, '')}/history/period/${encodeURIComponent(range.start)}`);
  url.searchParams.set('filter_entity_id', entity.id);
  url.searchParams.set('end_time', range.end);
  url.searchParams.set('minimal_response', '');
  url.searchParams.set('no_attributes', '');
  const response = await request(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Zonne-meterhistorie niet beschikbaar (HTTP ${response.status}).`);
  return cumulativeSolarToday(await response.json(), entity, now, config.time_zone);
}