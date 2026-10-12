const MAX_GAP_MS = 30 * 60 * 1000;

function startOfLocalDay(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

export function recapMeters(mappings, entities) {
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const meters = [];
  const add = (id, label, kind, signed = false, direction = 1) => {
    if (meters.some(meter => meter.id === id)) return;
    const entity = byId.get(id);
    if (!entity || entity.domain !== 'sensor' || !['W', 'kW'].includes(entity.unit)) return;
    meters.push({ id, label, kind, unit: entity.unit, signed, direction });
  };
  add(mappings.gridImport, 'Netafname', 'import');
  add(mappings.gridExport, 'Teruglevering', 'export');
  add(mappings.solar, 'Zonnepanelen', 'production');
  add(mappings.totalConsumption, 'Woningverbruik', 'consumption');
  add(mappings.evPower, 'Laadpaal', 'consumption');
  for (const phase of [1, 2, 3]) add(mappings[`phase${phase}Power`], `Fase L${phase}`, 'consumption');
  if (mappings.gridMode === 'signed') add(mappings.gridPower, 'Netvermogen', 'grid', true, mappings.gridDirection === 'positive-export' ? -1 : 1);
  if (mappings.batteryMode === 'measured') add(mappings.batteryPower, 'Batterijvermogen', 'battery', true, mappings.batteryDirection === 'positive-discharge' ? -1 : 1);
  if (mappings.knownSource === 'aggregate') add(mappings.knownConsumption, 'Bekende verbruikers', 'consumption');
  else {
    for (const id of mappings.knownConsumers ?? []) add(id, mappings.knownConsumerNames?.[id]?.trim() || byId.get(id)?.name || id, 'consumption');
  }
  return meters;
}

function wattsFor(state, meter) {
  if (!state || ['unknown', 'unavailable'].includes(state.state)) return null;
  const value = Number(state.state);
  if (!Number.isFinite(value)) return null;
  const watts = (meter.unit === 'kW' ? value * 1000 : value) * (meter.direction ?? 1);
  return meter.signed || watts >= 0 ? watts : null;
}

export function dailyEnergyRecap(history, meters, now = new Date()) {
  const start = startOfLocalDay(now);
  const end = now.getTime();
  const rows = [];
  meters.forEach((meter, index) => {
    const states = (Array.isArray(history?.[index]) ? history[index] : [])
      .map(state => ({ timestamp: Date.parse(state.last_changed ?? state.last_updated), watts: wattsFor(state, meter) }))
      .filter(point => Number.isFinite(point.timestamp) && point.timestamp <= end)
      .sort((first, second) => first.timestamp - second.timestamp);
    const previous = states.filter(point => point.timestamp <= start).at(-1);
    const points = [...(previous ? [previous] : []), ...states.filter(point => point.timestamp > start)];
    let complete = Boolean(previous && start - previous.timestamp <= MAX_GAP_MS);
    let coverageMs = 0;
    const totals = new Map();

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      const next = points[pointIndex + 1];
      const from = Math.max(start, point.timestamp);
      const to = Math.min(end, next?.timestamp ?? end);
      if (to <= from) continue;
      const duration = to - from;
      if (duration > MAX_GAP_MS || (next && next.timestamp - point.timestamp > MAX_GAP_MS)) complete = false;
      if (point.watts === null) {
        complete = false;
        continue;
      }
      coverageMs += duration;
      const signedFlow = meter.kind === 'grid' || meter.kind === 'battery';
      const label = signedFlow
        ? meter.kind === 'grid'
          ? point.watts >= 0 ? 'Netafname' : 'Teruglevering'
          : point.watts >= 0 ? 'Batterij laden' : 'Batterij ontladen'
        : meter.label;
      totals.set(label, (totals.get(label) ?? 0) + Math.abs(point.watts) * duration / 3_600_000_000);
    }

    const labels = meter.kind === 'grid' ? ['Netafname', 'Teruglevering']
      : meter.kind === 'battery' ? ['Batterij laden', 'Batterij ontladen'] : [meter.label];
    for (const label of labels) {
      rows.push({ label, entityId: meter.id, kind: meter.kind,
        energyKwh: coverageMs ? totals.get(label) ?? 0 : null,
        complete: complete && coverageMs >= Math.max(0, end - start - MAX_GAP_MS) });
    }
  });
  return { available: rows.some(row => row.energyKwh !== null), complete: rows.length > 0 && rows.every(row => row.complete), rows };
}

export function demoDailyRecap(meters, now = new Date()) {
  const start = startOfLocalDay(now) - MAX_GAP_MS;
  const histories = meters.map((meter, index) => {
    const history = [];
    for (let timestamp = start; timestamp <= now.getTime(); timestamp += 15 * 60 * 1000) {
      const hour = new Date(timestamp).getHours();
      const negative = meter.kind === 'grid' && hour >= 11 && hour < 15 || meter.kind === 'battery' && hour >= 1 && hour < 6;
      const watts = (180 + ((index * 113 + hour * 37) % 520)) * (negative ? -1 : 1);
      const rawValue = watts / (meter.direction ?? 1) / (meter.unit === 'kW' ? 1000 : 1);
      history.push({ last_changed: new Date(timestamp).toISOString(), state: rawValue.toFixed(3) });
    }
    return history;
  });
  return dailyEnergyRecap(histories, meters, now);
}

export async function readDailyRecap(env, meters, request = fetch, now = new Date()) {
  if (!meters.length) return { available: false, complete: false, rows: [] };
  const supervisor = Boolean(env.SUPERVISOR_TOKEN);
  const token = supervisor ? env.SUPERVISOR_TOKEN : env.HA_TOKEN;
  const base = supervisor ? 'http://supervisor/core/api' : env.HA_URL;
  if (!token || !base) throw new Error('Home Assistant-historie niet beschikbaar.');
  const start = new Date(startOfLocalDay(now) - MAX_GAP_MS);
  const end = new Date(now);
  const url = new URL(`${base.replace(/\/$/, '')}/history/period/${encodeURIComponent(start.toISOString())}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ongeldig Home Assistant-adres.');
  const ids = [...new Set(meters.map(meter => meter.id))];
  url.searchParams.set('filter_entity_id', ids.join(','));
  url.searchParams.set('end_time', end.toISOString());
  url.searchParams.set('minimal_response', '');
  url.searchParams.set('no_attributes', '');
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Dagrecap niet beschikbaar (HTTP ${response.status}).`);
  const responseHistory = await response.json();
  const historyById = new Map(ids.map((id, index) => [id, responseHistory[index] ?? []]));
  return dailyEnergyRecap(meters.map(meter => historyById.get(meter.id)), meters, now);
}