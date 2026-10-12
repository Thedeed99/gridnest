import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { executeRuleCommand, readEntities, readTemperatureUnit, readings, roles, validateMappings } from './home-assistant.js';
import { createStore, heatingProfiles, preferencesSchema } from './store.js';
import { energySummary } from './energy.js';
import { demoEntities } from './demo.js';
import { householdPresence, thermalReadings, validatePresencePreferences, validateThermal } from './thermal.js';
import { actionTypes, validateRules } from './rules.js';
import { createRuleRunner } from './rule-runner.js';

export function createApp({ store, entitiesProvider, demo = false, supervisor = false, runner = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'");
    if (supervisor && request.socket.remoteAddress !== '172.30.32.2' && request.socket.remoteAddress !== '::ffff:172.30.32.2') {
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
    const previous = store.get();
    const changed = ['presenceEntities', 'presenceMode', 'awayC'].some(key => JSON.stringify(preferences[key]) !== JSON.stringify(previous.preferences[key]));
    const thermal = changed && previous.thermal.mode === 'active' && previous.thermal.rooms.some(room => room.presenceControl) ? { ...previous.thermal, mode: 'preview' } : previous.thermal;
    await store.update({ preferences, thermal });
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
    if (thermal.mode === 'active' && (demo || !supervisor || !runner?.status().activeAllowed || request.get('X-Gridnest-Confirm-Control') !== 'true')) return response.status(403).json({ error: 'Actieve Warmte vereist appvrijgave en expliciete bevestiging.' });
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
    if (control.mode === 'active' && (demo || !supervisor || !runner?.status().activeAllowed || !body.confirmActive)) {
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
  if (store.get().control.mode === 'active') await store.update({ control: { ...store.get().control, mode: 'preview' } });
  if (store.get().thermal.mode === 'active') await store.update({ thermal: { ...store.get().thermal, mode: 'preview' } });
  const entitiesProvider = demo ? async () => ({ connected: false, entities: demoEntities(), message: 'Voorbeeldwoning · geen echte verbinding' }) : () => readEntities(env);
  const runner = createRuleRunner({ store, provider: entitiesProvider, demo,
    unitProvider: demo ? async () => '°C' : () => readTemperatureUnit(env),
    activeAllowed: supervisor && controlEnv.CONTROL_ENABLED === 'true' && !demo,
    execute: command => executeRuleCommand(command, controlEnv) });
  const app = createApp({ store, demo, supervisor, entitiesProvider, runner });
  const server = app.listen(8080, env.HOST || (supervisor ? '0.0.0.0' : '127.0.0.1'), () => {
    runner.start();
    console.log(`Gridnest beschikbaar op poort 8080 (${demo ? 'demo' : 'regels standaard uit'}).`);
  });
  server.once('close', () => runner.stop());
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { runner.stop(); server.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer().catch(error => { console.error('Gridnest starten mislukt:', error); process.exitCode = 1; });
}