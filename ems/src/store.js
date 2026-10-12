import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { emptyMappings, mappingsSchema } from './home-assistant.js';
import { defaultRules, rulesSchema } from './rules.js';

export const heatingProfiles = [
  { id: 'unspecified', name: 'Nog niet gekozen', advice: 'Reactiesnelheid hangt af van afgiftesysteem, isolatie en warmtebron. Zonder profiel is geen passende verwarmingsstrategie bepaald.' },
  { id: 'underfloor', name: 'Vloerverwarming', advice: 'Vloerverwarming in een zware vloer reageert traag. Een stabiele temperatuur en beperkte nachtverlaging passen daar vaak beter bij. Laat de thermostaat regelen; dit betekent niet dat pomp of warmtebron continu moet draaien.' },
  { id: 'airco', name: 'Airco / lucht-luchtwarmtepomp', advice: 'Kan de bediende ruimte vaak snel verwarmen, bijvoorbeeld rond aanwezigheid. Capaciteit en rendement hangen af van buitentemperatuur en installatie. Een airco verwarmt niet automatisch alle kamers.' },
  { id: 'radiators', name: 'Radiatoren / convectoren', advice: 'Reageren meestal sneller dan een zware vloer. Verwarmen rond aanwezigheid kan passen. Aanvoertemperatuur, isolatie en warmtebron bepalen de beste verlaging en opwarmtijd.' }
];

export const preferencesSchema = z.object({
  presenceEntities: z.array(z.string().regex(/^(person|device_tracker|binary_sensor)\.[a-z0-9_]+$/)).max(20).default([]).refine(ids => new Set(ids).size === ids.length, { message: 'Selecteer elke persoon of aanwezigheidssensor maar een keer.' }),
  presenceMode: z.enum(['any', 'all']).default('any'),
  showGas: z.boolean().default(false), showWater: z.boolean().default(false),
  refreshSeconds: z.number().int().refine(value => [0, 5, 10, 30, 60].includes(value), { message: 'Kies een geldig verversingsinterval.' }).default(10),
  heatingProfile: z.enum(heatingProfiles.map(profile => profile.id)).default('unspecified'),
  comfortC: z.number().min(16).max(24), awayC: z.number().min(12).max(24),
  occupiedFrom: z.number().int().min(0).max(23), occupiedUntil: z.number().int().min(1).max(24),
  gridLimitKw: z.number().min(1).max(25), evEnergyKwh: z.number().min(0).max(100),
  deadlineHours: z.number().int().min(1).max(24), preferSolar: z.boolean()
}).strict().refine(value => value.awayC <= value.comfortC, { message: 'Afwezigtemperatuur mag niet hoger zijn dan comfort.' })
  .refine(value => value.occupiedFrom < value.occupiedUntil, { message: 'Aanwezig vanaf moet eerder zijn dan aanwezig tot.' });

export const defaultPreferences = {
  presenceEntities: [], presenceMode: 'any', showGas: false, showWater: false,
  refreshSeconds: 10,
  heatingProfile: 'unspecified',
  comfortC: 20, awayC: 17, occupiedFrom: 7, occupiedUntil: 23,
  gridLimitKw: 8, evEnergyKwh: 18, deadlineHours: 14, preferSolar: true
};

const itemIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const entityIdSchema = z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/).nullable();
const solarSchema = z.object({
  enabled: z.boolean().default(false), powerEntity: entityIdSchema.default(null),
  boostC: z.number().min(0.5).max(2).default(1),
  startW: z.number().min(200).max(10000).default(1500),
  stopW: z.number().min(0).max(9900).default(500),
  delayMinutes: z.number().int().min(1).max(60).default(5),
  fromHour: z.number().int().min(0).max(23).default(9),
  untilHour: z.number().int().min(1).max(24).default(17)
}).strict().refine(value => value.stopW < value.startW && value.fromHour < value.untilHour, { message: 'Gebruik een lagere stopdrempel dan startdrempel en een geldige dagperiode.' });
export const thermalSchema = z.object({
  mode: z.enum(['off', 'preview', 'active']).default('off'),
  sources: z.array(z.object({
    id: itemIdSchema, name: z.string().trim().min(1).max(80),
    entityId: entityIdSchema,
    profile: z.enum(heatingProfiles.map(profile => profile.id)),
    controlEnabled: z.boolean().default(false), confirmed: z.boolean().default(false),
    controlRoomId: itemIdSchema.nullable().default(null),
    priority: z.number().int().min(1).max(100).default(50),
    solar: solarSchema.default({})
  }).strict()).max(40),
  rooms: z.array(z.object({
    id: itemIdSchema, name: z.string().trim().min(1).max(80),
    floor: z.string().trim().min(1).max(80), temperatureEntity: entityIdSchema,
    presenceEntity: entityIdSchema, targetC: z.number().min(12).max(26),
    presenceControl: z.boolean().default(false),
    sourceIds: z.array(itemIdSchema).max(20)
  }).strict()).max(80)
}).strict().superRefine((thermal, context) => {
  const checkUnique = (values, message) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: z.ZodIssueCode.custom, message });
  };
  checkUnique(thermal.sources.map(source => source.id), 'Warmtebronnen hebben dubbele identifiers.');
  checkUnique(thermal.sources.filter(source => source.entityId).map(source => source.entityId), 'Een verwarmingsentiteit mag maar een keer als bron worden vastgelegd.');
  checkUnique(thermal.rooms.map(room => room.id), 'Kamers hebben dubbele identifiers.');
  checkUnique(thermal.rooms.map(room => `${room.floor.toLocaleLowerCase('nl-NL')}\u0000${room.name.toLocaleLowerCase('nl-NL')}`), 'Een kamernaam moet uniek zijn binnen de verdieping.');
  for (const room of thermal.rooms) {
    checkUnique(room.sourceIds, 'Een warmtebron mag maar een keer aan een kamer worden gekoppeld.');
    if (room.sourceIds.some(id => !thermal.sources.some(source => source.id === id))) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Een kamer verwijst naar een ontbrekende warmtebron.' });
  }
  for (const source of thermal.sources) {
    if (source.solar.enabled && source.profile !== 'airco') context.addIssue({ code: z.ZodIssueCode.custom, message: 'Zonnevoorverwarming is in deze versie uitsluitend voor airco-profielen.' });
    if (source.controlRoomId && !thermal.rooms.some(room => room.id === source.controlRoomId && room.sourceIds.includes(source.id))) context.addIssue({ code: z.ZodIssueCode.custom, message: 'De regelkamer moet bestaan en aan deze warmtebron gekoppeld zijn.' });
  }
});

const configSchema = z.object({
  version: z.literal(1), source: z.enum(['demo', 'home-assistant']),
  mappings: mappingsSchema, preferences: preferencesSchema,
  control: rulesSchema.default(defaultRules),
  thermal: thermalSchema.default({ sources: [], rooms: [] })
}).strict();

export async function createStore(directory, source) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'settings.json');
  let state;
  try {
    state = configSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Opgeslagen instellingen zijn ongeldig; herstel settings.json voordat je start.', { cause: error });
    state = configSchema.parse({ version: 1, source, mappings: { ...emptyMappings }, preferences: { ...defaultPreferences } });
  }
  if (state.source !== source) state = { ...state, source, mappings: { ...emptyMappings }, thermal: thermalSchema.parse({ sources: [], rooms: [] }), control: structuredClone(defaultRules) };
  let pending = Promise.resolve();
  return {
    get: () => structuredClone(state),
    update(patch) {
      const operation = pending.then(async () => {
        const next = configSchema.parse({ ...state, ...patch });
        await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
        state = next;
        return structuredClone(state);
      });
      pending = operation.catch(() => {});
      return operation;
    }
  };
}