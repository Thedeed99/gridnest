import { z } from 'zod';

export const actionTypes = [
  { id: 'climate_temperature', name: 'Verwarming: temperatuurdoel', domain: 'climate', unit: '°C', initial: 21, fallback: 17 },
  { id: 'climate_mode', name: 'Verwarming: verwarmmodus', domain: 'climate', unit: '', initial: 'heat', fallback: 'off' },
  { id: 'ev_enable', name: 'Laadpaal: laden toestaan', domain: 'switch', unit: '', initial: 'on', fallback: 'off' },
  { id: 'ev_current', name: 'Laadpaal: stroomlimiet', domain: 'number', unit: 'A', initial: 6, fallback: 6 },
  { id: 'battery_power', name: 'Thuisbatterij: vermogensdoel', domain: 'number', unit: 'W', initial: 500, fallback: 0 },
  { id: 'pv_limit', name: 'Zonnepanelen: productielimiet', domain: 'number', unit: '%', initial: 70, fallback: 100 }
];

const entityId = z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/);
const actionValue = z.union([z.number().finite(), z.enum(['on', 'off', 'heat'])]);
export const rulesSchema = z.object({
  mode: z.enum(['off', 'preview', 'active']).default('off'),
  maxAgeSeconds: z.number().int().min(60).max(7200).default(900),
  minIntervalSeconds: z.number().int().min(30).max(3600).default(300),
  manualHoldMinutes: z.number().int().min(5).max(1440).default(60),
  reserveSoc: z.number().min(10).max(90).default(20),
  maxSoc: z.number().min(20).max(100).default(95),
  rules: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), name: z.string().trim().min(1).max(80),
    priority: z.number().int().min(1).max(100).default(50),
    enabled: z.boolean().default(false), confirmed: z.boolean().default(false),
    conditions: z.array(z.object({ entityId, operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']), value: z.union([z.number().finite(), z.enum(['on', 'off'])]) }).strict()).min(1).max(5),
    action: z.object({ type: z.enum(actionTypes.map(type => type.id)), entityId, value: actionValue, otherwise: actionValue, batteryDirection: z.enum(['positive-charge', 'positive-discharge']).default('positive-charge') }).strict()
  }).strict()).max(40).default([])
}).strict().superRefine((settings, context) => {
  if (settings.reserveSoc >= settings.maxSoc) context.addIssue({ code: 'custom', message: 'Accureserve moet onder de maximale laadtoestand liggen.' });
  if (new Set(settings.rules.map(rule => rule.id)).size !== settings.rules.length) context.addIssue({ code: 'custom', message: 'Regels moeten unieke identifiers hebben.' });
  const bindings = settings.rules.filter(rule => rule.enabled).map(rule => `${rule.action.entityId}:${rule.action.type === 'climate_mode' ? 'mode' : 'value'}`);
  if (new Set(bindings).size !== bindings.length) context.addIssue({ code: 'custom', message: 'Gebruik een regel per bedieningswaarde om tegenstrijdige opdrachten te voorkomen.' });
  for (const rule of settings.rules) {
    for (const value of [rule.action.value, rule.action.otherwise]) {
      const type = rule.action.type;
      const valid = type === 'ev_enable' ? ['on', 'off'].includes(value) : type === 'climate_mode' ? ['heat', 'off'].includes(value) :
        typeof value === 'number' && (type === 'climate_temperature' ? value >= 12 && value <= 26 : type === 'ev_current' ? value >= 6 && value <= 32 : type === 'pv_limit' ? value >= 0 && value <= 100 : Math.abs(value) <= 10000);
      if (!valid) context.addIssue({ code: 'custom', message: 'Actiewaarde valt buiten de toegestane grenzen.' });
    }
  }
});

export const defaultRules = rulesSchema.parse({});
export const isFresh = (entity, now, maxAge) => {
  const timestamp = Date.parse(entity?.reportedAt ?? entity?.updatedAt);
  return Boolean(entity?.available && Number.isFinite(timestamp) && timestamp <= now + 60000 && now - timestamp <= maxAge * 1000);
};

export function validateRules(input, entities) {
  const settings = rulesSchema.parse(input);
  for (const rule of settings.rules) {
    for (const condition of rule.conditions) {
      const entity = entities.find(entity => entity.id === condition.entityId);
      if (!entity || !['sensor', 'binary_sensor'].includes(entity.domain)) throw new Error('Een voorwaarde moet een bestaande sensor of binary_sensor gebruiken.');
      if (entity.domain === 'binary_sensor' && (condition.operator !== 'eq' || !['on', 'off'].includes(condition.value))) throw new Error('Een binary_sensor vereist gelijk aan on of off.');
      if (entity.domain === 'sensor' && typeof condition.value !== 'number') throw new Error('Een sensorvoorwaarde vereist een getal in de eenheid van die sensor.');
    }
    const actuator = entities.find(entity => entity.id === rule.action.entityId);
    const type = actionTypes.find(type => type.id === rule.action.type);
    if (!actuator || actuator.domain !== type.domain) throw new Error('De actie vereist een passende bedieningsentiteit, niet een meetwaarde.');
  }
  return settings;
}

