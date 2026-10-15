import { z } from 'zod';

export const roles = [
  { id: 'gridImport', name: 'Netafname', domain: 'sensor', units: ['W', 'kW'], icon: 'plug', description: 'Actueel vermogen uit het net; niet een cumulatieve kWh-meter.' },
  { id: 'gridExport', name: 'Teruglevering', domain: 'sensor', units: ['W', 'kW'], icon: 'arrow-up-right', description: 'Actueel teruggeleverd vermogen, als positieve waarde.' },
  { id: 'solar', name: 'Zonnepanelen', domain: 'sensor', units: ['W', 'kW'], icon: 'sun', description: 'Actuele productie van de omvormer.' },
  { id: 'solarToday', name: 'Zonneopbrengst vandaag', domain: 'sensor', units: ['Wh', 'kWh'], icon: 'sun', description: 'Dagmeter of cumulatieve totaalmeter; kies de juiste bron voor het dagverschil.' },
  { id: 'solarExpectedNow', name: 'Zonneverwachting nu', domain: 'sensor', units: ['W', 'kW'], icon: 'sun', description: 'Verwacht zonnevermogen op dit moment uit je forecast-integratie.' },
  { id: 'solarExpectedToday', name: 'Zonneverwachting vandaag', domain: 'sensor', units: ['kWh'], icon: 'sun', description: 'Verwachte zonneopbrengst voor vandaag uit je forecast-integratie.' },
  { id: 'temperature', name: 'Kamertemperatuur', domain: 'sensor', units: ['°C'], icon: 'thermometer', description: 'De temperatuur in de belangrijkste verblijfsruimte.' },
  { id: 'climate', name: 'Verwarming', domain: 'climate', units: [], icon: 'heater', description: 'Thermostaat of warmtepomp. In deze versie alleen uitlezen.' },
  { id: 'evPower', name: 'Laadpaal', domain: 'sensor', units: ['W', 'kW'], icon: 'car', description: 'Actueel laadvermogen; geen start- of stopopdracht.' },
  { id: 'evSoc', name: 'Auto · Accupercentage', domain: 'sensor', units: ['%'], icon: 'battery-charging', description: 'Laadtoestand van de auto uit de auto-integratie; geen percentage van de thuisbatterij.' },
  { id: 'evEnergyTotal', name: 'Laadpaal · Energiemeter', domain: 'sensor', units: ['Wh', 'kWh'], icon: 'activity', description: 'Cumulatieve laadenergie met Home Assistant-statistieken voor het dagtotaal; geen sessiemeter.' },
  { id: 'evEnable', name: 'Laadpaal · Laden toestaan', domain: 'switch', units: [], icon: 'car', description: 'Schakelaar om laden te starten of te stoppen.' },
  { id: 'evCurrentLimit', name: 'Laadpaal · Stroomlimiet', domain: 'number', units: ['A'], icon: 'activity', description: 'Instelbare laadstroomlimiet in ampere.' },
  { id: 'evCableStatus', name: 'Laadpaal · Kabelstatus', domain: 'binary_sensor', units: [], icon: 'plug', description: 'Status van de laadkabel.' },
  { id: 'evLockStatus', name: 'Laadpaal · Vergrendeling', domain: 'lock', units: [], icon: 'lock', description: 'Vergrendelstatus van de laadkabel.' },
  { id: 'evSessionEnergy', name: 'Laadpaal · Sessieverbruik', domain: 'sensor', units: ['Wh', 'kWh'], icon: 'activity', description: 'Energie geleverd tijdens de huidige laadsessie.' },
  { id: 'evPhase1Current', name: 'Laadstroom L1', domain: 'sensor', units: ['A'], icon: 'activity', description: 'Laadstroom van de laadpaal op fase L1.' },
  { id: 'evPhase2Current', name: 'Laadstroom L2', domain: 'sensor', units: ['A'], icon: 'activity', description: 'Laadstroom van de laadpaal op fase L2.' },
  { id: 'evPhase3Current', name: 'Laadstroom L3', domain: 'sensor', units: ['A'], icon: 'activity', description: 'Laadstroom van de laadpaal op fase L3.' },
  { id: 'batterySoc', name: 'Hoofdbatterij · Laadtoestand', domain: 'sensor', units: ['%'], icon: 'battery-charging', description: 'Laadtoestand van de primaire thuisbatterij.' },
  { id: 'batteryChargingState', name: 'Hoofdbatterij · Laadstatus', domain: 'sensor', units: [], icon: 'activity', description: 'Laden, ontladen of doorvoer.' },
  { id: 'batteryMinLevel', name: 'Hoofdbatterij · Minimum niveau', domain: 'number', units: ['%'], icon: 'battery', description: 'Instelbare minimumgrens.' },
  { id: 'batteryMaxLevel', name: 'Hoofdbatterij · Maximum niveau', domain: 'number', units: ['%'], icon: 'battery', description: 'Instelbare maximumgrens.' },
  { id: 'batteryHealth', name: 'Hoofdbatterij · Batterijgezondheid', domain: 'sensor', units: ['%'], icon: 'activity', description: 'Gemeten gezondheid van de hoofdbatterij, als de integratie deze aanbiedt.' },
  { id: 'batteryEnable', name: 'Hoofdbatterij · Activeren', domain: 'switch', units: [], icon: 'battery-charging', description: 'Optionele schakelaar om de hoofdbatterij te activeren.' },
  { id: 'batteryInputPower', name: 'Hoofdbatterij · Input', domain: 'sensor', units: ['W', 'kW'], icon: 'arrow-down-left', description: 'Actueel opgenomen vermogen van de hoofdbatterij.' },
  { id: 'batteryOutputPower', name: 'Hoofdbatterij · Output', domain: 'sensor', units: ['W', 'kW'], icon: 'arrow-up-right', description: 'Actueel afgegeven vermogen van de hoofdbatterij.' },
  { id: 'batteryRemainingTime', name: 'Hoofdbatterij · Resterende tijd', domain: 'sensor', units: ['h', 'min', 's'], icon: 'clock-3', description: 'Geschatte resterende bedrijfstijd van de hoofdbatterij.' },
  { id: 'solarLimit', name: 'Omvormer · Productielimiet', domain: 'number', units: ['%'], icon: 'sun', description: 'Optionele begrenzing van de omvormer in procenten.' },
  { id: 'phase1Current', name: 'Stroomsterkte L1', domain: 'sensor', units: ['A'], icon: 'activity', description: 'Actuele stroomsterkte op fase L1.' },
  { id: 'phase1Voltage', name: 'Spanning L1', domain: 'sensor', units: ['V'], icon: 'activity', description: 'Actuele spanning op fase L1.' },
  { id: 'phase1Power', name: 'Vermogen L1', domain: 'sensor', units: ['W', 'kW'], icon: 'activity', description: 'Werkelijk gemeten vermogen op fase L1.' },
  { id: 'phase2Current', name: 'Stroomsterkte L2', domain: 'sensor', units: ['A'], icon: 'activity', description: 'Actuele stroomsterkte op fase L2.' },
  { id: 'phase2Voltage', name: 'Spanning L2', domain: 'sensor', units: ['V'], icon: 'activity', description: 'Actuele spanning op fase L2.' },
  { id: 'phase2Power', name: 'Vermogen L2', domain: 'sensor', units: ['W', 'kW'], icon: 'activity', description: 'Werkelijk gemeten vermogen op fase L2.' },
  { id: 'phase3Current', name: 'Stroomsterkte L3', domain: 'sensor', units: ['A'], icon: 'activity', description: 'Actuele stroomsterkte op fase L3.' },
  { id: 'phase3Voltage', name: 'Spanning L3', domain: 'sensor', units: ['V'], icon: 'activity', description: 'Actuele spanning op fase L3.' },
  { id: 'phase3Power', name: 'Vermogen L3', domain: 'sensor', units: ['W', 'kW'], icon: 'activity', description: 'Werkelijk gemeten vermogen op fase L3.' },
  { id: 'electricityConsumption', name: 'Stroom · Totale netafname', domain: 'sensor', units: ['kWh'], icon: 'activity', description: 'Verouderde cumulatieve netafnamemeter; wordt gebruikt als geen laag/hoog-verbruiksmeter is gekoppeld.', hidden: true },
  { id: 'electricityReturn', name: 'Stroom · Totale teruglevering', domain: 'sensor', units: ['kWh'], icon: 'arrow-up-right', description: 'Verouderde cumulatieve teruglevermeter; wordt gebruikt als geen laag/hoog-teruglevermeter is gekoppeld.', hidden: true },
  { id: 'electricityLow', name: 'Verbruik · Laag tarief', domain: 'sensor', units: ['kWh'], icon: 'activity', description: 'Cumulatieve kWh-meter voor stroomverbruik tijdens het lage tarief.' },
  { id: 'electricityHigh', name: 'Verbruik · Hoog tarief', domain: 'sensor', units: ['kWh'], icon: 'activity', description: 'Cumulatieve kWh-meter voor stroomverbruik tijdens het hoge tarief.' },
  { id: 'electricityReturnLow', name: 'Teruglevering · Laag tarief', domain: 'sensor', units: ['kWh'], icon: 'arrow-up-right', description: 'Cumulatieve kWh-meter voor teruglevering tijdens het lage tarief.' },
  { id: 'electricityReturnHigh', name: 'Teruglevering · Hoog tarief', domain: 'sensor', units: ['kWh'], icon: 'arrow-up-right', description: 'Cumulatieve kWh-meter voor teruglevering tijdens het hoge tarief.' },
  { id: 'gasConsumption', name: 'Gasverbruik', domain: 'sensor', units: ['m³', 'm3'], icon: 'flame', description: 'Cumulatieve gasmeterstand in kubieke meters.' },
  { id: 'waterConsumption', name: 'Waterverbruik', domain: 'sensor', units: ['m³', 'm3'], icon: 'droplet', description: 'Cumulatieve watermeterstand in kubieke meters.' },
  { id: 'gridPower', name: 'Netvermogen (positief / negatief)', domain: 'sensor', units: ['W', 'kW'], icon: 'plug', description: 'Een getekende netsensor voor afname en teruglevering; stel de tekenrichting in.' },
  { id: 'totalConsumption', name: 'Totaal woningverbruik', domain: 'sensor', units: ['W', 'kW'], icon: 'house-plug', description: 'Actueel totaal elektrisch woningverbruik inclusief eigen zonnestroom; netafname alleen is geen woningverbruik.' },
  { id: 'knownConsumption', name: 'Bekend verbruik (totaalsensor)', domain: 'sensor', units: ['W', 'kW'], icon: 'activity', description: 'Een bestaande som van bekende apparaten, als alternatief voor losse apparaatmetingen.' },
  { id: 'batteryPower', name: 'Batterijvermogen (positief / negatief)', domain: 'sensor', units: ['W', 'kW'], icon: 'battery-charging', description: 'Vermogen aan de woningzijde van de batterij; stel de tekenrichting in.' },
  { id: 'presence', name: 'Aanwezigheid', domain: 'binary_sensor', units: [], deviceClasses: ['occupancy', 'presence'], icon: 'house', description: 'Een aanwezigheidssensor; niet een willekeurige aan/uit-sensor.' }
];

