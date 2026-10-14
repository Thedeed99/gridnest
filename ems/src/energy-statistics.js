import { DateTime } from 'luxon';

export function energyDayRange(now, timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) throw new Error('Home Assistant-tijdzone ontbreekt.');
  const date = DateTime.fromJSDate(now, { zone: timeZone });
  if (!date.isValid) throw new Error('Home Assistant-tijdzone is ongeldig.');
  return { start: date.startOf('day').toUTC().toISO(), end: date.toUTC().toISO() };
}

export function energyStatisticGroups(preferences, mappings = {}) {
  const groups = { imported: [], exported: [], solar: [], charged: [], discharged: [], gas: [], water: [], ev: [] };
  const add = (group, id) => { if (typeof id === 'string' && id && !groups[group].includes(id)) groups[group].push(id); };
  for (const source of preferences.energy_sources ?? []) {
    if (source.type === 'grid') {
      for (const flow of source.flow_from ?? [source]) add('imported', flow.stat_energy_from);
      for (const flow of source.flow_to ?? [source]) add('exported', flow.stat_energy_to);
    }
    if (source.type === 'solar') add('solar', source.stat_energy_from);
    if (source.type === 'battery') {
      add('discharged', source.stat_energy_from);
      add('charged', source.stat_energy_to);
    }
    if (['gas', 'water'].includes(source.type)) add(source.type, source.stat_energy_from);
  }
  if (mappings.evEnergyTotal) add('ev', mappings.evEnergyTotal);
  else {
    for (const device of preferences.device_consumption ?? []) {
      if (mappings.evPower && device.stat_rate === mappings.evPower) add('ev', device.stat_consumption);
    }
  }
  return groups;
}

export function officialEnergyRows(groups, statistics, metadata = []) {
  const byId = new Map(metadata.map(item => [item.statistic_id, item]));
  const total = ids => {
    if (!ids.length) return 0;
    let result = 0;
    for (const id of ids) {
      const values = (statistics[id] ?? []).map(item => item.change).filter(value => typeof value === 'number' && Number.isFinite(value));
      if (!values.length) return null;
      result += values.reduce((sum, value) => sum + value, 0);
    }
    return result;
  };
  const rows = [];
  const add = (label, value, unit = 'kWh') => rows.push({ label, value, unit, complete: value !== null, source: 'home-assistant' });
  const parts = ['imported', 'solar', 'discharged', 'exported', 'charged'].map(key => total(groups[key]));
  if (groups.imported.length || groups.solar.length || groups.discharged.length) {
    add('Woningverbruik', parts.some(value => value === null) ? null : parts[0] + parts[1] + parts[2] - parts[3] - parts[4]);
  }
  if (groups.imported.length || groups.exported.length) add('Teruglevering', groups.exported.length ? total(groups.exported) : null);
  if (groups.ev.length) add('Laadpaal', total(groups.ev));
  if (groups.charged.length) add('Batterij laden', total(groups.charged));
  if (groups.discharged.length) add('Batterij ontladen', total(groups.discharged));
  for (const [group, label] of [['gas', 'Gas'], ['water', 'Water']]) {
    const ids = groups[group];
    if (!ids.length) continue;
    const units = ids.map(id => {
      const info = byId.get(id);
      const unit = info?.statistics_unit_of_measurement ?? info?.unit_of_measurement;
      if (info?.unit_class === 'energy' || ['Wh', 'kWh', 'MWh'].includes(unit)) return 'kWh';
      if (info?.unit_class === 'volume' || ['m³', 'm3', 'L', 'gal', 'ft³'].includes(unit)) return 'm³';
      return null;
    });
    const unit = units[0] ?? 'm³';
    add(label, units.every(value => value === unit) ? total(ids) : null, unit);
  }
  return rows;
}

