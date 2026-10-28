import test from 'node:test';
import assert from 'node:assert/strict';
import { thermalSchema } from '../src/store.js';
import { defaultRules } from '../src/rules.js';
import { planThermal, validateThermal } from '../src/thermal.js';
import { solarTarget } from '../src/thermal-solar.js';
import { createRuleRunner } from '../src/rule-runner.js';
import { onlyRoomTargetChanged } from '../web/status.js';

const now = Date.parse('2026-10-12T10:00:00Z');
function fixture() {
  return { now, settings: defaultRules, mappings: {}, temperatureUnit: '°C', thermal: thermalSchema.parse({
    sources: [{ id: 'cv', name: 'CV', entityId: 'climate.cv', profile: 'radiators', controlEnabled: true, confirmed: true, controlRoomId: 'living' }],
    rooms: [{ id: 'living', name: 'Woonkamer', floor: 'Begane grond', temperatureEntity: 'sensor.temperature', presenceEntity: null, targetC: 21, sourceIds: ['cv'] }]
  }), entities: [
    { id: 'sensor.temperature', domain: 'sensor', unit: '°C', available: true, state: '19', reportedAt: new Date(now).toISOString() },
    { id: 'climate.cv', domain: 'climate', available: true, state: 'off', targetTemperature: 20, hvacModes: ['heat', 'off'], supportedFeatures: 1, minTempC: 7, maxTempC: 30, targetStepC: 0.5, reportedAt: new Date(now).toISOString() }
  ] };
}

test('Warmte zet het kamerdoel om in een thermostaatopdracht, ook zonder gebruikersregels', () => {
  const plans = planThermal(fixture());
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].command, { entityId: 'climate.cv', service: 'climate.set_temperature', value: 21 });
});

test('Warmte kan een airco met expliciete halve-graadstap aansturen', () => {
  const input = fixture();
  input.thermal.sources[0].profile = 'airco';
  input.entities[1] = { ...input.entities[1], minTempC: 16, maxTempC: 30, targetStepC: 0.5, supportedFeatures: 953, hvacModes: ['off', 'heat_cool', 'cool', 'dry', 'fan_only', 'heat'], state: 'heat', targetTemperature: 20.5 };
  const plans = planThermal(input);
  assert.deepEqual(plans[0].command, { entityId: 'climate.cv', service: 'climate.set_temperature', value: 21 });
});

test('airco-ventilatorstand is optioneel en wordt alleen naar een ondersteunde stand gestuurd', () => {
  const input = fixture();
  input.thermal.sources[0].profile = 'airco';
  input.thermal.sources[0].fanMode = 'Low';
  input.entities[1] = { ...input.entities[1], state: 'heat', targetTemperature: 21, fanMode: 'Auto', fanModes: ['Auto', 'Low', 'Mid', 'High'], supportedFeatures: 9 };
  const fan = planThermal(input).find(decision => decision.id === 'thermal:cv:fan');
  assert.deepEqual(fan.command, { entityId: 'climate.cv', service: 'climate.set_fan_mode', value: 'Low' });
  input.entities[1].fanMode = 'Low';
  assert.equal(planThermal(input).find(decision => decision.id === 'thermal:cv:fan').status, 'stable');
  input.entities[1].fanModes = ['Auto', 'High'];
  assert.throws(() => validateThermal(input.thermal, input.entities), /ventilatorstand/);
});

test('kamerbediening zet een gekoppelde bron uit en schakelt veilig naar heat voor aan', () => {
  const input = fixture();
  input.thermal.sources[0].profile = 'underfloor';
  input.entities[1] = { ...input.entities[1], state: 'cool', hvacModes: ['off', 'heat', 'cool'] };
  input.thermal.rooms[0].heatingEnabled = false;
  const off = planThermal(input);
  assert.deepEqual(off[0].command, { entityId: 'climate.cv', service: 'climate.set_hvac_mode', value: 'off' });

  input.thermal.rooms[0].heatingEnabled = true;
  const on = planThermal(input);
  assert.deepEqual(on[0].command, { entityId: 'climate.cv', service: 'climate.set_hvac_mode', value: 'heat' });
  assert.equal(thermalSchema.parse({ ...input.thermal, rooms: [{ ...input.thermal.rooms[0], heatingEnabled: undefined }] }).rooms[0].heatingEnabled, true);
});