const stateSchema = z.object({
  entity_id: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/), state: z.string(),
  attributes: z.record(z.unknown()), last_updated: z.string().datetime({ offset: true })
  , last_reported: z.string().datetime({ offset: true }).optional(), last_changed: z.string().datetime({ offset: true }).optional()
});

export function normalizeStates(states) {
  return z.array(stateSchema).parse(states).filter(state => ['sensor', 'binary_sensor', 'climate', 'number', 'switch', 'lock', 'person', 'device_tracker'].includes(state.entity_id.split('.')[0])).map(state => ({
    id: state.entity_id, name: typeof state.attributes.friendly_name === 'string' ? state.attributes.friendly_name : state.entity_id,
    domain: state.entity_id.split('.')[0], state: state.state,
    unit: typeof state.attributes.unit_of_measurement === 'string' ? state.attributes.unit_of_measurement : '',
    deviceClass: typeof state.attributes.device_class === 'string' ? state.attributes.device_class : '',
    stateClass: typeof state.attributes.state_class === 'string' ? state.attributes.state_class : '',
    updatedAt: state.last_updated,
    reportedAt: state.last_reported ?? state.last_updated, changedAt: state.last_changed ?? state.last_updated,
    minimum: typeof state.attributes.min === 'number' ? state.attributes.min : null,
    maximum: typeof state.attributes.max === 'number' ? state.attributes.max : null,
    step: typeof state.attributes.step === 'number' ? state.attributes.step : null,
    hvacModes: Array.isArray(state.attributes.hvac_modes) ? state.attributes.hvac_modes.filter(mode => ['heat', 'off', 'auto', 'cool', 'heat_cool'].includes(mode)) : [],
    supportedFeatures: Number.isInteger(state.attributes.supported_features) ? state.attributes.supported_features : 0,
    minTempC: typeof state.attributes.min_temp === 'number' ? state.attributes.min_temp : null,
    maxTempC: typeof state.attributes.max_temp === 'number' ? state.attributes.max_temp : null,
    targetStepC: typeof state.attributes.target_temp_step === 'number' ? state.attributes.target_temp_step : null,
    available: !['unavailable', 'unknown'].includes(state.state),
    hvacAction: ['heating', 'cooling', 'idle', 'off', 'defrosting', 'drying', 'fan'].includes(state.attributes.hvac_action) ? state.attributes.hvac_action : null,
    targetTemperature: typeof state.attributes.temperature === 'number' ? state.attributes.temperature : null,
    currentTemperature: typeof state.attributes.current_temperature === 'number' ? state.attributes.current_temperature : null
  }));
}