export async function readStatisticsConnection(env, load, Socket = WebSocket) {
  const supervisor = Boolean(env.SUPERVISOR_TOKEN);
  const token = supervisor ? env.SUPERVISOR_TOKEN : env.HA_TOKEN;
  const base = supervisor ? 'http://supervisor/core' : env.HA_URL;
  if (!token || !base) throw new Error('Home Assistant-energiestatistieken niet beschikbaar.');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ongeldig Home Assistant-adres.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = supervisor ? '/core/websocket' : `${url.pathname.replace(/\/api\/?$/, '').replace(/\/$/, '')}/api/websocket`;
  url.search = '';
  url.hash = '';
  return new Promise((resolve, reject) => {
    const socket = new Socket(url.href);
    const pending = new Map();
    let identifier = 0;
    let finished = false;
    let authenticated = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      for (const request of pending.values()) request.reject(error ?? new Error('Statistiekverbinding gesloten.'));
      pending.clear();
      try { socket.close(); } catch {}
      if (error) reject(error); else resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error('Home Assistant-energiestatistieken reageren niet op tijd.')), 15000);
    const call = command => new Promise((resolveCall, rejectCall) => {
      const id = ++identifier;
      pending.set(id, { resolve: resolveCall, reject: rejectCall });
      try { socket.send(JSON.stringify({ ...command, id })); }
      catch { pending.delete(id); rejectCall(new Error('Statistiekverzoek versturen mislukt.')); }
    });
    socket.addEventListener('message', event => {
      if (finished) return;
      let message;
      try { message = JSON.parse(String(event.data)); }
      catch { finish(new Error('Ongeldig antwoord van Home Assistant.')); return; }
      if (message.type === 'auth_required') {
        try { socket.send(JSON.stringify({ type: 'auth', access_token: token })); }
        catch { finish(new Error('Statistiekauthenticatie versturen mislukt.')); }
      } else if (message.type === 'auth_invalid') finish(new Error('Toegang tot Home Assistant-energiestatistieken geweigerd.'));
      else if (message.type === 'auth_ok' && !authenticated) {
        authenticated = true;
        load(call).then(result => finish(null, result), error => finish(error));
      } else if (message.type === 'result') {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.success) request.resolve(message.result);
        else request.reject(new Error('Home Assistant kon de energiestatistieken niet leveren.'));
      }
    });
    socket.addEventListener('error', () => finish(new Error('Verbinding met Home Assistant-energiestatistieken mislukt.')));
    socket.addEventListener('close', () => finish(new Error('Verbinding met Home Assistant-energiestatistieken gesloten.')));
  });
}

export async function readOfficialEnergy(env, mappings = {}, now = new Date(), Socket = WebSocket) {
  return readStatisticsConnection(env, async call => {
    const preferences = await call({ type: 'energy/get_prefs' });
    if (!Array.isArray(preferences?.energy_sources)) throw new Error('Home Assistant Energie is niet ingesteld.');
    const config = await call({ type: 'get_config' });
    const range = energyDayRange(now, config.time_zone);
    const groups = energyStatisticGroups(preferences, mappings);
    const ids = [...new Set(Object.values(groups).flat())];
    if (!ids.length) throw new Error('Geen energietellers ingesteld in Home Assistant Energie.');
    const metadata = await call({ type: 'recorder/get_statistics_metadata', statistic_ids: ids });
    if (!Array.isArray(metadata)) throw new Error('Ongeldige energiestatistiekmetadata.');
    const statistics = await call({ type: 'recorder/statistics_during_period', start_time: range.start, end_time: range.end,
      statistic_ids: ids, period: 'hour', units: { energy: 'kWh', volume: 'm³' }, types: ['change'] });
    if (!statistics || typeof statistics !== 'object' || Array.isArray(statistics)) throw new Error('Ongeldige energiestatistieken.');
    const ends = Object.values(statistics).flat().map(item => item.end).filter(value => typeof value === 'number' && Number.isFinite(value));
    return { rows: officialEnergyRows(groups, statistics, metadata), source: 'home-assistant', periodStart: range.start,
      updatedThrough: ends.length ? new Date(Math.max(...ends)).toISOString() : null };
  }, Socket);
}