test('kamer-checkbox schakelt een CV niet uit maar schakelt vloerverwarming wel uit', () => {
  const input = fixture();
  input.entities[1].state = 'heat';
  input.thermal.rooms[0].heatingEnabled = false;
  assert.deepEqual(planThermal(input)[0].command, { entityId: 'climate.cv', service: 'climate.set_temperature', value: 21 });
  input.thermal.sources[0].profile = 'underfloor';
  assert.deepEqual(planThermal(input)[0].command, { entityId: 'climate.cv', service: 'climate.set_hvac_mode', value: 'off' });
});

test('handmatig kamer uit omzeilt minimale opdrachttijd na een moduswijziging', async () => {
  const input = fixture();
  input.thermal.mode = 'active';
  input.thermal.sources[0].profile = 'underfloor';
  input.entities[1].state = 'off';
  input.entities[1].targetTemperature = 21;
  input.entities[1].changedAt = new Date(now - 3600000).toISOString();
  const snapshot = { control: input.settings, thermal: input.thermal, mappings: input.mappings, preferences: {} };
  const sent = [];
  let time = now;
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) },
    provider: async () => ({ connected: true, entities: input.entities.map(entity => ({ ...entity, reportedAt: new Date(time).toISOString() })) }),
    unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => time });
  await runner.tick();
  assert.equal(sent[0].value, 'heat');
  input.entities[1].state = 'heat';
  input.entities[1].changedAt = new Date(time).toISOString();
  input.thermal.rooms[0].heatingEnabled = false;
  time += 30000;
  assert.equal((await runner.tick()).decisions[0].status, 'waiting');
  assert.equal((await runner.tick({ manualAction: true, manualRoomId: 'living' })).decisions[0].status, 'sent');
  assert.equal(sent[1].value, 'off');
});

test('handmatig doel schakelt een uitgeschakelde thermostaat direct in dezelfde cyclus', async () => {
  const input = fixture();
  input.thermal.mode = 'active';
  input.thermal.sources[0].profile = 'underfloor';
  input.settings.minIntervalSeconds = 300;
  input.entities[1].state = 'off';
  input.entities[1].targetTemperature = 20;
  const snapshot = { control: input.settings, thermal: input.thermal, mappings: input.mappings, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) },
    provider: async () => ({ connected: true, entities: input.entities.map(entity => ({ ...entity, reportedAt: new Date(now).toISOString(), changedAt: new Date(now).toISOString() })) }),
    unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => now });

  const result = await runner.tick({ manualAction: true, manualRoomId: 'living' });

  assert.deepEqual(sent, [
    { entityId: 'climate.cv', service: 'climate.set_temperature', value: 21 },
    { entityId: 'climate.cv', service: 'climate.set_hvac_mode', value: 'heat' }
  ]);
  assert.equal(result.decisions.find(item => item.id === 'thermal:cv:temperature').status, 'sent');
  assert.equal(result.decisions.find(item => item.id === 'thermal:cv:mode').status, 'sent');
});

test('handmatig kamerdoel zonder gekoppelde warmtebron stuurt alleen de thermostaattemperatuur', () => {
  const input = fixture();
  input.thermal.sources = [];
  input.thermal.rooms[0].sourceIds = [];
  input.thermal.rooms[0].temperatureEntity = 'climate.cv';
  input.thermal.rooms[0].targetC = 19;
  input.entities[1].targetTemperature = null;
  input.entities[1].targetTemperature = 20;
  const plans = planThermal({ ...input, manualAction: true, manualRoomId: 'living' });

  assert.equal(plans.length, 1);
  assert.equal(plans[0].id, 'thermal:room:living:manual-target');
  assert.deepEqual(plans[0].command, { entityId: 'climate.cv', service: 'climate.set_temperature', value: 19 });
});

