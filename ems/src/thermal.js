import { compatible, roles } from './home-assistant.js';
import { thermalSchema } from './store.js';
import { isFresh, planRules } from './rules.js';
import { solarTarget } from './thermal-solar.js';

export function entityPresence(entity) {
  const usable = entity?.available;
  if (!usable) return null;
  if (['person', 'device_tracker'].includes(entity.domain)) {
    if (['', 'unknown', 'unavailable'].includes(entity.state)) return null;
    return entity.state === 'home';
  }
  if (entity.domain === 'binary_sensor' && ['occupancy', 'presence'].includes(entity.deviceClass) && ['on', 'off'].includes(entity.state)) return entity.state === 'on';
  return null;
}

export function householdPresence(preferences, entities) {
  const members = (preferences.presenceEntities ?? []).map(id => {
    const entity = entities.find(entity => entity.id === id);
    const home = entityPresence(entity);
    return { id, name: entity?.name ?? id, home };
  });
  let occupied = null;
  if (members.length) {
    const values = members.map(member => member.home);
    if (preferences.presenceMode === 'all') occupied = values.includes(false) ? false : values.every(value => value === true) ? true : null;
    else occupied = values.includes(true) ? true : values.every(value => value === false) ? false : null;
  }
  return { occupied, mode: preferences.presenceMode ?? 'any', members };
}

export function validatePresencePreferences(preferences, entities) {
  for (const id of preferences.presenceEntities) {
    const entity = entities.find(entity => entity.id === id);
    if (!entity || !(['person', 'device_tracker'].includes(entity.domain) || entity.domain === 'binary_sensor' && ['occupancy', 'presence'].includes(entity.deviceClass))) throw new Error('Selecteer bestaande personen, device_trackers of aanwezigheidssensoren.');
  }
}

export function validateThermal(input, entities, mappings = {}) {
  const thermal = thermalSchema.parse(input);
  const find = id => entities.find(entity => entity.id === id);
  for (const source of thermal.sources) {
    if (source.entityId && find(source.entityId)?.domain !== 'climate') throw new Error('Een warmtebron moet een bestaande climate-entiteit gebruiken.');
    if (source.fanMode && (source.profile !== 'airco' || !find(source.entityId)?.fanModes?.includes(source.fanMode))) throw new Error('Kies een ventilatorstand die door deze airco wordt ondersteund.');
    if (source.solar.enabled && (!source.solar.powerEntity || !compatible(roles[0], find(source.solar.powerEntity) ?? {}))) throw new Error('Zonnevoorverwarming vereist een eigen aircovermogenssensor in W of kW.');
    if (source.solar.enabled && ['solar', 'gridPower', 'gridImport', 'gridExport', 'totalConsumption', 'batteryPower'].some(role => mappings[role] === source.solar.powerEntity)) throw new Error('Gebruik de eigen aircovermogensmeter, geen net-, productie-, woning- of batterijmeter.');
  }
  for (const room of thermal.rooms) {
    const tempEntity = find(room.temperatureEntity);
    const validTemp = tempEntity && (
      (tempEntity.domain === 'sensor' && compatible(roles.find(role => role.id === 'temperature'), tempEntity)) ||
      (tempEntity.domain === 'climate' && (Number.isFinite(tempEntity.currentTemperature) || tempEntity.available))
    );
    if (room.temperatureEntity && !validTemp) throw new Error('Een kamer vereist een bestaande temperatuursensor in graden Celsius of een climate-entiteit.');
    const presence = find(room.presenceEntity);
    if (room.presenceEntity && !(presence && (['person', 'device_tracker'].includes(presence.domain) || compatible(roles.find(role => role.id === 'presence'), presence)))) throw new Error('Een kamer vereist een bestaande aanwezigheidssensor.');
  }
  return thermal;
}

