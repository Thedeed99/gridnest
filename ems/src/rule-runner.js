import { isFresh, planRules } from './rules.js';
import { planThermal } from './thermal.js';

export function createRuleRunner({ store, provider, unitProvider, execute, activeAllowed = false, demo = false, clock = Date.now }) {
  const memory = new Map();
  const ruleMemory = new Map();
  const solarMemory = new Map();
  const thermalDevices = new Map();
  let timer;
  let running;
  let lastMode;
  let lastThermalMode;
  let status = { mode: 'off', activeAllowed, updatedAt: null, decisions: [] };
  async function run() {
    const snapshot = store.get();
    const settings = snapshot.control;
    const thermal = snapshot.thermal ?? { mode: 'off', sources: [], rooms: [] };
    const now = clock();
    if (settings.mode !== lastMode) { for (const key of memory.keys()) if (!key.startsWith('thermal:')) memory.delete(key); ruleMemory.clear(); lastMode = settings.mode; }
    if (thermal.mode !== lastThermalMode) { for (const key of memory.keys()) if (key.startsWith('thermal:')) memory.delete(key); solarMemory.clear(); thermalDevices.clear(); lastThermalMode = thermal.mode; }
    status = { mode: settings.mode, thermalMode: thermal.mode, activeAllowed, updatedAt: new Date(now).toISOString(), decisions: [] };
    if (settings.mode === 'off' && thermal.mode === 'off') return status;
    try {
      const connection = await provider();
      if (!connection.connected && !demo) throw new Error('offline');
      const temperatureUnit = thermal.mode !== 'off' || settings.rules.some(rule => rule.enabled && rule.action.type === 'climate_temperature') ? await unitProvider() : null;
      const collect = (entities, time) => {
        const power = settings.mode === 'off' ? [] : planRules({ settings, entities, mappings: snapshot.mappings, temperatureUnit, now: time, ruleMemory }).map(decision => ({ ...decision, origin: 'power', definition: settings.rules.find(rule => rule.id === decision.id) }));
        const heat = thermal.mode === 'off' ? [] : planThermal({ thermal, settings, entities, mappings: snapshot.mappings, preferences: snapshot.preferences, temperatureUnit, now: time, solarMemory });
        const conflicts = new Set(power.filter(decision => decision.definition.enabled && heat.some(item => item.definition.action.entityId === decision.definition.action.entityId)).map(decision => decision.definition.action.entityId));
        return [...power, ...heat].map(decision => conflicts.has(decision.definition.action.entityId) ? { ...decision, command: null, status: 'blocked', reason: 'Dubbele thermostaatbediening in Warmte en Stroom. Schakel de oude stroomregel uit.' } : decision).sort((first, second) => first.priority - second.priority);
      };
      const decisions = collect(connection.entities, now);
      for (const decision of decisions) if (decision.solarNext) solarMemory.set(decision.sourceId, decision.solarNext);
      status.decisions = decisions;
      const sentEntities = new Set();
      let sent = 0;
      for (const decision of decisions) {
        const rule = decision.definition;
        const heating = decision.origin === 'thermal';
        const signature = heating ? JSON.stringify({ source: thermal.sources.find(source => source.id === decision.sourceId), room: thermal.rooms.find(room => room.id === thermal.sources.find(source => source.id === decision.sourceId)?.controlRoomId) }) : JSON.stringify(rule);
        const previous = memory.get(rule.id)?.signature === signature ? memory.get(rule.id) : { signature };
        memory.set(rule.id, previous);
        if ((heating ? thermal.mode : settings.mode) !== 'active') continue;
        if (!activeAllowed || demo) { decision.command = null; decision.status = 'blocked'; decision.reason = 'Live sturing niet vrijgegeven of demomodus actief.'; continue; }
        if (previous.faulted || (previous.holdUntil ?? 0) > now) { decision.command = null; decision.status = 'paused'; decision.reason = previous.faulted ? 'Onzekere opdracht: schakel de regelaar uit en controleer het apparaat voordat je heractiveert.' : 'Handmatige wijziging: bron tijdelijk gepauzeerd.'; continue; }
        if (decision.status === 'blocked' || decision.status === 'disabled') continue;
        const device = heating ? thermalDevices.get(rule.action.entityId) ?? {} : null;
        const currentDevice = connection.entities.find(entity => entity.id === rule.action.entityId);
        if (device) {
          if (device.mode !== undefined && device.mode !== currentDevice.state && device.expectedMode !== currentDevice.state) device.holdUntil = now + settings.manualHoldMinutes * 60000;
          if (device.expectedMode === currentDevice.state) device.expectedMode = null;
          device.mode = currentDevice.state;
          thermalDevices.set(rule.action.entityId, device);
          if ((device.holdUntil ?? 0) > now) { decision.command = null; decision.status = 'paused'; decision.reason = 'Warmtebron handmatig gewijzigd of opdracht onzeker; bron gepauzeerd.'; continue; }
        }
        if (previous.pending) {
          const expected = previous.pending;
          const confirmed = typeof expected.value === 'number' ? Math.abs(decision.observed - expected.value) < 0.001 : decision.observed === expected.value;
          if (!confirmed) {
            decision.command = null;
            decision.status = now - expected.sentAt > 120000 ? 'paused' : 'waiting';
            decision.reason = 'Wachten op apparaatbevestiging; er wordt niet automatisch opnieuw verzonden.';
            if (decision.status === 'paused') { previous.faulted = true; if (device) device.holdUntil = Infinity; }
            continue;
          }
          previous.pending = null;
          previous.observed = decision.observed;
        } else if (previous.observed !== undefined && previous.observed !== decision.observed) {
          previous.observed = decision.observed;
          previous.holdUntil = now + settings.manualHoldMinutes * 60000;
          if (device) device.holdUntil = previous.holdUntil;
          decision.command = null; decision.status = 'paused'; decision.reason = 'Handmatige of externe wijziging gerespecteerd.'; continue;
        }
        previous.observed = decision.observed;
        if (!decision.command) continue;
        const actuator = connection.entities.find(entity => entity.id === decision.command.entityId);
        const switching = decision.command.service.startsWith('switch.') || decision.command.service === 'climate.set_hvac_mode';
        const changed = Date.parse(actuator?.changedAt);
        const protectiveStop = rule.action.type === 'battery_power' && decision.command.value === 0;
        if (!protectiveStop && ((previous.sentAt && now - previous.sentAt < settings.minIntervalSeconds * 1000) || switching && (!Number.isFinite(changed) || now - changed < settings.minIntervalSeconds * 1000))) {
          decision.command = null; decision.status = 'waiting'; decision.reason = 'Minimale tijd tussen opdrachten nog niet verstreken.'; continue;
        }
        if (sent >= 4 || sentEntities.has(actuator.id)) { decision.command = null; decision.status = 'waiting'; decision.reason = 'Opdracht volgt in een volgende regelcyclus.'; continue; }
        if (JSON.stringify(store.get()) !== JSON.stringify(snapshot)) break;
        const freshConnection = await provider();
        if (!freshConnection.connected) throw new Error('offline');
        const verified = collect(freshConnection.entities, clock()).find(item => item.id === rule.id);
        if (!verified?.command || JSON.stringify(verified.command) !== JSON.stringify(decision.command) || !freshConnection.entities.find(item => item.id === actuator.id)?.available || JSON.stringify(store.get()) !== JSON.stringify(snapshot)) {
          decision.command = null; decision.status = 'waiting'; decision.reason = 'Meetwaarden of instellingen gewijzigd; opnieuw beoordelen.'; continue;
        }
        try {
          await execute(decision.command);
          if (device && decision.command.service === 'climate.set_hvac_mode') device.expectedMode = decision.command.value;
          previous.pending = { value: decision.command.service.startsWith('switch.') ? decision.command.service.endsWith('turn_on') ? 'on' : 'off' : decision.command.value, sentAt: clock() };
          previous.sentAt = clock();
          decision.status = 'sent'; decision.reason = 'Opdracht verzonden; apparaatbevestiging volgt.';
          sentEntities.add(actuator.id); sent++;
        } catch {
          previous.faulted = true;
          if (device) device.holdUntil = Infinity;
          decision.command = null; decision.status = 'paused'; decision.reason = 'Opdrachtresultaat onzeker; geen automatische herhaling.';
        }
      }
    } catch {
      status.error = 'Regelcyclus geblokkeerd: verbinding of apparaatdata niet beschikbaar.';
    }
    return status;
  }
  return {
    status: () => structuredClone(status),
    tick() {
      if (running) return running;
      running = run().finally(() => { running = null; });
      return running;
    },
    start() { if (!timer) timer = setInterval(() => { this.tick(); }, 30000); this.tick(); },
    stop() { clearInterval(timer); timer = null; }
  };
}