test('runner voert een handmatig doel zonder bron alleen naar die climate-entiteit uit', async () => {
  const input = fixture();
  input.thermal.mode = 'active';
  input.thermal.sources = [];
  input.thermal.rooms[0].sourceIds = [];
  input.thermal.rooms[0].temperatureEntity = 'climate.cv';
  input.thermal.rooms[0].targetC = 19;
  input.entities[1].targetTemperature = null;
  input.thermal.sources.push({ id: 'other-source', name: 'Andere CV', entityId: 'climate.other', profile: 'underfloor', controlEnabled: true, confirmed: true, controlRoomId: 'other-room', priority: 2, fanMode: null, solar: { enabled: false, powerEntity: null, boostC: 1, startW: 1500, stopW: 500, delayMinutes: 5, fromHour: 9, untilHour: 17 } });
  input.thermal.rooms.push({ id: 'other-room', name: 'Andere kamer', floor: '1e verdieping', temperatureEntity: 'sensor.other_temperature', presenceEntity: null, targetC: 21, presenceControl: false, heatingEnabled: true, awayC: null, sourceIds: ['other-source'] });
  input.entities.push(
    { id: 'sensor.other_temperature', domain: 'sensor', unit: '°C', available: true, state: '18', reportedAt: new Date(now).toISOString() },
    { id: 'climate.other', domain: 'climate', available: true, state: 'off', targetTemperature: 19, hvacModes: ['heat', 'off'], supportedFeatures: 1, minTempC: 7, maxTempC: 30, targetStepC: 0.5, reportedAt: new Date(now).toISOString() }
  );
  const snapshot = { control: input.settings, thermal: input.thermal, mappings: input.mappings, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }),
    unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => now });
  await runner.tick({ manualAction: true, manualRoomId: 'living' });
  assert.deepEqual(sent, [{ entityId: 'climate.cv', service: 'climate.set_temperature', value: 19 }]);
});

test('automatische stand koelt met de airco en zet een CV zonder koelstand uit', () => {
  const input = fixture();
  input.thermal.sources.push({ id: 'airco', name: 'Airco', entityId: 'climate.airco', profile: 'airco', controlEnabled: true, confirmed: true, controlRoomId: 'living', priority: 2, fanMode: null });
  input.thermal.rooms[0].sourceIds.push('airco');
  input.entities[0].state = '22';
  input.entities[1].state = 'heat';
  input.entities.push({ id: 'climate.airco', domain: 'climate', available: true, state: 'heat', targetTemperature: 20, hvacModes: ['off', 'heat', 'cool'], supportedFeatures: 9, minTempC: 16, maxTempC: 30, targetStepC: 0.5 });
  const plans = planThermal(input);
  assert.deepEqual(plans.find(item => item.id === 'thermal:cv:mode').command, { entityId: 'climate.cv', service: 'climate.set_hvac_mode', value: 'off' });
  assert.deepEqual(plans.find(item => item.id === 'thermal:airco:mode').command, { entityId: 'climate.airco', service: 'climate.set_hvac_mode', value: 'cool' });
});

test('automatische stand verwarmt of koelt buiten een deadband van 0,5 graden', () => {
  const input = fixture();
  input.thermal.sources[0].profile = 'airco';
  input.entities[1] = { ...input.entities[1], state: 'cool', hvacModes: ['off', 'heat', 'cool'], targetTemperature: 21, supportedFeatures: 9 };
  input.entities[0].state = '20.4';
  assert.equal(planThermal(input).find(item => item.id === 'thermal:cv:mode').command.value, 'heat');
  input.entities[0].state = '21.6';
  input.entities[1].state = 'heat';
  assert.equal(planThermal(input).find(item => item.id === 'thermal:cv:mode').command.value, 'cool');
  input.entities[0].state = '21.4';
  input.entities[1].state = 'heat';
  assert.equal(planThermal(input).find(item => item.id === 'thermal:cv:mode').command, null);
});

test('automatische stand blokkeert als een recente kamertemperatuur ontbreekt', () => {
  const input = fixture();
  input.thermal.rooms[0].temperatureEntity = 'sensor.missing';
  const decision = planThermal(input)[0];
  assert.equal(decision.status, 'blocked');
  assert.match(decision.reason, /kamertemperatuur/);
});