export function compatible(role, entity) {
  if (role.id === 'evCableStatus') {
    return ['binary_sensor', 'switch', 'sensor'].includes(entity.domain);
  }
  if (role.id === 'evLockStatus') {
    return ['lock', 'switch', 'binary_sensor'].includes(entity.domain);
  }
  return role.domain === entity.domain && (!role.units.length || role.units.includes(entity.unit)) &&
    (!role.deviceClasses || role.deviceClasses.includes(entity.deviceClass));
}

const entityIdSchema = z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/);
const optionalEntityId = z.union([entityIdSchema, z.literal('')]).nullable().transform(val => val || null);

export const batteryItemSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  socEntity: optionalEntityId.default(null),
  powerEntity: optionalEntityId.default(null),
  inputEntity: optionalEntityId.default(null),
  outputEntity: optionalEntityId.default(null),
  remainingEntity: optionalEntityId.default(null),
  healthEntity: optionalEntityId.default(null),
  switchEntity: optionalEntityId.default(null),
  chargingStateEntity: optionalEntityId.default(null),
  minLevelEntity: optionalEntityId.default(null),
  maxLevelEntity: optionalEntityId.default(null),
  showOnOverview: z.boolean().default(true)
}).strict();

export const mappingsSchema = z.object({
  ...Object.fromEntries(roles.map(role => [role.id, entityIdSchema.nullable().default(null)])),
  gridMode: z.enum(['separate', 'signed']).default('separate'),
  gridDirection: z.enum(['positive-import', 'positive-export']).default('positive-import'),
  batteryMode: z.enum(['unknown', 'none', 'measured']).default('unknown'),
  batteryDirection: z.enum(['positive-charge', 'positive-discharge']).default('positive-charge'),
  evMode: z.enum(['unknown', 'none', 'present']).default('unknown'),
  solarTodayMode: z.enum(['daily', 'total']).default('daily'),
  knownSource: z.enum(['individual', 'aggregate']).default('individual'),
  knownConsumers: z.array(entityIdSchema).max(50).default([]).refine(ids => new Set(ids).size === ids.length, { message: 'Een verbruiker mag maar een keer worden geselecteerd.' }),
  knownConsumerNames: z.record(entityIdSchema, z.string().trim().max(80)).default({}),
  knownConsumerSwitches: z.record(entityIdSchema, z.string().regex(/^switch\.[a-z0-9_]+$/)).default({}),
  batteries: z.array(batteryItemSchema).max(4).default([])
}).strict();
export const emptyMappings = mappingsSchema.parse({});