export function thermalReadings(thermal, entities, preferences = {}) {
  const find = id => entities.find(entity => entity.id === id);
  const sources = thermal.sources.map(source => {
    const entity = find(source.entityId);
    const available = Boolean(entity?.available && entity.domain === 'climate');
    return { ...source, available, mode: available ? entity.state : null, action: available ? entity.hvacAction ?? null : null,
      deviceTargetC: available && Number.isFinite(entity.targetTemperature) ? entity.targetTemperature : null };
  });
  const rooms = thermal.rooms.map(room => {
    const temperature = find(room.temperatureEntity);
    let currentC = null;
    let thermostatTargetC = null;
    if (temperature?.available) {
      if (temperature.domain === 'sensor' && temperature.unit === '°C' && temperature.state.trim() !== '' && Number.isFinite(Number(temperature.state))) {
        currentC = Number(temperature.state);
      } else if (temperature.domain === 'climate') {
        if (Number.isFinite(temperature.currentTemperature)) currentC = temperature.currentTemperature;
        if (Number.isFinite(temperature.targetTemperature)) thermostatTargetC = temperature.targetTemperature;
      }
    }
    if (thermostatTargetC === null) {
      for (const id of room.sourceIds) {
        const src = sources.find(s => s.id === id);
        if (Number.isFinite(src?.deviceTargetC)) {
          thermostatTargetC = src.deviceTargetC;
          break;
        }
      }
    }
    const presence = find(room.presenceEntity);
    const occupied = entityPresence(presence) ?? householdPresence(preferences, entities).occupied;
    const status = currentC === null ? 'missing' : currentC < room.targetC - 0.3 ? 'below' : currentC > room.targetC + 0.3 ? 'above' : 'at-target';
    return { ...room, currentC, thermostatTargetC, occupied, status, updatedAt: temperature?.updatedAt ?? null,
      sources: room.sourceIds.map(id => sources.find(source => source.id === id)).filter(Boolean) };
  });
  return { sources, rooms };
}