test('Warmte stuurt een beschikbare thermostaat aan met een onveranderde oude status', () => {
  const input = fixture();
  input.entities[1].reportedAt = '2026-10-11T00:00:00Z';
  assert.deepEqual(planThermal(input)[0].command, { entityId: 'climate.cv', service: 'climate.set_temperature', value: 21 });
});

test('kamerspecifieke person-aanwezigheid stuurt het kamerdoel naar comfort of afwezig', () => {
  const input = fixture();
  input.thermal.rooms[0].presenceEntity = 'person.resident';
  input.thermal.rooms[0].presenceControl = true;
  input.preferences = { awayC: 17, presenceEntities: [], presenceMode: 'any' };
  input.entities.push({ id: 'person.resident', domain: 'person', available: true, state: 'home', reportedAt: new Date(now).toISOString() });
  assert.doesNotThrow(() => validateThermal(input.thermal, input.entities));
  assert.equal(planThermal(input)[0].command.value, 21);
  input.entities.find(entity => entity.id === 'person.resident').state = 'not_home';
  assert.equal(planThermal(input)[0].command, null);
  input.thermal.rooms[0].awayC = 19;
  assert.equal(planThermal(input)[0].command, null);
});

test('aanwezigheid gebruikt alleen de status en valt bij een onbruikbare kamersensor terug op Mijn wensen', () => {
  const input = fixture();
  input.thermal.rooms[0].presenceControl = true;
  input.thermal.rooms[0].presenceEntity = 'binary_sensor.room_presence';
  input.preferences = { awayC: 16, presenceEntities: ['person.resident'], presenceMode: 'any' };
  input.entities.push(
    { id: 'binary_sensor.room_presence', domain: 'binary_sensor', deviceClass: 'presence', available: false, state: 'unavailable' },
    { id: 'person.resident', domain: 'person', available: true, state: 'not_home', reportedAt: '2026-10-11T00:00:00Z' }
  );
  assert.equal(planThermal(input)[0].command, null);
  input.entities[3].state = 'home';
  assert.equal(planThermal(input)[0].command.value, 21);
});

test('warmte gebruikt de aanwezigheid uit Mijn wensen als de kamer geen eigen sensor heeft', () => {
  const input = fixture();
  input.entities[1].hvacModes = ['heat', 'cool', 'off'];
  input.thermal.rooms[0].presenceControl = true;
  input.preferences = { awayC: 16, presenceEntities: ['person.resident'], presenceMode: 'any' };
  input.entities.push({ id: 'person.resident', domain: 'person', available: true, state: 'not_home', reportedAt: new Date(now).toISOString() });
  assert.equal(planThermal(input)[0].command.value, 16);
  input.thermal.rooms[0].awayC = 18;
  assert.equal(planThermal(input)[0].command.value, 18);
});

test('verwarmmodus volgt pas nadat het juiste temperatuurdoel wordt teruggemeld', () => {
  const input = fixture(); input.entities[1].targetTemperature = 21;
  const plans = planThermal(input);
  assert.equal(plans[0].status, 'stable');
  assert.equal(plans[1].command.service, 'climate.set_hvac_mode');
  assert.equal(plans[1].command.value, 'heat');
});

test('kamer met climate-entiteit als temperatuursensor kan regelen en verwarmmodus inschakelen', () => {
  const input = fixture();
  input.thermal.rooms[0].temperatureEntity = 'climate.badkamer';
  input.thermal.sources[0].entityId = 'climate.badkamer';
  input.entities = [
    {
      id: 'climate.badkamer',
      domain: 'climate',
      available: true,
      state: 'off',
      currentTemperature: 19.4,
      targetTemperature: 20,
      hvacModes: ['heat', 'off'],
      supportedFeatures: 1,
      minTempC: 7,
      maxTempC: 30,
      targetStepC: 0.5,
      reportedAt: new Date(now).toISOString()
    }
  ];
  input.thermal.rooms[0].targetC = 20;
  assert.doesNotThrow(() => validateThermal(input.thermal, input.entities));
  const plans = planThermal(input);
  assert.equal(plans[0].status, 'stable'); // doel 20 is al gelijk aan targetTemperature 20
  assert.equal(plans[1].command.service, 'climate.set_hvac_mode');
  assert.equal(plans[1].command.value, 'heat'); // schakelt kachel in!
});