export function validateMappings(input, entities) {
  const mappings = mappingsSchema.parse(input);
  for (const role of roles) {
    const id = mappings[role.id];
    if (!id) continue;
    const entity = entities.find(item => item.id === id);
    if (!entity || !compatible(role, entity)) throw new Error(`Geen passende entiteit voor ${role.name}.`);
    if (role.id === 'solarToday' && mappings.solarTodayMode === 'total' && !['total', 'total_increasing'].includes(entity.stateClass)) throw new Error('Zonneopbrengst uit een totaalmeter vereist een cumulatieve energie-entiteit.');
    if (['gasConsumption', 'waterConsumption', 'evEnergyTotal', 'electricityConsumption', 'electricityReturn', 'electricityLow', 'electricityHigh', 'electricityReturnLow', 'electricityReturnHigh'].includes(role.id) && !['total', 'total_increasing'].includes(entity.stateClass)) throw new Error(`${role.name} vereist een cumulatieve meterstand.`);
  }
  if (mappings.gridImport && mappings.gridImport === mappings.gridExport) throw new Error('Netafname en teruglevering moeten afzonderlijke sensoren zijn.');
  if (mappings.totalConsumption && mappings.totalConsumption === mappings.knownConsumption) throw new Error('Woningverbruik en bekend verbruik moeten afzonderlijke metingen zijn.');
  const electricityMeters = [mappings.electricityConsumption, mappings.electricityReturn, mappings.electricityLow, mappings.electricityHigh,
    mappings.electricityReturnLow, mappings.electricityReturnHigh].filter(Boolean);
  if (new Set(electricityMeters).size !== electricityMeters.length) throw new Error('Verbruiks- en teruglevermeters moeten afzonderlijke kWh-meters zijn.');
  for (const id of mappings.knownConsumers) {
    const entity = entities.find(item => item.id === id);
    if (!entity || !compatible(roles[0], entity)) throw new Error('Een bekende verbruiker moet een vermogenssensor in W of kW zijn.');
    if ([mappings.totalConsumption, mappings.knownConsumption, mappings.gridPower, mappings.gridImport, mappings.gridExport, mappings.solar, mappings.batteryPower].includes(id)) {
      throw new Error('Selecteer apparaatmetingen, geen woning-, net-, batterij- of productiemeter als bekende verbruiker.');
    }
  }
  const switches = Object.entries(mappings.knownConsumerSwitches);
  if (new Set(switches.map(([, id]) => id)).size !== switches.length) throw new Error('Koppel elke verbruikerschakelaar aan slechts een verbruiker.');
  for (const [consumerId, switchId] of switches) {
    if (!mappings.knownConsumers.includes(consumerId) || entities.find(entity => entity.id === switchId)?.domain !== 'switch') throw new Error('Een verbruikerschakelaar vereist een geselecteerde verbruiker en een bestaande switch-entiteit.');
  }
  for (const b of mappings.batteries) {
    for (const [key, domain, unit] of [['chargingStateEntity', 'sensor', null], ['minLevelEntity', 'number', '%'], ['maxLevelEntity', 'number', '%']]) {
      if (!b[key]) continue;
      const entity = entities.find(item => item.id === b[key]);
      if (!entity || entity.domain !== domain || unit && entity.unit !== unit) throw new Error(`Ongeldige ${key} voor ${b.name}.`);
    }
    if (b.socEntity) {
      const entity = entities.find(item => item.id === b.socEntity);
      if (!entity || entity.domain !== 'sensor' || entity.unit !== '%') throw new Error(`Laadtoestandsensor voor ${b.name} moet een percentage-sensor zijn.`);
    }
    if (b.powerEntity) {
      const entity = entities.find(item => item.id === b.powerEntity);
      if (!entity || entity.domain !== 'sensor' || !['W', 'kW'].includes(entity.unit)) throw new Error(`Vermogenssensor voor ${b.name} moet in W of kW zijn.`);
    }
    if (b.switchEntity) {
      const entity = entities.find(item => item.id === b.switchEntity);
      if (!entity || entity.domain !== 'switch') throw new Error(`Schakelaar voor ${b.name} moet een switch-entiteit zijn.`);
    }
  }
  return mappings;
}

