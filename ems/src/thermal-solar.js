import { isFresh } from './rules.js';

export function solarTarget({ source, baseTarget, entities, mappings, now, maxAge, previous = {}, allowStart = true }) {
  const settings = source.solar;
  const normal = reason => ({ targetC: baseTarget, active: false, reason, next: { active: false } });
  if (!settings?.enabled) return normal('Normale comfortregeling.');
  const hour = Number(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
  if (hour < settings.fromHour || hour >= settings.untilHour) return normal('Buiten de zonneperiode: normaal comfortdoel.');
  const watts = (id, signed = false) => {
    const entity = entities.find(entity => entity.id === id);
    if (!isFresh(entity, now, maxAge) || entity.domain !== 'sensor' || !['W', 'kW'].includes(entity.unit) || entity.state.trim() === '') return null;
    const value = Number(entity.state) * (entity.unit === 'kW' ? 1000 : 1);
    return Number.isFinite(value) && (signed || value >= 0) ? value : null;
  };
  const pv = watts(mappings.solar);
  const power = watts(settings.powerEntity);
  const net = mappings.gridMode === 'signed' ? watts(mappings.gridPower, true) : null;
  const imported = mappings.gridMode === 'signed' ? net === null ? null : Math.max(0, net * (mappings.gridDirection === 'positive-export' ? -1 : 1)) : watts(mappings.gridImport);
  const exported = mappings.gridMode === 'signed' ? net === null ? null : Math.max(0, -net * (mappings.gridDirection === 'positive-export' ? -1 : 1)) : watts(mappings.gridExport);
  if ([pv, power, imported, exported].some(value => value === null)) return normal('Zon-, net- of aircovermogen ontbreekt of is verouderd: normaal comfortdoel.');
  if (mappings.batteryMode !== 'none') {
    const battery = mappings.batteryMode === 'measured' ? watts(mappings.batteryPower, true) : null;
    if (battery === null || battery * (mappings.batteryDirection === 'positive-discharge' ? -1 : 1) < -50) return normal('Batterijsituatie onbekend of batterij ontlaadt: geen zonneboost.');
  }
  if (pv <= 0) return normal('Geen gemeten zonneproductie: normaal comfortdoel.');
  if (!allowStart && !previous.active) return normal('Een andere airco heeft de zonneboost toegewezen gekregen.');
  const extraPower = previous.active ? Math.max(0, power - (previous.basePower ?? power)) : 0;
  const surplus = exported - imported + extraPower;
  const desired = previous.active ? surplus >= settings.stopW : surplus >= settings.startW;
  const next = { ...previous, candidate: desired };
  if (desired === Boolean(previous.active)) next.since = null;
  else {
    next.since = previous.candidate === desired && Number.isFinite(previous.since) ? previous.since : now;
    next.candidate = desired;
    if (now - next.since >= settings.delayMinutes * 60000) {
      next.active = desired;
      next.since = null;
      if (desired) next.basePower = power;
    }
  }
  const active = Boolean(next.active);
  return { targetC: active ? baseTarget + settings.boostC : baseTarget, active, surplusW: surplus, next,
    reason: active ? 'Zonnevoorverwarming actief, met correctie voor extra aircoverbruik.' : desired ? 'Zonoverschot aanwezig; startwachttijd loopt.' : 'Normaal comfortdoel; geen aanhoudend zonoverschot.' };
}