export function planThermal({ thermal, settings, entities, mappings, temperatureUnit, preferences = {}, now = Date.now(), solarMemory = new Map() }) {
  const plans = [];
  const sources = thermal.sources.filter(source => source.controlEnabled).sort((first, second) => first.priority - second.priority);
  let solarOwner = sources.find(source => source.solar?.enabled && solarMemory.get(source.id)?.active)?.id;
  for (const source of sources) {
    const room = thermal.rooms.find(room => room.id === source.controlRoomId && room.sourceIds.includes(source.id));
    const entity = entities.find(entity => entity.id === source.entityId);
    const definition = { id: `thermal:${source.id}:temperature`, name: source.name, priority: source.priority ?? 50,
      enabled: true, confirmed: source.confirmed, conditions: [],
      action: { type: 'climate_temperature', entityId: source.entityId, value: room?.targetC ?? 20, otherwise: room?.targetC ?? 20 } };
    const blocked = reason => ({ definition, id: definition.id, name: source.name, sourceId: source.id, origin: 'thermal', priority: definition.priority, status: 'blocked', command: null, reason });
    if (!room || !source.entityId) { plans.push(blocked('Kies een gekoppelde regelkamer en bedieningsentiteit.')); continue; }
    const planMode = (value, commandReason, stableReason) => {
      const modeDefinition = { ...definition, id: `thermal:${source.id}:mode`, action: { type: 'climate_mode', entityId: source.entityId, value, otherwise: value } };
      const mode = planRules({ settings: { ...settings, rules: [modeDefinition] }, entities, mappings, temperatureUnit, now })[0];
      return { ...mode, definition: modeDefinition, sourceId: source.id, origin: 'thermal', roomName: room.name,
        reason: mode.status === 'blocked' ? mode.reason : mode.command ? commandReason : stableReason };
    };
    const planFanMode = () => {
      const fanDefinition = { ...definition, id: `thermal:${source.id}:fan`, action: { type: 'climate_fan_mode', entityId: source.entityId, value: source.fanMode, otherwise: source.fanMode } };
      const blockedFan = reason => ({ id: fanDefinition.id, name: source.name, sourceId: source.id, origin: 'thermal', priority: definition.priority, status: 'blocked', observed: entity?.fanMode ?? null, command: null, reason, definition: fanDefinition });
      if (!entity?.available || !entity.fanModes?.includes(source.fanMode)) return blockedFan('De gekozen ventilatorstand wordt niet meer door deze airco ondersteund.');
      if (!entity.fanMode || !entity.fanModes.includes(entity.fanMode)) return blockedFan('De huidige ventilatorstand is niet beschikbaar.');
      const command = entity.fanMode === source.fanMode ? null : { entityId: entity.id, service: 'climate.set_fan_mode', value: source.fanMode };
      return { id: fanDefinition.id, name: source.name, sourceId: source.id, origin: 'thermal', priority: definition.priority,
        status: command ? 'planned' : 'stable', observed: entity.fanMode, command,
        reason: command ? `Ventilatorstand wijzigen naar ${source.fanMode}.` : `Ventilatorstand ${source.fanMode} bevestigd.`, definition: fanDefinition };
    };
    if (room.heatingEnabled === false && ['underfloor', 'airco'].includes(source.profile)) {
      plans.push(planMode('off', `${room.name}: klimaatregeling uitschakelen.`, `${room.name}: klimaatregeling staat uit.`));
      continue;
    }
    if (source.profile === 'unspecified') { plans.push(blocked('Kies een verwarmingsprofiel voor deze warmtebron.')); continue; }
    let baseTarget = room.targetC;
    let occupied = null;
    if (room.presenceControl) {
      const presence = entities.find(entity => entity.id === room.presenceEntity);
      occupied = entityPresence(presence) ?? householdPresence(preferences, entities).occupied;
      const awayC = room.awayC ?? preferences.awayC;
      if (occupied === null || !Number.isFinite(awayC)) { plans.push(blocked('Aanwezigheidsregeling vereist bekende, recente aanwezigheid en een afwezigtemperatuur.')); continue; }
      if (!occupied) baseTarget = Math.min(room.targetC, awayC);
    }
    const temperatureEntity = entities.find(item => item.id === room.temperatureEntity) ?? entity;
    const currentC = isFresh(temperatureEntity, now, settings.maxAgeSeconds) && temperatureEntity.domain === 'sensor' && temperatureEntity.unit === '°C' && temperatureEntity.state.trim() !== '' && Number.isFinite(Number(temperatureEntity.state))
      ? Number(temperatureEntity.state)
      : isFresh(temperatureEntity, now, settings.maxAgeSeconds) && temperatureEntity.domain === 'climate' && Number.isFinite(temperatureEntity.currentTemperature) ? temperatureEntity.currentTemperature : null;
    if (!Number.isFinite(currentC)) { plans.push(blocked('Automatische verwarming/koeling vereist een recente kamertemperatuur.')); continue; }
    const desiredMode = currentC < baseTarget - 0.5 ? 'heat' : currentC > baseTarget + 0.5 ? 'cool' : ['heat', 'cool'].includes(entity.state) ? entity.state : 'off';
    if (desiredMode === 'off') { plans.push(planMode('off', `${room.name}: doel bereikt; klimaatregeling uitschakelen.`, `${room.name}: doel bereikt; klimaatregeling blijft uit.`)); continue; }
    if (!entity?.hvacModes?.includes(desiredMode)) {
      if (entity?.hvacModes?.includes('off')) plans.push(planMode('off', `${room.name}: bron ondersteunt ${desiredMode === 'cool' ? 'koelen' : 'verwarmen'} niet; uitschakelen.`, `${room.name}: bron ondersteunt ${desiredMode === 'cool' ? 'koelen' : 'verwarmen'} niet en staat uit.`));
      else plans.push(blocked(`Deze bron ondersteunt ${desiredMode === 'cool' ? 'koelen' : 'verwarmen'} niet en kan niet veilig worden uitgeschakeld.`));
      continue;
    }
    if (entity.state !== desiredMode && entity.state !== 'off') {
      plans.push(planMode(desiredMode, `${room.name}: eerst naar ${desiredMode === 'cool' ? 'koel' : 'verwarm'}modus schakelen.`, `${room.name}: gewenste klimaatmodus is actief.`));
      continue;
    }
    const solar = desiredMode === 'cool' ? { targetC: baseTarget, active: false, next: { active: false }, reason: 'Koelen: zonnevoorverwarming niet toegepast.' }
      : room.presenceControl && occupied === false ? { targetC: baseTarget, active: false, next: { active: false }, reason: 'Afwezig: begrensd afwezigdoel, geen zonneboost.' }
        : solarTarget({ source, baseTarget, entities, mappings, now, maxAge: settings.maxAgeSeconds, previous: solarMemory.get(source.id), allowStart: !solarOwner || solarOwner === source.id });
    if (source.solar?.enabled && !solarOwner && (solar.active || solar.next.candidate === true)) solarOwner = source.id;
    if (solar.active && Number.isFinite(entity.targetStepC) && entity.targetStepC > 0 && Number.isFinite(entity.maxTempC)) solar.targetC = Math.max(room.targetC, Math.floor(Math.min(solar.targetC, entity.maxTempC, 26) / entity.targetStepC) * entity.targetStepC);
    definition.action.value = definition.action.otherwise = solar.targetC;
    const decision = planRules({ settings: { ...settings, rules: [definition] }, entities, mappings, temperatureUnit, now })[0];
    plans.push({ ...decision, definition, sourceId: source.id, origin: 'thermal', roomName: room.name, solarNext: solar.next, targetC: solar.targetC,
      reason: decision.status === 'blocked' ? decision.reason : `${room.name}: doel ${solar.targetC} graden. ${solar.reason}` });
    if (decision.status !== 'stable') continue;
    const modePlan = planMode(desiredMode, `Doel bevestigd; ${desiredMode === 'cool' ? 'koelmodus' : 'verwarmmodus'} inschakelen.`, 'De eigen thermostaat regelt op het ingestelde kamerdoel.');
    plans.push(modePlan);
    if (modePlan.status === 'stable' && source.fanMode) plans.push(planFanMode());
  }
  return plans;
}