import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { executeRuleCommand, readEntities, readTemperatureUnit, readings, roles, validateMappings } from './home-assistant.js';
import { createStore, heatingProfiles, preferencesSchema } from './store.js';
import { energySummary } from './energy.js';
import { demoEntities } from './demo.js';
import { householdPresence, thermalReadings, validatePresencePreferences, validateThermal } from './thermal.js';
import { actionTypes, isFresh, validateRules } from './rules.js';
import { createRuleRunner } from './rule-runner.js';
import { demoUtilityHistory, readUtilityHistory } from './gas.js';
import { dailyEnergyRecap, demoDailyRecap, recapMeters, readDailyRecap } from './daily-recap.js';
import { readOfficialEnergy } from './energy-statistics.js';
import { cumulativeSolarToday, isCumulativeSolarMeter, readSolarMeterToday } from './solar-meter.js';

export function createApp({ store, entitiesProvider, demo = false, supervisor = false, runner = null,
  isIngressRequest = request => request.socket.remoteAddress === '172.30.32.2' || request.socket.remoteAddress === '::ffff:172.30.32.2',
  utilityHistoryProvider = async () => ({ available: false, series: { hours24: [], days7: [], days30: [] } }),
  dailyRecapProvider = async () => ({ available: false, complete: false, rows: [] }),
  officialRecapProvider = async () => null,
  solarTodayProvider = async () => null,
  batterySwitchProvider = async () => { throw new Error('Accubediening niet beschikbaar.'); },
  consumerSwitchProvider = async () => { throw new Error('Verbruikerbediening niet beschikbaar.'); },
  evCommandProvider = async () => { throw new Error('Laadpaalbediening niet beschikbaar.'); },
  solarLimitProvider = async () => { throw new Error('Omvormerbediening niet beschikbaar.'); } }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'");
    if (supervisor && !isIngressRequest(request)) {
      return response.status(403).json({ error: 'Gebruik de Home Assistant-interface.' });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (request.headers['sec-fetch-site'] === 'cross-site') return response.status(403).json({ error: 'Verzoek geweigerd.' });
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return response.status(403).json({ error: 'Verzoek geweigerd.' });
      if (!request.is('application/json')) return response.status(415).json({ error: 'JSON vereist.' });
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_request, response) => response.json({ status: 'ok', mode: store.get().control.mode }));
  app.get('/api/bootstrap', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const config = store.get();
    let connection;
    try {
      connection = await entitiesProvider();
    } catch (error) {
      connection = { connected: false, entities: [], message: 'Home Assistant uitlezen mislukt. Controleer verbinding en toegangsrechten.' };
    }
    response.json({ ...connection, demo, mode: config.control.mode === 'active' || config.thermal.mode === 'active' ? 'active' : 'read-only', roles, heatingProfiles,
      control: config.control, actionTypes, controlStatus: runner?.status() ?? { mode: config.control.mode, thermalMode: config.thermal.mode, activeAllowed: false, decisions: [] },
      mappings: config.mappings, preferences: config.preferences,
      thermal: config.thermal, thermalReadings: thermalReadings(config.thermal, connection.entities, config.preferences),
      householdPresence: householdPresence(config.preferences, connection.entities),
      energy: energySummary(config.mappings, connection.entities),
      readings: readings(config.mappings, connection.entities), fetchedAt: new Date().toISOString() });
  });
  app.get('/api/utility-history/:utility', async (request, response) => {
    const { utility } = request.params;
    const config = store.get();
    const entityId = ({ gas: config.mappings.gasConsumption, water: config.mappings.waterConsumption })[utility];
    if (!['gas', 'water'].includes(utility)) return response.status(404).json({ error: 'Onbekende meter.' });
    if (!config.preferences[utility === 'gas' ? 'showGas' : 'showWater']) return response.status(403).json({ error: 'Deze meter is uitgeschakeld in Mijn wensen.' });
    if (!entityId) return response.status(409).json({ error: `Koppel eerst een cumulatieve ${utility}meter.` });
    try { return response.json(await utilityHistoryProvider(entityId, utility)); }
    catch (error) { return response.status(503).json({ error: error.message || 'Metergeschiedenis niet beschikbaar.' }); }
  });
  app.get('/api/daily-recap', async (_request, response) => {
    try {
      const config = store.get();
      const hasSolarMeter = Boolean(config.mappings.solarToday);
      const [history, official, solar] = await Promise.allSettled([dailyRecapProvider(config.mappings), officialRecapProvider(config.mappings), hasSolarMeter ? solarTodayProvider(config.mappings.solarToday, config.mappings.solarTodayMode) : Promise.resolve(null)]);
      const statistics = official.status === 'fulfilled' ? official.value : null;
      const cumulative = config.mappings.solarTodayMode === 'total' || solar.status === 'fulfilled' && solar.value?.source === 'cumulative-meter';
      const solarToday = cumulative ? solar.status === 'fulfilled' && solar.value ? solar.value : { energyKwh: null, complete: false, source: 'cumulative-meter', error: 'Zonne-totaalmeterhistorie niet beschikbaar.' } : null;
      if (history.status === 'rejected' && !statistics && solarToday?.energyKwh == null) throw history.reason;
      const recap = history.status === 'fulfilled' ? history.value : { available: false, complete: false, rows: [] };
      response.setHeader('Cache-Control', 'no-store');
      return response.json({ ...(statistics ? { ...recap, officialRows: statistics.rows, source: 'home-assistant', updatedThrough: statistics.updatedThrough } : recap), ...(cumulative ? { solarToday } : {}) });
    } catch (error) {
      return response.status(503).json({ error: error.message || 'Dagrecap niet beschikbaar.' });
    }
  });
  app.post('/api/consumers/enable', async (request, response) => {
    const body = z.object({ consumerId: z.string().regex(/^sensor\.[a-z0-9_]+$/), switchId: z.string().regex(/^switch\.[a-z0-9_]+$/),
      enabled: z.boolean(), expectedState: z.enum(['on', 'off']), confirm: z.literal(true) }).strict().safeParse(request.body);
    if (!body.success) return response.status(400).json({ error: 'Bevestig een geldige verbruikerschakelaar en gewenste stand.' });
    const snapshot = store.get();
    if (!supervisor || demo || !runner?.status().activeAllowed) return response.status(403).json({ error: 'Verbruikerbediening vereist apparaatvrijgave in de Home Assistant-app.' });
    const { consumerId, switchId, enabled, expectedState } = body.data;
    if (snapshot.mappings.knownSource !== 'individual' || !snapshot.mappings.knownConsumers.includes(consumerId) || snapshot.mappings.knownConsumerSwitches[consumerId] !== switchId) return response.status(409).json({ error: 'De verbruiker of schakelaar is niet meer zo gekoppeld.' });
    try {
      const connection = await entitiesProvider();
      const actuator = connection.entities.find(entity => entity.id === switchId);
      if (!connection.connected || !actuator?.available || actuator.domain !== 'switch' || actuator.state !== expectedState) return response.status(409).json({ error: 'De schakelaar is niet beschikbaar of heeft inmiddels een andere stand.' });
      const current = store.get();
      if (!runner.status().activeAllowed || current.mappings.knownSource !== 'individual' ||
        !current.mappings.knownConsumers.includes(consumerId) || current.mappings.knownConsumerSwitches[consumerId] !== switchId) return response.status(409).json({ error: 'Vrijgave of koppeling is gewijzigd; bevestig opnieuw.' });
      await consumerSwitchProvider(switchId, enabled);
      return response.json({ consumerId, switchId, enabled });
    } catch (error) {
      return response.status(503).json({ error: error.message || 'Verbruikerschakelaar bedienen mislukt.' });
    }
  });
  app.post('/api/battery/enable', async (request, response) => {
    const body = z.object({ enabled: z.boolean(), confirm: z.literal(true) }).strict().safeParse(request.body);
    if (!body.success) return response.status(400).json({ error: 'Bevestig de gewenste accustand.' });
    if (!supervisor || demo || !runner?.status().activeAllowed) return response.status(403).json({ error: 'Accubediening vereist vrijgave in de Home Assistant-app.' });
    const entityId = store.get().mappings.batteryEnable;
    if (!entityId) return response.status(409).json({ error: 'Koppel eerst een accuschakelaar.' });
    try {
      const connection = await entitiesProvider();
      const actuator = connection.entities.find(entity => entity.id === entityId);
      if (!connection.connected || !actuator?.available || actuator.domain !== 'switch' || !['on', 'off'].includes(actuator.state)) {
        return response.status(409).json({ error: 'De gekoppelde accuschakelaar is niet beschikbaar of heeft geen geldige aan/uitstatus.' });
      }
      if (!runner.status().activeAllowed || store.get().mappings.batteryEnable !== entityId) return response.status(409).json({ error: 'Accuvrijgave of koppeling is gewijzigd; bevestig opnieuw.' });
      await batterySwitchProvider(entityId, body.data.enabled);
      let verified = false;
      try {
        const feedback = await entitiesProvider();
        const observed = feedback.entities.find(entity => entity.id === entityId);
        verified = Boolean(feedback.connected && observed?.available && observed.state === (body.data.enabled ? 'on' : 'off'));
      } catch {}
      return response.json({ entityId, enabled: body.data.enabled, verified });
    } catch (error) {
      return response.status(503).json({ error: error.message || 'Accubediening mislukt.' });
    }
  });
  app.post('/api/batteries/:batteryId/enable', async (request, response) => {
    const body = z.object({ switchId: z.string().regex(/^switch\.[a-z0-9_]+$/), enabled: z.boolean(),
      expectedState: z.enum(['on', 'off']), confirm: z.literal(true) }).strict().safeParse(request.body);
    if (!body.success || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.params.batteryId)) return response.status(400).json({ error: 'Bevestig een geldige accuschakelaar en gewenste stand.' });
    if (!supervisor || demo || !runner?.status().activeAllowed) return response.status(403).json({ error: 'Accubediening vereist vrijgave in de Home Assistant-app.' });
    const { switchId, enabled, expectedState } = body.data;
    const battery = store.get().mappings.batteries.find(item => item.id === request.params.batteryId);
    if (!battery || battery.switchEntity !== switchId) return response.status(409).json({ error: 'De accuschakelaar is niet meer zo gekoppeld.' });
    try {
      const connection = await entitiesProvider();
      const actuator = connection.entities.find(entity => entity.id === switchId);
      if (!connection.connected || !actuator?.available || actuator.domain !== 'switch' || actuator.state !== expectedState) return response.status(409).json({ error: 'De accuschakelaar is niet beschikbaar of heeft inmiddels een andere stand.' });
      const current = store.get().mappings.batteries.find(item => item.id === request.params.batteryId);
      if (!runner.status().activeAllowed || current?.switchEntity !== switchId) return response.status(409).json({ error: 'Accuvrijgave of koppeling is gewijzigd; bevestig opnieuw.' });
      await batterySwitchProvider(switchId, enabled);
      return response.json({ batteryId: request.params.batteryId, switchId, enabled });
    } catch (error) {
      return response.status(503).json({ error: error.message || 'Accubediening mislukt.' });
    }
  });
  app.post('/api/battery/levels', async (request, response) => {
    const body = z.object({ batteryId: z.string(), min: z.number().finite().min(0).max(100), max: z.number().finite().min(0).max(100), confirm: z.literal(true) }).strict().parse(request.body);
    if (!supervisor || demo || !runner?.status().activeAllowed || store.get().control.mode !== 'active') return response.status(403).json({ error: 'Batterijniveaus instellen vereist vrijgave en Actief.' });
    if (body.min >= body.max) return response.status(400).json({ error: 'Minimum moet lager zijn dan maximum.' });
    const mappings = store.get().mappings;
    const battery = body.batteryId === 'main_battery' ? { minLevelEntity: mappings.batteryMinLevel, maxLevelEntity: mappings.batteryMaxLevel } : mappings.batteries.find(item => item.id === body.batteryId);
    if (mappings.batteryMode === 'none' || !battery?.minLevelEntity || !battery.maxLevelEntity || battery.minLevelEntity === battery.maxLevelEntity) return response.status(409).json({ error: 'Koppel twee afzonderlijke niveau-entiteiten voor deze batterij.' });
    const connection = await entitiesProvider();
    const commands = [['minLevelEntity', body.min], ['maxLevelEntity', body.max]].map(([key, value]) => {
      const entity = connection.entities.find(item => item.id === battery[key]);
      return { entity, value };
    });
    if (!connection.connected || commands.some(({ entity, value }) => !entity?.available || entity.domain !== 'number' || entity.unit !== '%' || entity.state.trim() === '' || !Number.isFinite(Number(entity.state)) || !Number.isFinite(entity.minimum) || !Number.isFinite(entity.maximum) || !Number.isFinite(entity.step) || entity.step <= 0 || value < entity.minimum || value > entity.maximum || Math.abs((value - entity.minimum) / entity.step - Math.round((value - entity.minimum) / entity.step)) > 0.000001)) return response.status(409).json({ error: 'Niveau-entiteiten of waarden zijn niet geldig voor dit apparaat.' });
    if (JSON.stringify(store.get().mappings) !== JSON.stringify(mappings) || !runner.status().activeAllowed || store.get().control.mode !== 'active') return response.status(409).json({ error: 'Vrijgave of koppelingen gewijzigd.' });
    if (body.min >= Number(commands[1].entity.state)) commands.reverse();
    for (const { entity, value } of commands) await evCommandProvider({ entityId: entity.id, service: 'number.set_value', value });
    response.json({ sent: true });
  });
  app.post('/api/ev/control', async (request, response) => {
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('enable'), enabled: z.boolean(), confirm: z.literal(true) }).strict(),
      z.object({ action: z.literal('current'), value: z.number().finite().min(6).max(32), confirm: z.literal(true) }).strict(),
      z.object({ action: z.literal('lock'), locked: z.boolean(), confirm: z.literal(true) }).strict()
    ]).safeParse(request.body);
    if (!body.success) return response.status(400).json({ error: 'Bevestig een geldige laadpaalopdracht.' });
    const snapshot = store.get();
    if (!supervisor || demo || !runner?.status().activeAllowed) return response.status(403).json({ error: 'Laadpaalbediening vereist apparaatvrijgave in de Home Assistant-app.' });
    const role = { enable: 'evEnable', current: 'evCurrentLimit', lock: 'evLockStatus' }[body.data.action];
    const entityId = snapshot.mappings[role];
    if (!entityId) return response.status(409).json({ error: 'Koppel eerst de bijbehorende laadpaalbediening.' });
    try {
      const connection = await entitiesProvider();
      const actuator = connection.entities.find(entity => entity.id === entityId);
      if (!connection.connected || !actuator?.available) return response.status(409).json({ error: 'De gekoppelde laadpaalbediening is niet beschikbaar.' });
      let command;
      if (body.data.action === 'current') {
        const { value } = body.data;
        if (actuator.domain !== 'number' || actuator.unit !== 'A' || !Number.isFinite(actuator.minimum) || !Number.isFinite(actuator.maximum) ||
          !Number.isFinite(actuator.step) || actuator.step <= 0 || value < actuator.minimum || value > actuator.maximum ||
          Math.abs((value - actuator.minimum) / actuator.step - Math.round((value - actuator.minimum) / actuator.step)) > 0.000001) return response.status(409).json({ error: 'Deze laadstroom wordt niet ondersteund.' });
        command = { entityId, service: 'number.set_value', value };
      } else if (body.data.action === 'enable') {
        if (actuator.domain !== 'switch' || !['on', 'off'].includes(actuator.state)) return response.status(409).json({ error: 'Ongeldige laadschakelaar.' });
        if (body.data.enabled) {
          const cable = connection.entities.find(entity => entity.id === snapshot.mappings.evCableStatus);
          if (!isFresh(cable, Date.now(), snapshot.control.maxAgeSeconds) || cable.state !== 'on') return response.status(409).json({ error: 'Starten vereist een aangesloten kabel met recente status.' });
        }
        command = { entityId, service: `switch.turn_${body.data.enabled ? 'on' : 'off'}` };
      } else {
        if (!['lock', 'switch'].includes(actuator.domain) || !(actuator.domain === 'switch' ? ['on', 'off'] : ['locked', 'unlocked']).includes(actuator.state)) return response.status(409).json({ error: 'Ongeldige kabelvergrendeling.' });
        const service = actuator.domain === 'switch' ? `switch.turn_${body.data.locked ? 'on' : 'off'}` : `lock.${body.data.locked ? 'lock' : 'unlock'}`;
        command = { entityId, service };
      }
      await evCommandProvider(command);
      return response.json(command);
    } catch (error) {
      return response.status(503).json({ error: error.message || 'Laadpaalbediening mislukt.' });
    }
  });
  app.post('/api/solar/limit', async (request, response) => {
    const body = z.object({ value: z.number().finite().min(0).max(100), confirm: z.literal(true) }).strict().safeParse(request.body);
    if (!body.success) return response.status(400).json({ error: 'Bevestig een productielimiet tussen 0 en 100%.' });
    const snapshot = store.get();
    if (!supervisor || demo || !runner?.status().activeAllowed || snapshot.control.mode !== 'active') return response.status(403).json({ error: 'Omvormerbediening vereist vrijgave en actieve regels in de Home Assistant-app.' });
    const entityId = snapshot.mappings.solarLimit;
    if (!entityId) return response.status(409).json({ error: 'Koppel eerst een productielimiet voor de omvormer.' });
    try {
      const connection = await entitiesProvider();
      const actuator = connection.entities.find(entity => entity.id === entityId);
      if (!connection.connected || !isFresh(actuator, Date.now(), snapshot.control.maxAgeSeconds) || actuator.domain !== 'number' || actuator.unit !== '%' ||
        !Number.isFinite(actuator.minimum) || actuator.minimum > 0 || !Number.isFinite(actuator.maximum) || actuator.maximum < 100 ||
        !Number.isFinite(actuator.step) || actuator.step <= 0 || Math.abs((body.data.value - actuator.minimum) / actuator.step - Math.round((body.data.value - actuator.minimum) / actuator.step)) > 0.000001) {
        return response.status(409).json({ error: 'De gekoppelde omvormerlimiet ontbreekt, is niet recent of ondersteunt deze waarde/stap niet.' });
      }
      await solarLimitProvider(entityId, body.data.value);
      return response.json({ entityId, value: body.data.value });
    } catch (error) {
      return response.status(503).json({ error: error.message || 'Omvormerbediening mislukt.' });
    }
  });
  app.put('/api/mappings', async (request, response) => {
    const connection = await entitiesProvider();
    if (!connection.connected && !demo) return response.status(409).json({ error: 'Verbind eerst met Home Assistant.' });
    let mappings;
    try {
      mappings = validateMappings(request.body, connection.entities);
    } catch (error) {
      return response.status(400).json({ error: error instanceof ZodError ? 'Ongeldige entiteitenkoppeling.' : error.message });
    }
    await store.update({ mappings });
    response.json({ mappings });
  });
  app.put('/api/preferences', async (request, response) => {
    const preferences = preferencesSchema.parse(request.body);
    const connection = await entitiesProvider();
    try { validatePresencePreferences(preferences, connection.entities); }
    catch (error) { return response.status(400).json({ error: error.message }); }
    await store.update({ preferences });
    await runner?.tick();
    response.json({ preferences });
  });
  app.put('/api/thermal', async (request, response) => {
    const connection = await entitiesProvider();
    let thermal;
    try {
      thermal = validateThermal(request.body, connection.entities, store.get().mappings);
    } catch (error) {
      return response.status(400).json({ error: error instanceof ZodError ? error.issues[0].message : error.message });
    }
    if (thermal.mode === 'active' && (demo || !supervisor || !runner?.status().activeAllowed || (store.get().thermal.mode !== 'active' && request.get('X-Gridnest-Confirm-Control') !== 'true'))) return response.status(403).json({ error: 'Actieve Warmte vereist appvrijgave en expliciete bevestiging.' });
    await store.update({ thermal });
    await runner?.tick();
    response.json({ thermal, controlStatus: runner?.status() });
  });
  app.post('/api/thermal/pause', async (_request, response) => {
    const thermal = { ...store.get().thermal, mode: 'off' };
    await store.update({ thermal });
    await runner?.tick();
    response.json({ thermal, controlStatus: runner?.status() });
  });
  app.put('/api/rules', async (request, response) => {
    const body = z.object({ control: z.unknown(), confirmActive: z.boolean().default(false) }).strict().parse(request.body);
    const connection = await entitiesProvider();
    let control;
    try {
      control = validateRules(body.control, connection.entities);
    } catch (error) {
      return response.status(400).json({ error: error instanceof ZodError ? error.issues[0].message : error.message });
    }
    if (control.mode === 'active' && (demo || !supervisor || !runner?.status().activeAllowed || (store.get().control.mode !== 'active' && !body.confirmActive))) {
      return response.status(403).json({ error: 'Actieve sturing vereist vrijgave in de Home Assistant-app en expliciete bevestiging.' });
    }
    await store.update({ control });
    await runner?.tick();
    response.json({ control, controlStatus: runner?.status() });
  });
  app.post('/api/rules/pause', async (_request, response) => {
    const control = { ...store.get().control, mode: 'off' };
    await store.update({ control });
    await runner?.tick();
    response.json({ control, controlStatus: runner?.status() });
  });
  app.post('/api/rules/evaluate', async (_request, response) => {
    await runner?.tick();
    response.json({ controlStatus: runner?.status() });
  });
  app.post('/api/system/mode', async (request, response) => {
    const body = z.object({ mode: z.enum(['off', 'preview', 'active']), confirm: z.boolean().default(false) }).strict().parse(request.body);
    const current = store.get();
    if (body.mode === 'active' && (demo || !supervisor || !runner?.status().activeAllowed || !body.confirm)) {
      return response.status(403).json({ error: 'Actieve sturing vereist vrijgave in de Home Assistant-app en expliciete bevestiging.' });
    }
    const control = { ...current.control, mode: body.mode };
    const thermal = { ...current.thermal, mode: body.mode };
    await store.update({ control, thermal });
    await runner?.tick();
    response.json({ mode: body.mode, control, thermal, controlStatus: runner?.status() });
  });
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { index: 'index.html' }));
  app.use((_request, response) => response.status(404).json({ error: 'Niet gevonden.' }));
  app.use((error, _request, response, _next) => {
    const badRequest = error instanceof ZodError || error.type === 'entity.parse.failed' || error.type === 'entity.too.large';
    response.status(badRequest ? 400 : 503).json({ error: badRequest ? 'Ongeldige invoer. Controleer waarden en tijdsperiode.' : 'Actie mislukt. Controleer verbinding en opslag.' });
  });
  return app;
}