test('monitor-only en onbevestigde bronnen sturen niet', () => {
  const input = fixture(); input.thermal.sources[0].controlEnabled = false;
  assert.deepEqual(planThermal(input), []);
  input.thermal.sources[0].controlEnabled = true; input.thermal.sources[0].confirmed = false;
  assert.equal(planThermal(input)[0].command, null);
});

test('automatische modus blokkeert Tado-aansturing zonder verse kamertemperatuur', () => {
  const input = fixture();
  input.thermal.rooms[0].temperatureEntity = 'climate.cv';
  input.thermal.rooms[0].targetC = 21;
  input.entities[1].currentTemperature = null;
  input.entities[1].reportedAt = '2026-10-11T00:00:00Z';
  const decision = planThermal(input)[0];
  assert.equal(decision.status, 'blocked');
  assert.match(decision.reason, /recente kamertemperatuur/);

  input.thermal.rooms[0].temperatureEntity = null;
  assert.equal(planThermal(input)[0].status, 'blocked');
});

test('actieve automatische Warmte stuurt niet zonder recente current_temperature naar Home Assistant', async () => {
  const input = fixture();
  input.thermal.mode = 'active';
  input.thermal.rooms[0].temperatureEntity = 'climate.cv';
  input.entities[1].currentTemperature = null;
  input.entities[1].reportedAt = '2026-10-11T00:00:00Z';
  const snapshot = { control: input.settings, thermal: input.thermal, mappings: input.mappings, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) },
    provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C',
    execute: async command => sent.push(command), activeAllowed: true, clock: () => input.now });

  await runner.tick();

  assert.deepEqual(sent, []);
  assert.equal(runner.status().decisions[0].status, 'blocked');
});

test('een bron heeft een gekoppelde regelkamer, bestaande configuraties blijven monitor-only', () => {
  assert.equal(thermalSchema.parse({ sources: [], rooms: [] }).mode, 'off');
  const input = fixture(); input.thermal.sources[0].controlRoomId = 'missing';
  assert.throws(() => thermalSchema.parse(input.thermal));
  assert.equal(planThermal(input)[0].status, 'blocked');
});

function sunnyFixture() {
  const input = fixture();
  input.thermal.sources[0].profile = 'airco';
  input.thermal.sources[0].solar = { ...input.thermal.sources[0].solar, enabled: true, powerEntity: 'sensor.airco' };
  input.mappings = { gridMode: 'signed', gridDirection: 'positive-import', gridPower: 'sensor.net', solar: 'sensor.pv', batteryMode: 'none' };
  for (const [id, state] of [['sensor.net', -2000], ['sensor.pv', 4000], ['sensor.airco', 0]]) input.entities.push({ id, domain: 'sensor', available: true, state: String(state), unit: 'W', reportedAt: new Date(now).toISOString() });
  return { ...input, source: input.thermal.sources[0], baseTarget: 21, maxAge: 900 };
}

test('zonneboost wacht, corrigeert extra aircoverbruik en stopt vertraagd bij echt tekort', () => {
  const input = sunnyFixture();
  let result = solarTarget(input);
  assert.equal(result.targetC, 21);
  input.now += 300000; input.entities.forEach(entity => { entity.reportedAt = new Date(input.now).toISOString(); });
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 22);
  input.entities.find(entity => entity.id === 'sensor.net').state = '-100';
  input.entities.find(entity => entity.id === 'sensor.airco').state = '1800';
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 22);
  assert.equal(result.surplusW, 1900);
  input.entities.find(entity => entity.id === 'sensor.net').state = '2000';
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 22);
  input.now += 300000; input.entities.forEach(entity => { entity.reportedAt = new Date(input.now).toISOString(); });
  result = solarTarget({ ...input, previous: result.next });
  assert.equal(result.targetC, 21);
});