export function planRules({ settings, entities, mappings, temperatureUnit, now = Date.now() }) {
  return [...settings.rules].sort((first, second) => (first.priority ?? 50) - (second.priority ?? 50)).map(rule => {
    const result = { id: rule.id, name: rule.name, priority: rule.priority ?? 50, status: 'blocked', reason: '', command: null };
    const blocked = reason => ({ ...result, reason });
    if (!rule.enabled) return { ...result, status: 'disabled', reason: 'Regel uitgeschakeld.' };
    if (!rule.confirmed) return blocked('Bevestig de geschiktheid en werking van de bedieningsentiteit.');
    let match = true;
    for (const condition of rule.conditions) {
      const entity = entities.find(entity => entity.id === condition.entityId);
      if (!isFresh(entity, now, settings.maxAgeSeconds)) return blocked('Voorwaardemeting ontbreekt of is niet recent; ook de anders-actie wordt niet uitgevoerd.');
      if (entity.domain === 'binary_sensor') {
        if (!['on', 'off'].includes(entity.state)) return blocked('Ongeldige binaire meetwaarde.');
        match = match && entity.state === condition.value;
      } else {
        if (entity.domain !== 'sensor' || entity.state.trim() === '' || !Number.isFinite(Number(entity.state))) return blocked('Ongeldige numerieke meetwaarde.');
        const value = Number(entity.state);
        const comparisons = { gt: value > condition.value, lt: value < condition.value, gte: value >= condition.value, lte: value <= condition.value, eq: value === condition.value };
        match = match && comparisons[condition.operator];
      }
    }
    const action = rule.action;
    const entity = entities.find(entity => entity.id === action.entityId);
    if (!isFresh(entity, now, settings.maxAgeSeconds) || entity.domain !== actionTypes.find(type => type.id === action.type).domain) return blocked('Bedieningsentiteit ontbreekt of is niet recent.');
    let value = match ? action.value : action.otherwise;
    let service;
    let observed;
    if (action.type === 'climate_temperature') {
      if (temperatureUnit !== '°C' || !(entity.supportedFeatures & 1) || !Number.isFinite(entity.targetStepC) || entity.targetStepC <= 0 || !Number.isFinite(entity.minTempC) || !Number.isFinite(entity.maxTempC) || !['heat', 'off'].includes(entity.state)) return blocked('Celsius, temperatuurbediening, apparaatgrenzen en verwarmmodus/off moeten bevestigd zijn.');
      value = Math.round(value / entity.targetStepC) * entity.targetStepC;
      if (value < Math.max(12, entity.minTempC) || value > Math.min(26, entity.maxTempC)) return blocked('Temperatuurdoel buiten apparaatgrenzen.');
      observed = entity.targetTemperature;
      service = 'climate.set_temperature';
    } else if (action.type === 'climate_mode') {
      if (!entity.hvacModes?.includes(value) || !['heat', 'off'].includes(entity.state)) return blocked('HVAC-modus niet ondersteund of andere modus handmatig actief.');
      observed = entity.state; service = 'climate.set_hvac_mode';
    } else if (action.type === 'ev_enable') {
      if (!['on', 'off'].includes(entity.state)) return blocked('Laadtoestemming heeft geen geldige aan/uit-status.');
      observed = entity.state; service = value === 'on' ? 'switch.turn_on' : 'switch.turn_off';
    } else {
      if (entity.state.trim() === '' || !Number.isFinite(Number(entity.state)) || !Number.isFinite(entity.minimum) || !Number.isFinite(entity.maximum) || !Number.isFinite(entity.step) || entity.step <= 0) return blocked('Actuatorgrenzen of actuele waarde ontbreken.');
      if (action.type === 'ev_current' && entity.unit !== 'A') return blocked('Stroomlimiet moet in ampere zijn.');
      if (action.type === 'pv_limit' && (entity.unit !== '%' || entity.minimum > 0 || entity.maximum < 100)) return blocked('Productielimiet moet 0-100% ondersteunen; 100% is volledige productie.');
      if (action.type === 'battery_power') {
        const soc = entities.find(entity => entity.id === mappings.batterySoc);
        if (!['W', 'kW'].includes(entity.unit) || entity.minimum >= 0 || entity.maximum <= 0 || !isFresh(soc, now, settings.maxAgeSeconds) || soc.unit !== '%' || soc.state.trim() === '' || !Number.isFinite(Number(soc.state)) || Number(soc.state) < 0 || Number(soc.state) > 100) return blocked('Bidirectioneel vermogensdoel en recente laadtoestand vereist.');
        if (value > 0 && Number(soc.state) >= settings.maxSoc || value < 0 && Number(soc.state) <= settings.reserveSoc) value = 0;
        value = value / (entity.unit === 'kW' ? 1000 : 1) * (action.batteryDirection === 'positive-discharge' ? -1 : 1);
      }
      if (value < entity.minimum || value > entity.maximum) return blocked('Actiewaarde buiten apparaatgrenzen.');
      const rounded = entity.minimum + Math.round((value - entity.minimum) / entity.step) * entity.step;
      if (Math.abs(rounded - value) > 0.000001) return blocked('Actiewaarde past niet bij de stapgrootte van het apparaat.');
      observed = Number(entity.state); service = 'number.set_value';
    }
    if (observed === null || observed === undefined || typeof observed === 'number' && !Number.isFinite(observed)) return blocked('Huidige bedieningswaarde ontbreekt.');
    const equal = typeof value === 'number' ? Math.abs(value - observed) < 0.001 : value === observed;
    return { ...result, status: equal ? 'stable' : 'planned', matched: match, observed,
      reason: `${match ? 'Als' : 'Anders'}: ${equal ? 'doelwaarde al ingesteld' : 'doelwaarde aanpassen'}.`,
      command: equal ? null : { entityId: entity.id, service, value } };
  });
}