export async function startServer(env = process.env) {
  const demo = env.DEMO_MODE === 'true';
  if (demo && (env.SUPERVISOR_TOKEN || env.HA_TOKEN)) throw new Error('Demomodus en echte toegangssleutels mogen niet gecombineerd worden.');
  const supervisor = Boolean(env.SUPERVISOR_TOKEN);
  const controlEnv = { ...env, CONTROL_ENABLED: supervisor && env.CONTROL_ENABLED === 'true' ? 'true' : 'false' };
  const store = await createStore(env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)), demo ? 'demo' : 'home-assistant');
  const entitiesProvider = demo ? async () => ({ connected: false, entities: demoEntities(), message: 'Voorbeeldwoning · geen echte verbinding' }) : () => readEntities(env);
  const utilityHistoryProvider = demo ? async (_entityId, utility) => demoUtilityHistory(utility) : entityId => readUtilityHistory(env, entityId);
  const dailyRecapProvider = demo
    ? async mappings => demoDailyRecap(recapMeters(mappings, demoEntities()))
    : async mappings => readDailyRecap(env, recapMeters(mappings, (await entitiesProvider()).entities));
  const batterySwitchProvider = (entityId, enabled) => executeRuleCommand({ entityId, service: `switch.turn_${enabled ? 'on' : 'off'}` }, controlEnv);
  const officialRecapProvider = demo ? async () => null : mappings => readOfficialEnergy(env, mappings);
  const solarTodayProvider = async (entityId, mode) => {
    const now = new Date();
    const entity = (await entitiesProvider()).entities.find(item => item.id === entityId);
    if (!entity) return { energyKwh: null, complete: false };
    if (!isCumulativeSolarMeter(entity, mode)) return null;
    if (!demo) return readSolarMeterToday(env, entity, fetch, now);
    return cumulativeSolarToday([[{ state: String(Number(entity.state) - (entity.unit === 'Wh' ? 7120 : 7.12)), last_updated: new Date(now.getTime() - 30 * 3600000).toISOString() }]], entity, now);
  };
  const consumerSwitchProvider = (entityId, enabled) => executeRuleCommand({ entityId, service: `switch.turn_${enabled ? 'on' : 'off'}` }, controlEnv);
  const solarLimitProvider = (entityId, value) => executeRuleCommand({ entityId, service: 'number.set_value', value }, controlEnv);
  const evCommandProvider = command => executeRuleCommand(command, controlEnv);
  const runner = createRuleRunner({ store, provider: entitiesProvider, demo,
    unitProvider: demo ? async () => '°C' : () => readTemperatureUnit(env),
    activeAllowed: supervisor && controlEnv.CONTROL_ENABLED === 'true' && !demo,
    execute: command => executeRuleCommand(command, controlEnv) });
  const app = createApp({ store, demo, supervisor, entitiesProvider, runner, utilityHistoryProvider, dailyRecapProvider, officialRecapProvider, solarTodayProvider, batterySwitchProvider, solarLimitProvider, evCommandProvider, consumerSwitchProvider });
  const server = app.listen(8080, env.HOST || (supervisor ? '0.0.0.0' : '127.0.0.1'), () => {
    runner.start();
    const mode = demo ? 'demo' : runner.status().activeAllowed ? 'sturing toegestaan' : 'regels standaard uit';
    console.log(`Gridnest beschikbaar op poort 8080 (${mode}).`);
  });
  server.once('close', () => runner.stop());
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { runner.stop(); server.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer().catch(error => { console.error('Gridnest starten mislukt:', error); process.exitCode = 1; });
}