test('nacht, ontbrekende metingen en ontladende batterij geven het gewone comfortdoel', () => {
  const input = sunnyFixture();
  assert.equal(solarTarget({ ...input, now: Date.parse('2026-10-12T22:00:00Z'), previous: { active: true } }).targetC, 21);
  input.entities.find(entity => entity.id === 'sensor.net').available = false;
  assert.equal(solarTarget({ ...input, previous: { active: true } }).active, false);
  input.entities.find(entity => entity.id === 'sensor.net').available = true;
  input.mappings.batteryMode = 'unknown';
  assert.equal(solarTarget(input).active, false);
});

test('extra temperatuur blijft begrensd en een andere airco kan niet tegelijk een boost starten', () => {
  const input = sunnyFixture(); input.entities[1].maxTempC = 21.5;
  input.solarMemory = new Map([['cv', { active: true, basePower: 0 }]]);
  assert.equal(planThermal(input)[0].command.value, 21.5);
  assert.equal(solarTarget({ ...input, allowStart: false }).next.active, false);
  assert.throws(() => thermalSchema.parse({ ...input.thermal, sources: [{ ...input.source, solar: { ...input.source.solar, stopW: 2000, startW: 1000 } }] }));
});

test('Warmte is aangesloten op de uitvoerlaag, onafhankelijk van Stroom', async () => {
  const input = fixture(); input.thermal.mode = 'active';
  input.entities[1].changedAt = new Date(now - 3600000).toISOString();
  const snapshot = { control: defaultRules, thermal: input.thermal, mappings: {}, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async command => { sent.push(command); }, activeAllowed: true, clock: () => now });
  await runner.tick();
  assert.equal(sent[0].service, 'climate.set_temperature');
  assert.equal(sent[0].value, 21);
  assert.equal((await runner.tick()).decisions[0].status, 'waiting');
  input.entities[1].targetTemperature = 21;
  await runner.tick();
  assert.equal(sent[1].service, 'climate.set_hvac_mode');
});

test('handmatige moduswijziging pauzeert Warmte niet', async () => {
  const input = fixture();
  input.thermal.mode = 'active';
  input.entities[1].state = 'heat';
  input.entities[1].targetTemperature = 21;
  input.entities[1].changedAt = new Date(now - 3600000).toISOString();
  const snapshot = { control: defaultRules, thermal: input.thermal, mappings: {}, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async command => { sent.push(command); }, activeAllowed: true, clock: () => now });
  await runner.tick();
  input.entities[1].state = 'off';
  const result = await runner.tick();
  assert.equal(result.decisions.find(decision => decision.id === 'thermal:cv:mode').status, 'sent');
  assert.deepEqual(sent, [{ entityId: 'climate.cv', service: 'climate.set_hvac_mode', value: 'heat' }]);
});

test('alleen kamerdoel wijzigen behoudt regeling en stuurt het nieuwe climate-doel', async () => {
  const input = fixture();
  input.thermal.mode = 'active';
  input.entities[1].state = 'heat';
  input.entities[1].targetTemperature = 21;
  input.entities[1].changedAt = new Date(now - 3600000).toISOString();
  const room = input.thermal.rooms[0];
  assert.equal(onlyRoomTargetChanged(room, { ...room, targetC: 22 }), true);
  assert.equal(onlyRoomTargetChanged(room, { ...room, targetC: 22, presenceControl: true }), false);
  assert.equal(onlyRoomTargetChanged(room, { ...room, targetC: 22, temperatureEntity: 'sensor.other' }), false);
  const snapshot = { control: defaultRules, thermal: input.thermal, mappings: {}, preferences: {} };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async command => sent.push(command), activeAllowed: true, clock: () => now });
  await runner.tick();
  assert.equal(sent.length, 0);
  snapshot.thermal.rooms[0].targetC = 22;
  await runner.tick();
  assert.deepEqual(sent[0], { entityId: 'climate.cv', service: 'climate.set_temperature', value: 22 });
  assert.equal((await runner.tick()).decisions[0].status, 'waiting');
});