export async function readEntities(env = process.env, request = fetch) {
  const supervisor = Boolean(env.SUPERVISOR_TOKEN);
  const token = supervisor ? env.SUPERVISOR_TOKEN : env.HA_TOKEN;
  if (!token) return { connected: false, entities: [], message: 'Nog niet verbonden met Home Assistant.' };
  const base = supervisor ? 'http://supervisor/core/api' : env.HA_URL;
  if (!base) throw new Error('HA_URL ontbreekt.');
  const url = new URL(`${base.replace(/\/$/, '')}/states`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ongeldig Home Assistant-adres.');
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Home Assistant niet bereikbaar (HTTP ${response.status}).`);
  return { connected: true, entities: normalizeStates(await response.json()), message: 'Verbonden met Home Assistant.' };
}

export function readings(mappings, entities) {
  return roles.map(role => {
    const entity = entities.find(item => item.id === mappings[role.id]);
    const numeric = entity && entity.domain === 'sensor' && role.id !== 'batteryChargingState';
    const validNumber = !numeric || (entity.state.trim() !== '' && Number.isFinite(Number(entity.state)));
    const valid = Boolean(entity?.available && compatible(role, entity) && validNumber);
    return { role: role.id, name: role.name, entityId: mappings[role.id], valid,
      value: valid ? entity.state : null, unit: entity?.unit ?? '', updatedAt: entity?.updatedAt ?? null,
      targetTemperature: entity?.targetTemperature ?? null };
  });
}

export async function readTemperatureUnit(env = process.env, request = fetch) {
  const token = env.SUPERVISOR_TOKEN || env.HA_TOKEN;
  const base = env.SUPERVISOR_TOKEN ? 'http://supervisor/core/api' : env.HA_URL;
  if (!token || !base) return null;
  const url = new URL(`${base.replace(/\/$/, '')}/config`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Ongeldig Home Assistant-adres.');
  const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Home Assistant-eenheid niet bevestigd.');
  return (await response.json()).unit_system?.temperature ?? null;
}

export async function executeRuleCommand(command, env = process.env, request = fetch) {
  if (!env.SUPERVISOR_TOKEN || env.CONTROL_ENABLED !== 'true') throw new Error('Live sturing is niet vrijgegeven.');
  const allowed = {
    'climate.set_temperature': ['climate', 'temperature'], 'climate.set_hvac_mode': ['climate', 'hvac_mode'],
    'number.set_value': ['number', 'value'], 'switch.turn_on': ['switch', null], 'switch.turn_off': ['switch', null],
    'lock.lock': ['lock', null], 'lock.unlock': ['lock', null]
  };
  const action = allowed[command.service];
  if (!action || !new RegExp(`^${action[0]}\\.[a-z0-9_]+$`).test(command.entityId)) throw new Error('Opdracht niet toegestaan.');
  if (action[1] === 'temperature' && (typeof command.value !== 'number' || !Number.isFinite(command.value) || command.value < 12 || command.value > 26)) throw new Error('Temperatuur buiten grenzen.');
  if (action[1] === 'hvac_mode' && !['heat', 'off'].includes(command.value)) throw new Error('Modus niet toegestaan.');
  if (action[1] === 'value' && (typeof command.value !== 'number' || !Number.isFinite(command.value) || Math.abs(command.value) > 10000)) throw new Error('Waarde buiten grenzen.');
  const data = { entity_id: command.entityId };
  if (action[1]) data[action[1]] = command.value;
  const response = await request(`http://supervisor/core/api/services/${command.service.replace('.', '/')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Home Assistant-opdracht niet bevestigd.');

  if (command.notification?.enabled && command.notification.message) {
    try {
      const notifBody = {
        title: command.notification.title || 'Gridnest melding',
        message: command.notification.message,
        notification_id: `gridnest_${command.entityId.replace(/[^a-zA-Z0-9_]/g, '_')}`
      };
      await request('http://supervisor/core/api/services/persistent_notification/create', {
        method: 'POST', headers: { Authorization: `Bearer ${env.SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(notifBody), redirect: 'error', signal: AbortSignal.timeout(5000)
      });
    } catch {}
  }
}