test('proefmodus stuurt niets en dubbele thermostaatbediening wordt geblokkeerd', async () => {
  const input = fixture(); input.thermal.mode = 'preview';
  const snapshot = { control: { ...defaultRules, mode: 'preview', rules: [{ id: 'legacy', name: 'Oude thermostaatregel', enabled: true, confirmed: true, priority: 50, conditions: [{ entityId: 'sensor.temperature', operator: 'gt', value: 0 }], action: { type: 'climate_temperature', entityId: 'climate.cv', value: 22, otherwise: 17 } }] }, thermal: input.thermal, mappings: {} };
  let calls = 0;
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async () => { calls++; }, activeAllowed: true, clock: () => now });
  const result = await runner.tick();
  assert.equal(calls, 0);
  assert.ok(result.decisions.every(decision => decision.status === 'blocked'));
});

test('net- en productiemeters kunnen niet als aircoverbruik worden gekoppeld', () => {
  const input = sunnyFixture(); input.source.solar.powerEntity = 'sensor.pv';
  assert.throws(() => validateThermal(input.thermal, input.entities, input.mappings));
  input.source.solar.powerEntity = 'sensor.airco';
  assert.doesNotThrow(() => validateThermal(input.thermal, input.entities, input.mappings));
});

test('batterijontlading wordt niet als zonoverschot benut voor extra warmte', () => {
  const input = sunnyFixture();
  input.mappings.batteryMode = 'measured'; input.mappings.batteryPower = 'sensor.battery';
  input.mappings.batteryDirection = 'positive-charge';
  input.entities.push({ id: 'sensor.battery', domain: 'sensor', available: true, unit: 'W', state: '-500', reportedAt: new Date(now).toISOString() });
  assert.equal(solarTarget({ ...input, previous: { active: true } }).active, false);
});

test('zonneboost geeft altijd basis 21 plus 1, nooit telkens een extra graad bovenop het apparaatdoel', () => {
  const input = sunnyFixture();
  input.solarMemory = new Map([['cv', { active: true, basePower: 0 }]]);
  input.entities[1].targetTemperature = 21;
  assert.equal(planThermal(input)[0].command.value, 22);
  input.entities[1].targetTemperature = 22;
  assert.equal(planThermal(input)[0].command, null);
  assert.equal(planThermal(input)[0].targetC, 22);
  assert.equal(input.thermal.rooms[0].targetC, 21);
});

test('gezamenlijke afwezigheid verlaagt een expliciet gekozen kamer zonder zonneboost', () => {
  const input = sunnyFixture();
  input.thermal.rooms[0].presenceControl = true;
  input.entities.find(entity => entity.id === 'sensor.temperature').state = '16';
  input.preferences = { presenceEntities: ['person.first', 'person.second'], presenceMode: 'any', awayC: 17 };
  for (const id of input.preferences.presenceEntities) input.entities.push({ id, domain: 'person', state: 'not_home', available: true, reportedAt: new Date(now).toISOString() });
  input.solarMemory = new Map([['cv', { active: true, basePower: 0 }]]);
  assert.equal(planThermal(input)[0].command.value, 17);
  input.entities.find(entity => entity.id === 'person.first').state = 'home';
  assert.equal(planThermal(input)[0].command.value, 22);
  input.entities.find(entity => entity.id === 'person.first').state = 'not_home';
  input.entities.find(entity => entity.id === 'person.second').available = false;
  assert.equal(planThermal(input)[0].status, 'blocked');
});

test('de aangesloten runner neemt gezamenlijke aanwezigheid mee in het werkelijke thermostaatdoel', async () => {
  const input = fixture(); input.thermal.mode = 'active'; input.thermal.rooms[0].presenceControl = true;
  input.entities[0].state = '16';
  input.entities.push({ id: 'person.first', domain: 'person', state: 'not_home', available: true, reportedAt: new Date(now).toISOString() });
  const snapshot = { control: defaultRules, thermal: input.thermal, mappings: {}, preferences: { presenceEntities: ['person.first'], presenceMode: 'any', awayC: 17 } };
  const sent = [];
  const runner = createRuleRunner({ store: { get: () => structuredClone(snapshot) }, provider: async () => ({ connected: true, entities: input.entities }), unitProvider: async () => '°C', execute: async command => { sent.push(command); }, activeAllowed: true, clock: () => now });
  await runner.tick();
  assert.equal(sent[0].value, 17);
});