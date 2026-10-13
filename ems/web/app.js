import { createIcons, Activity, Link, SlidersHorizontal, RefreshCw, HousePlug, House, Sun, Moon, Flame, Droplet, Plug, Car, Heater, BatteryCharging, Battery, Thermometer, ArrowUpRight, ArrowDownLeft, Lock, Unlock, Clock3, EllipsisVertical, Power, Save, Search, Check, Unplug, Plus, Pencil, Trash2, X, ListChecks, Pause, Play, Menu, Minus, CloudLightning } from 'lucide';
import { Chart } from 'chart.js/auto';
import { createId } from './ids.js';
import { climateStatus, modeLabel, onlyRoomTargetChanged } from './status.js';
import { formatPower } from './power.js';
import { dailyOverviewRows } from '../src/daily-recap.js';
import { isCumulativeSolarMeter } from '../src/solar-meter.js';
import { batteryState } from './battery.js';

function isCompatibleEntity(role, entity) {
  if (role.id === 'evCableStatus') {
    return ['binary_sensor', 'switch', 'sensor'].includes(entity.domain);
  }
  if (role.id === 'evLockStatus') {
    return ['lock', 'switch', 'binary_sensor'].includes(entity.domain);
  }
  return role.domain === entity.domain && (!role.units.length || role.units.includes(entity.unit)) &&
    (!role.deviceClasses || role.deviceClasses.includes(entity.deviceClass));
}

const icons = { Activity, Link, SlidersHorizontal, RefreshCw, HousePlug, House, Sun, Moon, Flame, Droplet, Plug, Car, Heater, BatteryCharging, Battery, Thermometer, ArrowUpRight, ArrowDownLeft, Lock, Unlock, Clock3, EllipsisVertical, Power, Save, Search, Check, Unplug, Plus, Pencil, Trash2, X, ListChecks, Pause, Play, Menu, Minus, CloudLightning };
const main = document.querySelector('#main');
let data;
let view = 'overview';
let powerUnit = 'kW';
try { powerUnit = localStorage.getItem('gridnest-power-unit') === 'W' ? 'W' : 'kW'; } catch {}
let mappingsDraft;
let preferencesDraft;
let controlDraft;
let search = '';
let loading = false;
let refreshTimer;
let refreshSeconds;
let noticeTimeout;
let utilityCharts = [];
const utilityHistoryCache = {};
const utilityHistoryRequests = {};
let dailyRecapCache;
let dailyRecapPanelNode;
let dailyRecapContentNode;
let dailyRecapLoadPromise;
const liveBindings = new Map();
let solarLimitConsentEntity;
let solarLimitPending = false;

const icon = name => {
  const node = document.createElement('i');
  node.dataset.lucide = name;
  return node;
};
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function bindLive(node, update) {
  liveBindings.set(node, update);
  update();
  return node;
}
function liveText(tag, className, read) {
  const node = element(tag, className);
  return bindLive(node, () => {
    const value = String(read() ?? '');
    if (node.textContent !== value) node.textContent = value;
  });
}
function updateLiveBindings() {
  for (const [node, update] of liveBindings) {
    if (!node.isConnected) liveBindings.delete(node);
    else update();
  }
}
const number = value => new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(value);
function powerText(value) {
  return formatPower(value, powerUnit);
}
const formatTime = value => new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
function measurement(role) {
  if (role === 'presence' && data.preferences.presenceEntities?.length) return data.householdPresence?.occupied === true ? 'Aanwezig' : data.householdPresence?.occupied === false ? 'Afwezig' : 'Onbekend';
  if (role === 'gridImport') return powerText(data.energy?.importKw);
  if (role === 'gridExport') return powerText(data.energy?.exportKw);
  if (role === 'totalConsumption') return powerText(data.energy?.totalKw);
  const reading = data.readings.find(item => item.role === role);
  if (!reading?.valid) return 'Niet beschikbaar';
  if (role === 'climate') {
    const entity = data.entities.find(item => item.id === reading.entityId);
    return climateStatus({ available: entity?.available, mode: reading.value, action: entity?.hvacAction });
  }
  if (role === 'evSessionEnergy') {
    const value = Number(reading.value);
    if (!Number.isFinite(value)) return 'Niet beschikbaar';
    return `${number(reading.unit === 'Wh' ? value / 1000 : value)} kWh`;
  }
  if (['W', 'kW'].includes(reading.unit)) return powerText(Number(reading.value) / (reading.unit === 'W' ? 1000 : 1));
  if (reading.unit) return `${number(Number(reading.value))} ${reading.unit}`;
  if (role === 'evCableStatus') return reading.value === 'on' ? 'Kabel aangesloten' : reading.value === 'off' ? 'Kabel los' : reading.value;
  if (role === 'evLockStatus') return ['on', 'locked'].includes(reading.value) ? 'Kabel vergrendeld' : ['off', 'unlocked'].includes(reading.value) ? 'Kabel ontgrendeld' : reading.value;
  if (role === 'batteryEnable') return reading.value === 'on' ? 'Accu actief' : reading.value === 'off' ? 'Stand-by' : reading.value;
  if (role === 'presence') return reading.value === 'on' ? 'Aanwezig' : 'Afwezig';
  const states = { heat: 'Verwarmen', cool: 'Koelen', auto: 'Automatisch', off: 'Uit', on: 'Aan', locked: 'Vergrendeld', unlocked: 'Ontgrendeld', connected: 'Aangesloten', disconnected: 'Losgekoppeld', plugged: 'Aangesloten', unplugged: 'Losgekoppeld' };
  return states[reading.value] || reading.value;
}

function notify(message, error = false) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', error);
  notice.hidden = false;
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => { notice.hidden = true; }, 5000);
}

async function api(path, options = {}) {
  const response = await fetch(`./api/${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Verzoek mislukt.');
  return body;
}
function syncDeviceNavigation() {
  const rules = data.control?.rules ?? [];
  const hasEv = data.mappings.evMode !== 'none' && Boolean(['evPower', 'evSoc', 'evEnergyTotal', 'evEnable', 'evCurrentLimit', 'evCableStatus', 'evLockStatus', 'evSessionEnergy', 'evPhase1Current', 'evPhase2Current', 'evPhase3Current'].some(role => data.mappings[role]) || rules.some(rule => ['ev_enable', 'ev_current'].includes(rule.action.type)));
  const hasBat = data.mappings.batteryMode !== 'none' && (data.mappings.batteryMode === 'measured' || Boolean(data.mappings.batterySoc || data.mappings.batteryHealth || data.mappings.batteryEnable || data.mappings.batteryInputPower || data.mappings.batteryOutputPower || data.mappings.batteryRemainingTime) || (data.mappings.batteries && data.mappings.batteries.length > 0) || rules.some(rule => rule.action.type === 'battery_power'));
  const visibility = {
      ev: hasEv,
      battery: hasBat,
      solar: Boolean(data.mappings.solar || data.mappings.solarToday || data.mappings.solarExpectedNow || data.mappings.solarExpectedToday || data.mappings.solarLimit || rules.some(rule => rule.action.type === 'pv_limit'))
  };
  for (const [device, visible] of Object.entries(visibility)) {
    document.querySelector(`[data-view="${device}"]`).hidden = !visible;
    if (!visible && view === device) view = 'overview';
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function setRefreshInterval(seconds) {
  if (refreshSeconds === seconds) return;
  refreshSeconds = seconds;
  clearInterval(refreshTimer);
  refreshTimer = seconds > 0 ? setInterval(() => {
    if (document.hidden || document.querySelector('dialog[open]') || document.activeElement?.matches('input[type="range"]')) return;
    refresh();
  }, seconds * 1000) : undefined;
}

async function refresh(showButtonProgress = false) {
  if (loading) return;
  loading = true;
  const refreshButton = document.querySelector('#refresh');
  if (showButtonProgress) refreshButton.disabled = true;
  try {
    data = await api('bootstrap');
    setRefreshInterval(data.preferences.refreshSeconds ?? 10);
    const previousView = view;
    syncDeviceNavigation();
    mappingsDraft ??= { ...data.mappings };
    preferencesDraft ??= { ...data.preferences };
    controlDraft ??= structuredClone(data.control);
    document.querySelector('#mode-label').textContent = `v0.1 · ${modeLabel({ demo: data.demo, activeAllowed: data.controlStatus?.activeAllowed, mode: data.control?.mode })}`;
    document.querySelector('#connection').textContent = data.demo ? 'Voorbeeldwoning · Demodata' : data.message;
    document.querySelector('#connection').className = data.demo ? 'demo-status' : data.connected ? 'connected-status' : 'offline-status';
    document.querySelector('#timestamp').textContent = `Opgehaald om ${formatTime(data.fetchedAt)}`;
    if (main.getAttribute('aria-busy') === 'true' || view !== previousView) render();
    else {
      updateLiveBindings();
      if (view === 'rules') updateRuleStatus();
      if (view === 'overview' && dailyRecapPanelNode && (!dailyRecapCache || Date.now() - dailyRecapCache.fetchedAt > 30000)) loadDailyRecap(dailyRecapContentNode);
      if (view === 'overview') {
        for (const [utility, preference, role] of [['gas', 'showGas', 'gasConsumption'], ['water', 'showWater', 'waterConsumption']]) {
          const entityId = data.mappings[role];
          const status = main.querySelector(`.utility-history-${utility}`);
          const cached = entityId && utilityHistoryCache[`${utility}:${entityId}`];
          if (data.preferences[preference] && entityId && status && (!cached || Date.now() - cached.fetchedAt > 30000)) drawUtilityCharts(utility, status, entityId);
        }
      }
      if (view === 'solar') {
        const panel = main.querySelector('.solar-panel');
        if (panel && (!dailyRecapCache || Date.now() - dailyRecapCache.fetchedAt > 30000)) loadSolarChart(panel);
      }
    }
  } catch (error) {
    document.querySelector('#connection').textContent = 'Verbinding met EMS verbroken';
    if (!data) {
      main.setAttribute('aria-busy', 'false');
      main.replaceChildren(element('h1', '', 'Verbinding niet beschikbaar'), element('p', '', 'Metingen kunnen niet worden opgehaald.'));
    }
    notify(error.message, true);
  } finally {
    loading = false;
    if (showButtonProgress) refreshButton.disabled = false;
  }
}

function heading(title, subtitle) {
  const header = element('div', 'page-heading');
  const text = element('div');
  text.append(element('span', 'eyebrow', 'MIJN HUISHOUDEN'), element('h1', '', title), element('p', 'subtitle', subtitle));
  header.append(text);
  main.append(header);
  return header;
}

function solarOutlook(parent) {
  const outlook = data.energy?.solarOutlook;
  const hasNow = Boolean(data.mappings.solarExpectedNow);
  const hasToday = Boolean(data.mappings.solarExpectedToday || data.mappings.solarToday);
  if (!hasNow && !hasToday) return;
  const section = element('section', 'solar-outlook');
  section.append(element('h3', '', 'Zonne-opbrengst · verwachting en werkelijk'));
  if (hasNow) {
    const row = element('div', 'solar-outlook-row');
    row.append(element('strong', 'solar-period', 'Nu'));
    const values = element('div', 'solar-outlook-values');
    for (const [label, read] of [
      ['Verwacht', () => powerText(data.energy?.solarOutlook?.expectedNowKw)],
      ['Actueel', () => powerText(data.energy?.solarOutlook?.actualNowKw)]
    ]) {
      const item = element('div', 'solar-outlook-value');
      item.append(element('span', '', label), liveText('strong', '', read));
      values.append(item);
    }
    row.append(values);
    section.append(row);
  }
  if (hasToday) {
    const row = element('div', 'solar-outlook-row');
    row.append(element('strong', 'solar-period', 'Vandaag'));
    const values = element('div', 'solar-outlook-values');
    const expected = element('div', 'solar-outlook-value');
        expected.append(element('span', '', 'Verwacht'), liveText('strong', '', () => {
          const value = data.energy?.solarOutlook?.expectedTodayKwh;
          return value === null || value === undefined ? 'Niet beschikbaar' : `${number(value)} kWh`;
        }));
    const cachedRecap = dailyRecapCache?.mappingsKey === JSON.stringify(data.mappings) ? dailyRecapCache : null;
    const cachedSolarRow = cachedRecap?.rows?.find(item => item.label === 'Zonnepanelen');
    const actual = element('span', 'solar-actual-today', cachedRecap
      ? solarDayText(cachedSolarRow, cachedRecap.solarToday)
      : 'Werkelijk dagtotaal ophalen…');
    actual.id = 'solar-actual-today';
    const actualValue = element('div', 'solar-outlook-value');
    actualValue.append(element('span', '', 'Werkelijk'), actual);
    values.append(expected, actualValue);
    row.append(values);
    section.append(row);
  }
  parent.append(section);
}

function batteryInfo(config) {
  const entity = data.entities.find(item => item.id === config.powerEntity);
  const raw = entity?.available && entity.state.trim() !== '' && ['W', 'kW'].includes(entity.unit) && Number.isFinite(Number(entity.state))
    ? Number(entity.state) * (entity.unit === 'kW' ? 1000 : 1) * (config.isMain && data.mappings.batteryDirection === 'positive-discharge' ? -1 : 1) : null;
  const status = data.entities.find(item => item.id === config.chargingStateEntity);
  return batteryState(config.chargingStateEntity ? status ?? { available: false } : null, raw);
}

function batteryFlowSummary() {
  const batteries = [
    ...(data.mappings.batteryPower ? [{ powerEntity: data.mappings.batteryPower, chargingStateEntity: data.mappings.batteryChargingState, isMain: true }] : []),
    ...(data.mappings.batteries ?? [])
  ];
  let watts = 0;
  let measured = false;
  for (const battery of batteries) {
    const power = batteryInfo(battery).powerW;
    if (power === null) continue;
    watts += power;
    measured = true;
  }
  const powerKw = measured ? watts / 1000 : data.demo && data.mappings.batteryMode !== 'none' ? 0.75 : null;
  const hasThroughput = batteries.length > 0 && batteries.every(battery => batteryInfo(battery).label === 'Doorvoer');
  const label = powerKw === null ? 'Status onbekend' : powerKw < -0.01 ? 'Naar woning' : powerKw > 0.01 ? 'Aan het laden' : hasThroughput ? 'Doorvoer' : 'Stand-by';
  return { powerKw, label };
}

function overview() {
  const visibleRoles = data.roles.filter(role => role.id !== 'presence');
  const mapped = visibleRoles.filter(role => Boolean(data.mappings[role.id])).length;
  heading('Energie in huis', data.demo ? 'Voorbeeldwoning · fictieve meetwaarden' : 'Actuele metingen uit Home Assistant');
  const metrics = element('section', 'metrics');
  metrics.setAttribute('aria-label', 'Actuele meetwaarden');
  for (const [role, title, name] of [['totalConsumption', 'Woningverbruik', 'house-plug'], ['solar', 'Zonneproductie', 'sun'], ['gridImport', 'Netafname', 'plug'], ['temperature', 'Woonkamer', 'thermometer']]) {
    const metric = element('div', `metric metric-${role}`);
    const label = element('div', 'metric-label', title);
    label.prepend(icon(name));
    metric.append(label, liveText('strong', '', () => measurement(role)));
    metrics.append(metric);
  }
  main.append(metrics);
  const section = element('section', 'energy-section');
  const sectionHeader = element('div', 'section-heading');
  sectionHeader.append(element('h2', '', 'Energiestromen'), element('span', 'tag', data.demo ? 'DEMO' : 'MONITOR'));
  const flow = element('div', 'flow');

  const batteryFlow = batteryFlowSummary();
  const batPowerKw = batteryFlow.powerKw;

  const hasBattery = data.mappings.batteryMode !== 'none' && Boolean(
    data.mappings?.batterySoc || data.mappings?.batteryPower || (data.mappings?.batteries && data.mappings.batteries.length > 0) || (data.demo && data.mappings.batteryMode !== 'none')
  );

  const hasEv = data.mappings.evMode !== 'none' && Boolean(
    ['evPower', 'evSoc', 'evEnergyTotal', 'evEnable', 'evCurrentLimit', 'evCableStatus', 'evLockStatus', 'evSessionEnergy', 'evPhase1Current', 'evPhase2Current', 'evPhase3Current'].some(role => data.mappings[role]) || (data.demo && data.mappings.evMode !== 'none')
  );

  const isBatDischarging = batPowerKw !== null && batPowerKw < -0.01;
  const isBatCharging = batPowerKw !== null && batPowerKw > 0.01;
  const batFlowClass = isBatDischarging ? 'flow-active-to-home' : isBatCharging ? 'flow-active-from-home' : '';

  // Bepaal SVG lijnen op basis van actieve knooppunten
  let flowPaths = '<path d="M300 62V155 M90 155H300"/>'; // Altijd Zon naar Woning en Net naar Woning
  if (hasEv) flowPaths += '<path d="M300 155H510"/>'; // Woning naar Auto
  if (hasBattery) {
    flowPaths += `<path class="${batFlowClass}" d="M100 250 L300 155"/>`; // Batterij schuin naar Woning
    flowPaths += '<path d="M500 250 L300 155"/>'; // Warmte schuin rechtsonder
  } else {
    flowPaths += '<path d="M300 155V250"/>'; // Warmte recht onder Woning
  }
  flowPaths += '<circle cx="300" cy="155" r="8"/>';

  flow.innerHTML = `<svg class="flow-lines" viewBox="0 0 600 320" preserveAspectRatio="none" aria-hidden="true">${flowPaths}</svg>`;
  const batteryPath = flow.querySelector('path[d="M100 250 L300 155"]');
  if (batteryPath) bindLive(batteryPath, () => {
    const power = batteryFlowSummary().powerKw;
    batteryPath.setAttribute('class', power !== null && power < -0.01 ? 'flow-active-to-home' : power !== null && power > 0.01 ? 'flow-active-from-home' : '');
  });

  const nodes = [
    ['solar-node', 'Zon', 'sun', 'solar'],
    ['grid-node', 'Net', 'plug', 'gridImport'],
    ['home-node', 'Woning', 'house', null]
  ];

  if (hasEv) {
    nodes.push(['ev-node', 'Auto', 'car', 'evPower']);
  }

  if (hasBattery) {
    nodes.push(['battery-node', 'Thuisbatterij', 'battery-charging', 'battery']);
    nodes.push(['heat-node heat-node-corner', 'Warmte', 'heater', 'climate']);
  } else {
    nodes.push(['heat-node', 'Warmte', 'heater', 'climate']);
  }

  for (const [className, title, name, role] of nodes) {
    let nodeClass = `flow-node ${className}`;
    if (!role) {
      if (data.householdPresence?.occupied === true) nodeClass += ' home-node-present';
      else if (data.householdPresence?.occupied === false) nodeClass += ' home-node-away';
    }
    const node = element('div', nodeClass);
    if (role === 'battery') {
      node.append(icon(isBatDischarging ? 'arrow-up-right' : 'battery-charging'), element('span', '', title),
        liveText('strong', '', () => { const power = batteryFlowSummary().powerKw; return power === null ? 'Niet beschikbaar' : powerText(Math.abs(power)); }),
        liveText('small', '', () => batteryFlowSummary().label));
      bindLive(node, () => {
        const power = batteryFlowSummary().powerKw;
        node.classList.toggle('flow-active-to-home', power !== null && power < -0.01);
        node.classList.toggle('flow-active-from-home', power !== null && power > 0.01);
      });
    } else {
      node.append(icon(name), element('span', '', title), liveText('strong', '', () => measurement(role || 'totalConsumption')));
      if (!role) {
        node.append(liveText('small', '', () => measurement('presence')));
        const batteryBadge = liveText('small', 'battery-feeding-badge', () => {
          const power = batteryFlowSummary().powerKw;
          return power !== null && power < -0.01 ? `Batterij levert: ${powerText(Math.abs(power))}` : '';
        });
        bindLive(batteryBadge, () => { batteryBadge.hidden = !(batteryFlowSummary().powerKw < -0.01); });
        node.append(batteryBadge);
        bindLive(node, () => {
          node.classList.toggle('home-node-present', data.householdPresence?.occupied === true);
          node.classList.toggle('home-node-away', data.householdPresence?.occupied === false);
        });
      }
      if (role === 'evPower' && data.mappings.evSoc) node.append(liveText('small', '', () => `Accu: ${measurement('evSoc')}`));
      if (role === 'gridImport') node.append(liveText('small', '', () => `Terug: ${measurement('gridExport')}`));
    }
    flow.append(node);
  }
  section.append(sectionHeader, flow);
  solarOutlook(section);
  const phases = (data.energy?.phaseLoads ?? []).filter((item, index) => data.mappings[`phase${index + 1}Current`] || data.mappings[`phase${index + 1}Voltage`] || data.mappings[`phase${index + 1}Power`]);
  if (phases.length) {
    const phaseSection = element('section', 'phase-loads');
    phaseSection.append(element('h3', '', 'Per fase'));
    const rows = element('div', 'phase-load-grid');
    for (const phase of phases) {
      const row = element('div', 'phase-load-row');
      row.append(element('strong', '', phase.phase));
      const values = element('div', 'phase-load-values');
      values.classList.add('phase-load-details');
      row.append(liveText('span', 'phase-load-primary', () => {
        const current = data.energy?.phaseLoads?.find(item => item.phase === phase.phase);
        return current?.activePowerKw === null || current?.activePowerKw === undefined
          ? current?.apparentPowerVA === null || current?.apparentPowerVA === undefined ? '—' : `${number(current.apparentPowerVA)} VA`
          : powerText(current.activePowerKw);
      }));
      for (const label of ['Stroom', 'Spanning']) {
        const detail = element('span', 'phase-load-reading');
        bindLive(detail, () => {
          const current = data.energy?.phaseLoads?.find(item => item.phase === phase.phase);
          const reading = label === 'Stroom' ? current?.currentA : current?.voltageV;
          const value = reading === null || reading === undefined ? label === 'Stroom' ? '— A' : '— V' : `${number(reading)} ${label === 'Stroom' ? 'A' : 'V'}`;
          detail.textContent = value;
          detail.title = label;
          detail.setAttribute('aria-label', `${label}: ${value}`);
        });
        values.append(detail);
      }
      const phaseNumber = Number(phase.phase.slice(1));
      if (data.mappings[`phase${phaseNumber}Current`]) {
        const meter = element('meter', 'phase-current-meter');
        bindLive(meter, () => {
          const current = data.energy?.phaseLoads?.find(item => item.phase === phase.phase)?.currentA;
          meter.min = 0;
          meter.max = Math.max(25, Math.ceil(current ?? 0));
          meter.value = current ?? 0;
          meter.hidden = current === null || current === undefined;
          meter.setAttribute('aria-label', `Stroomsterkte ${phase.phase}`);
        });
        values.append(meter);
      }
      row.append(values);
      rows.append(row);
    }
    phaseSection.append(rows);
    section.append(phaseSection);
  }
  main.append(section);
  consumptionSplit();
  batteriesOverview();
  heatOverview();
  if (data.preferences.showGas) utilityPanel('gas');
  if (data.preferences.showWater) utilityPanel('water');
  dailyRecapPanel();
  const status = element('section', 'setup-status');
  const statusText = element('div');
  statusText.append(element('h2', '', `${mapped} van ${visibleRoles.length} entiteiten gekoppeld`), element('p', 'subtitle', `Regelaar: ${{ off: 'uit', preview: 'proefmodus', active: 'actief' }[data.control?.mode] ?? 'uit'}`));
  const button = element('button', 'secondary-button', 'Koppelingen');
  button.prepend(icon('link'));
  button.addEventListener('click', () => navigate('entities'));
  status.append(statusText, button);
  main.append(status);
}

function consumptionSplit() {
  const energy = data.energy;
  if (!energy) return;
  const section = element('section', 'consumption-section');
  const header = element('div', 'section-heading');
  const sourceLabels = { sensor: 'GEMETEN TOTAAL', balance: 'BEREKEND TOTAAL', unavailable: 'ONVOLLEDIG' };
  header.append(element('h2', '', 'Verbruik nu'), liveText('span', 'tag', () => sourceLabels[data.energy?.totalSource] ?? 'ONVOLLEDIG'));
  const totals = element('div', 'consumption-totals');
  for (const [label, field, className] of [['Totaal woning', 'totalKw', 'total'], ['Bekende verbruikers', 'knownKw', 'known'], ['Onbekend / niet toegewezen', 'unknownKw', 'unknown']]) {
    const stat = element('div', `consumption-stat ${className}`);
    stat.append(element('span', '', label), liveText('strong', '', () => powerText(data.energy?.[field] ?? null)));
    totals.append(stat);
  }
  section.append(header, totals);
  const meter = element('meter', 'consumption-meter');
  bindLive(meter, () => {
    const current = data.energy;
    meter.min = 0;
    meter.max = current?.totalKw ?? 1;
    meter.value = current?.knownKw ?? 0;
    meter.hidden = current?.status !== 'complete' || !(current.totalKw > 0);
    meter.setAttribute('aria-label', 'Aandeel bekend verbruik in totaal woningverbruik');
  });
  section.append(meter);
  if (energy.consumers.length) {
    const list = element('ul', 'consumer-readings');
    for (const consumer of energy.consumers) {
      const row = element('li', 'consumer-tile');
      const switchId = data.mappings.knownConsumerSwitches?.[consumer.id];
      row.dataset.consumerId = consumer.id;
      row.dataset.state = 'unknown';
      row.append(element('span', 'consumer-name', consumer.name), liveText('strong', 'consumer-value', () => {
        const current = data.energy?.consumers?.find(item => item.id === consumer.id);
        return powerText(current?.powerKw ?? null);
      }));
      if (switchId) {
        const currentActuator = () => data.entities.find(item => item.id === data.mappings.knownConsumerSwitches?.[consumer.id]);
        const executeToggle = async () => {
          try {
            const actuator = currentActuator();
            if (!actuator?.available || !['on', 'off'].includes(actuator.state)) return;
            await api('consumers/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ consumerId: consumer.id, switchId: actuator.id, enabled: actuator.state !== 'on', expectedState: actuator.state, confirm: true }) });
            notify('Verbruikerschakelaar aangestuurd.');
            await refresh();
          } catch (error) { notify(error.message, true); }
        };
        const toggle = toolButton('power', `${consumer.name}: schakelstatus onbekend`, () => {
          const actuator = currentActuator();
          const enabled = actuator?.state === 'on';
          if (!actuator?.available || !['on', 'off'].includes(actuator.state)) return;
          if (data.preferences?.confirmSwitches === false) {
            executeToggle();
            return;
          }
          const dialog = element('dialog', 'thermal-dialog');
          dialog.setAttribute('aria-label', `${consumer.name} schakelen`);
          dialog.append(element('h2', '', `${consumer.name} ${enabled ? 'uitschakelen' : 'inschakelen'}?`),
            element('p', '', `Dit bedient ${actuator.name} rechtstreeks. Een lopend apparaatproces kan worden onderbroken.`));
          const actions = element('div', 'dialog-actions');
          actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
          const confirm = element('button', 'primary-button', enabled ? 'Uitschakelen' : 'Inschakelen');
          confirm.prepend(icon('check'));
          confirm.addEventListener('click', async () => {
            confirm.disabled = true;
            try {
              const latest = currentActuator();
              if (!latest?.available || !['on', 'off'].includes(latest.state)) throw new Error('De schakelaarstatus is niet beschikbaar.');
              await api('consumers/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consumerId: consumer.id, switchId: latest.id, enabled: latest.state !== 'on', expectedState: latest.state, confirm: true }) });
              dialog.close();
              notify('Verbruikerschakelaar aangestuurd.');
              await refresh();
            } catch (error) { notify(error.message, true); confirm.disabled = false; }
          });
          actions.append(confirm);
          dialog.append(actions);
          dialog.addEventListener('close', () => dialog.remove());
          document.body.append(dialog);
          createIcons({ icons });
          dialog.showModal();
        });
        toggle.classList.add('consumer-toggle');
        bindLive(toggle, () => {
          const actuator = currentActuator();
          const known = actuator?.available && ['on', 'off'].includes(actuator.state);
          toggle.title = known ? `${consumer.name} ${actuator.state === 'on' ? 'uitschakelen' : 'inschakelen'}` : `${consumer.name}: schakelstatus onbekend`;
          toggle.setAttribute('aria-label', toggle.title);
          toggle.setAttribute('role', 'switch');
          toggle.setAttribute('aria-checked', String(known && actuator.state === 'on'));
          toggle.disabled = !known || !data.controlStatus?.activeAllowed;
          row.dataset.state = known ? actuator.state : 'unknown';
        });
        row.append(toggle);
      }
      list.append(row);
    }
    section.append(list);
  }
  for (const warning of energy.warnings) section.append(element('p', 'energy-warning', warning));
  main.append(section);
}

function batteriesOverview() {
  if (data.preferences?.showBatteries === false || data.mappings?.batteryMode === 'none') return;
  const items = [];

  // 1. Hoofdbatterij (altijd eerst tonen als er data is of gekoppeld is)
  if (data.mappings?.batterySoc || data.mappings?.batteryPower || data.mappings?.batteryEnable) {
    items.push({
      id: 'main_battery',
      name: 'Hoofdbatterij',
      socEntity: data.mappings.batterySoc,
      powerEntity: data.mappings.batteryPower,
      chargingStateEntity: data.mappings.batteryChargingState,
      isMain: true
    });
  } else if (data.demo && !data.mappings?.batteries?.length) {
    items.push(
      { id: 'demo_main', name: 'Hoofdbatterij', socEntity: 'sensor.demo_battery_soc', powerEntity: 'sensor.demo_battery_power', isMain: true },
      { id: 'demo1', name: 'Batterij 1', socEntity: 'sensor.demo_battery1_soc', powerEntity: 'sensor.demo_battery1_power' },
      { id: 'demo2', name: 'Batterij 2', socEntity: 'sensor.demo_battery2_soc', powerEntity: 'sensor.demo_battery2_power' }
    );
  }

  // 2. Extra batterijsystemen (indien aangevinkt om op startpagina te tonen)
  const extraItems = (data.mappings?.batteries ?? []).filter(b => b.showOnOverview !== false);
  items.push(...extraItems);

  if (!items.length) return;

  const section = element('section', 'batteries-overview');
  section.setAttribute('aria-label', 'Batterijen');
  const header = element('div', 'section-heading');
  header.append(
    element('h2', '', 'Batterijen'),
    element('span', 'tag muted', `${items.length} ${items.length === 1 ? 'systeem' : 'systemen'}`)
  );
  section.append(header);

  const card = element('div', 'batteries-card');
  let totalWatts = 0;
  let hasValidPower = false;

  for (const item of items) {
    const row = element('div', 'battery-row');
    row.dataset.batteryId = item.id;
    const socEntity = data.entities.find(e => e.id === item.socEntity);
    const powerEntity = data.entities.find(e => e.id === item.powerEntity);

    const socVal = socEntity?.available && Number.isFinite(Number(socEntity.state)) ? Math.round(Number(socEntity.state)) : null;

    let powerW = null;
    if (powerEntity?.available && Number.isFinite(Number(powerEntity.state))) {
      const rawW = Number(powerEntity.state) * (powerEntity.unit === 'kW' ? 1000 : 1);
      // Als het de hoofdbatterij is met specifieke batteryDirection
      powerW = item.isMain && data.mappings?.batteryDirection === 'positive-discharge' ? rawW * -1 : rawW;
    }

    const actualState = batteryInfo(item);
    powerW = actualState.powerW;
    if (powerW !== null) { totalWatts += powerW; hasValidPower = true; }
    let stateLabel = actualState.label;
    let stateClass = 'idle';
    let powerDisplay = '0 W';

    if (powerW !== null) {
      if (powerW > 10) {
        stateLabel = 'Laden';
        stateClass = 'charging';
        powerDisplay = `+${powerText(powerW / 1000)}`;
      } else if (powerW < -10) {
        stateLabel = 'Ontladen';
        stateClass = 'discharging';
        powerDisplay = powerText(powerW / 1000);
      } else {
        stateLabel = 'Stand-by';
        stateClass = 'idle';
        powerDisplay = '0 W';
      }
    } else {
      powerDisplay = 'Niet beschikbaar';
    }
    stateLabel = actualState.label;

    const rowHeader = element('div', 'battery-row-header');
    const identity = element('div', 'battery-identity');
    identity.append(icon(stateClass === 'charging' ? 'battery-charging' : 'battery'), element('span', '', item.name));
    const stateSpan = liveText('span', `battery-state ${stateClass}`, () => batteryInfo(item).label);
    bindLive(stateSpan, () => {
      const actual = batteryInfo(item);
      const state = actual.powerW === null ? 'idle' : actual.powerW > 10 ? 'charging' : actual.powerW < -10 ? 'discharging' : 'idle';
      stateSpan.className = `battery-state ${state}`;
      stateSpan.textContent = actual.label;
    });
    rowHeader.append(identity, stateSpan);

    const detailsLeft = element('div', 'battery-details-left');
    const socText = socVal !== null ? `${number(socVal)} %` : '— %';
    detailsLeft.append(liveText('span', 'battery-soc', () => {
      const entity = data.entities.find(current => current.id === item.socEntity);
      return entity?.available && Number.isFinite(Number(entity.state)) ? `${number(Math.round(Number(entity.state)))} %` : '— %';
    }));
    const bar = element('div', 'battery-level-bar');
    const fill = element('div', 'battery-level-fill');
    bindLive(fill, () => {
      const entity = data.entities.find(current => current.id === item.socEntity);
      const value = entity?.available && Number.isFinite(Number(entity.state)) ? Number(entity.state) : null;
      fill.style.width = `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`;
    });
    bar.append(fill);
    detailsLeft.append(bar);

    const powerStrong = liveText('strong', 'battery-power', () => {
      const power = batteryInfo(item).powerW;
      if (power === null) return 'Niet beschikbaar';
      if (power > 10) return `+${powerText(power / 1000)}`;
      if (power < -10) return powerText(power / 1000);
      return '0 W';
    });

    row.append(rowHeader, detailsLeft, powerStrong);
    card.append(row);
  }

  section.append(card);

  if (hasValidPower) {
    const totalRow = element('div', 'batteries-total-row');
    const prefix = totalWatts > 10 ? '+' : '';
    totalRow.append(
      element('span', '', 'Totaal batterijvermogen'),
      liveText('strong', '', () => {
        const currentTotal = items.reduce((sum, item) => sum + (batteryInfo(item).powerW ?? 0), 0);
        return `${currentTotal > 10 ? '+' : ''}${powerText(currentTotal / 1000)}`;
      })
    );
    section.append(totalRow);
  }

  main.append(section);
}

async function dailyHistory(reload = false) {
  const mappingsKey = JSON.stringify(data.mappings);
  if (reload || !dailyRecapCache || dailyRecapCache.mappingsKey !== mappingsKey || Date.now() - dailyRecapCache.fetchedAt > 30000) {
    const previousRows = dailyRecapCache?.mappingsKey === mappingsKey ? dailyRecapCache.overviewRows : undefined;
    dailyRecapCache = { ...await api('daily-recap'), fetchedAt: Date.now(), mappingsKey, overviewRows: previousRows };
  }
  return dailyRecapCache;
}

function dailyRecapOverviewKey() {
  return JSON.stringify({ mappings: data.mappings, showGas: data.preferences.showGas, showWater: data.preferences.showWater });
}

function loadDailyRecap(container, reload = false, filter = null) {
  if (filter) return loadDailyRecapData(container, reload, filter);
  if (dailyRecapLoadPromise) return dailyRecapLoadPromise;
  const request = loadDailyRecapData(container, reload, filter);
  dailyRecapLoadPromise = request.finally(() => {
    if (dailyRecapLoadPromise === trackedRequest) dailyRecapLoadPromise = undefined;
  });
  const trackedRequest = dailyRecapLoadPromise;
  return trackedRequest;
}

async function loadDailyRecapData(container, reload, filter) {
  const mappingsKey = JSON.stringify(data.mappings);
  try {
    const recap = await dailyHistory(reload);
    const utilities = {};
    if (!filter) {
      await Promise.all([['gas', 'showGas', 'gasConsumption'], ['water', 'showWater', 'waterConsumption']].map(async ([utility, preference, role]) => {
        if (!data.preferences[preference]) return;
        const official = recap.officialRows?.find(row => row.label === (utility === 'gas' ? 'Gas' : 'Water'));
        if (official) { utilities[utility] = official; return; }
        if (!data.mappings[role]) return;
        try { utilities[utility] = (await utilityHistoryData(utility, data.mappings[role], reload)).today ?? { value: null, complete: false }; }
        catch {
          const cachedRow = dailyRecapCache?.mappingsKey === mappingsKey
            ? dailyRecapCache.overviewRows?.find(row => row.label === (utility === 'gas' ? 'Gas' : 'Water'))
            : null;
          utilities[utility] = cachedRow
            ? { value: cachedRow.value, unit: cachedRow.unit, complete: cachedRow.complete, source: cachedRow.source }
            : { value: null, complete: false };
        }
      }));
    }
    if (!document.body.contains(container)) return;
    const solarActual = document.querySelector('#solar-actual-today');
    if (solarActual) {
      const solarRow = recap.rows.find(row => row.label === 'Zonnepanelen');
      solarActual.textContent = solarDayText(solarRow, recap.solarToday);
      if (isCumulativeSolarMeter(data.entities.find(entity => entity.id === data.mappings.solarToday), data.mappings.solarTodayMode) && recap.solarToday?.energyKwh == null) solarActual.title = 'Beginstand rond middernacht ontbreekt, of de teller is ongeldig of gereset.';
    }
    const rows = filter ? recap.rows.filter(row => filter(row)).map(row => ({ label: row.label, value: row.energyKwh, unit: 'kWh', complete: row.complete }))
      : dailyOverviewRows({ ...recap, dailySolarTodayKwh: data.energy?.solarOutlook?.actualTodayKwh }, data.mappings, utilities);
    if (!filter && dailyRecapCache?.mappingsKey === mappingsKey) {
      dailyRecapCache.overviewRows = rows;
      dailyRecapCache.overviewRowsKey = dailyRecapOverviewKey();
      dailyRecapCache.overviewRowsFetchedAt = Date.now();
    }
    renderDailyRecapRows(container, rows, recap, !filter);
  } catch (error) {
    const solarActual = document.querySelector('#solar-actual-today');
    const hasMatchingCache = dailyRecapCache?.mappingsKey === JSON.stringify(data.mappings);
    if (solarActual && !hasMatchingCache) solarActual.textContent = solarDayText();
    if (document.body.contains(container)) {
      if (container.querySelector('.daily-recap-list')) {
        let warning = container.querySelector('.daily-recap-refresh-error');
        if (!warning) {
          warning = element('p', 'muted daily-recap-refresh-error');
          container.append(warning);
        }
        warning.textContent = `Verversen mislukt: ${error.message}`;
      } else {
        let errorMessage = container.querySelector('.daily-recap-load-error');
        if (!errorMessage) {
          errorMessage = element('p', 'energy-warning daily-recap-load-error');
          container.append(errorMessage);
        }
        errorMessage.textContent = error.message;
      }
    }
  }
}

function renderDailyRecapRows(container, rows, recap, showUpdatedThrough = true) {
  container.querySelector('.daily-recap-refresh-error')?.remove();
  const signature = JSON.stringify({ rows, source: recap.source, updatedThrough: recap.updatedThrough, showUpdatedThrough });
  if (container.dataset.recapSignature === signature) return;
  container.dataset.recapSignature = signature;
  if (!rows.length) {
    container.querySelector('.daily-recap-list')?.remove();
    container.querySelector('.daily-recap-warning')?.remove();
    container.querySelector('.daily-recap-updated')?.remove();
    let empty = container.querySelector('.daily-recap-empty');
    if (!empty) {
      empty = element('p', 'empty-state daily-recap-empty');
      container.append(empty);
    }
    empty.textContent = 'Koppel passende meters om dagtotalen te tonen.';
    return;
  }
  container.querySelector('.daily-recap-empty')?.remove();
  const incomplete = rows.some(row => row.value !== null && !row.complete);
  let warning = container.querySelector('.daily-recap-warning');
  if (incomplete) {
    if (!warning) {
      warning = element('p', 'energy-warning daily-recap-warning');
      container.prepend(warning);
    }
    warning.textContent = 'Onvolledige schatting: er ontbreken meetpunten of er zitten lange gaten in de metingen.';
  } else warning?.remove();
  let list = container.querySelector('.daily-recap-list');
  if (!list) {
    list = element('ul', 'daily-recap-list');
    container.append(list);
  }
  const labels = new Set(rows.map(row => row.label));
  for (const item of [...list.children]) if (!labels.has(item.dataset.rowLabel)) item.remove();
  rows.forEach((row, index) => {
    let item = [...list.children].find(child => child.dataset.rowLabel === row.label);
    if (!item) {
      item = element('li', 'daily-recap-row');
      item.dataset.rowLabel = row.label;
      item.append(element('span'), element('strong'));
    }
    const current = list.children[index];
    if (current !== item) list.insertBefore(item, current ?? null);
    const value = row.value === null || row.value === undefined ? 'Niet beschikbaar'
      : `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: row.unit === 'm³' ? 3 : 2 }).format(row.value)} ${row.unit}${row.source === 'home-assistant' ? '' : ' (schatting)'}`;
    item.firstElementChild.textContent = row.label;
    item.lastElementChild.textContent = value;
  });
  const updatedThrough = showUpdatedThrough && recap.source === 'home-assistant' && recap.updatedThrough
    ? `Energie bijgewerkt t/m ${formatTime(recap.updatedThrough)}` : '';
  let updated = container.querySelector('.daily-recap-updated');
  if (updatedThrough) {
    if (!updated) {
      updated = element('p', 'muted daily-recap-updated');
      container.append(updated);
    }
    updated.textContent = updatedThrough;
  } else updated?.remove();
}

function dailyRecapPanel() {
  if (dailyRecapPanelNode) {
    main.append(dailyRecapPanelNode);
    const cache = dailyRecapCache?.mappingsKey === JSON.stringify(data.mappings) ? dailyRecapCache : null;
    if (!cache?.overviewRows || cache.overviewRowsKey !== dailyRecapOverviewKey() || Date.now() - (cache.overviewRowsFetchedAt ?? 0) > 30000) loadDailyRecap(dailyRecapContentNode);
    return;
  }
  const section = element('section', 'daily-recap-section');
  const header = element('div', 'section-heading');
  header.append(element('h2', '', 'Dagrecap vandaag'), toolButton('refresh-cw', 'Dagrecap vernieuwen', () => loadDailyRecap(content, true)));
  const content = element('div', 'daily-recap-content');
  const cache = dailyRecapCache?.mappingsKey === JSON.stringify(data.mappings) ? dailyRecapCache : null;
  if (cache?.overviewRows) renderDailyRecapRows(content, cache.overviewRows, cache);
  else content.append(element('p', 'muted', 'Dagtotalen laden…'));
  section.append(header, content);
  dailyRecapPanelNode = section;
  dailyRecapContentNode = content;
  main.append(section);
  loadDailyRecap(content);
}

function toolButton(name, title, action) {
  const button = element('button', 'icon-button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(icon(name));
  button.addEventListener('click', action);
  return button;
}

function sortedFloors(rooms) {
  const order = { kelder: -1, 'begane grond': 0, 'eerste verdieping': 1, '1e verdieping': 1, 'tweede verdieping': 2, '2e verdieping': 2, zolder: 3 };
  const compare = new Intl.Collator('nl-NL', { numeric: true }).compare;
  return [...new Set(rooms.map(room => room.floor))].sort((first, second) =>
    (order[first.toLocaleLowerCase('nl-NL')] ?? 100) - (order[second.toLocaleLowerCase('nl-NL')] ?? 100) || compare(first, second));
}

function roomCard(room, config, live, compact = false) {
  const reading = live.rooms.find(item => item.id === room.id);
  const card = element('article', compact ? 'room-card room-card-compact' : 'room-card');
  card.dataset.roomId = room.id;
  const header = element('div', 'section-heading');
  header.append(element('h3', '', room.name), compact ? toolButton('arrow-up-right', `Warmte van ${room.name} bekijken`, () => {
    navigate('thermal');
    main.querySelector(`[data-room-id="${room.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }) : toolButton('pencil', `${room.name} bewerken`, () => editThermal('room', room.id)));
  if (compact) card.append(element('span', 'room-floor', room.floor));
  const temperatures = element('div', 'room-temperatures');
  const current = element('div');
  current.append(element('span', 'muted', 'Gemeten'), liveText('strong', 'room-current', () => {
    const value = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.currentC;
    return value === null || value === undefined ? 'Niet beschikbaar' : `${number(value)} °C`;
  }));
  const target = element('div');
  target.append(element('span', 'muted', 'Kamerdoel'), liveText('strong', 'room-target', () => {
    const value = data.thermal?.rooms?.find(item => item.id === room.id)?.targetC;
    return Number.isFinite(value) ? `${number(value)} °C` : 'Niet beschikbaar';
  }));
  const controls = element('div', 'room-target-controls');
  const adjustTarget = async delta => {
    const currentConfig = data.thermal;
    const currentRoom = currentConfig?.rooms.find(item => item.id === room.id);
    if (!currentRoom) return;
    const nextTarget = Math.max(12, Math.min(26, Math.round((currentRoom.targetC + delta) * 2) / 2));
    if (nextTarget === currentRoom.targetC) return;
    const nextConfig = structuredClone(currentConfig);
    const targetRoom = nextConfig.rooms.find(item => item.id === room.id);
    if (targetRoom) {
      targetRoom.targetC = nextTarget;
      try {
        const result = await api('thermal', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Gridnest-Confirm-Control': 'true' },
          body: JSON.stringify(nextConfig)
        });
        reportRoomTarget(room.id, result);
        await refresh();
      } catch (err) {
        notify(err.message, true);
      }
    }
  };
  const minus = toolButton('minus', `${room.name} doel verlagen`, () => adjustTarget(-0.5));
  const plus = toolButton('plus', `${room.name} doel verhogen`, () => adjustTarget(0.5));
  minus.classList.add('target-step-btn');
  plus.classList.add('target-step-btn');
  controls.append(minus, plus);
  target.append(controls);
  const hasThermostatTarget = Boolean(room.temperatureEntity && data.entities.find(item => item.id === room.temperatureEntity)?.domain === 'climate') || room.sourceIds.some(id => data.entities.find(item => item.id === config.sources.find(source => source.id === id)?.entityId)?.domain === 'climate');
  if (hasThermostatTarget) {
    const thermRow = element('div', 'room-thermostat-sync');
    thermRow.append(liveText('small', 'muted', () => {
      const value = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.thermostatTargetC;
      return value === null || value === undefined ? 'Thermostaatdoel niet beschikbaar' : `Thermostaat: ${number(value)} °C`;
    }));
    const syncBtn = element('button', 'link-button room-sync-btn', 'Overnemen');
    syncBtn.type = 'button';
    bindLive(syncBtn, () => {
      const current = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.thermostatTargetC;
      const targetC = data.thermal?.rooms.find(item => item.id === room.id)?.targetC;
      syncBtn.hidden = !Number.isFinite(current) || Math.abs(current - targetC) < 0.25;
      syncBtn.title = Number.isFinite(current) ? `Kamerdoel instellen op de thermostaatwaarde (${number(current)} °C)` : 'Thermostaatdoel niet beschikbaar';
    });
    syncBtn.addEventListener('click', async () => {
      const current = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.thermostatTargetC;
      const nextConfig = structuredClone(data.thermal);
      const targetRoom = nextConfig.rooms.find(item => item.id === room.id);
      if (!targetRoom || !Number.isFinite(current)) return;
      targetRoom.targetC = current;
      try {
        await saveThermal(nextConfig, true);
        notify(`Kamerdoel ${room.name} overgenomen van thermostaat (${number(current)} °C).`);
      } catch (err) { notify(err.message, true); }
      });
    thermRow.append(syncBtn);
    target.append(thermRow);
  }
  temperatures.append(current, target);
  const labels = { missing: 'Geen meting', below: 'Onder doel', above: 'Boven doel', 'at-target': 'Op temperatuur' };
  const status = liveText('span', `room-status status-${reading?.status ?? 'missing'}`, () => {
    const value = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.status ?? 'missing';
    return labels[value] ?? labels.missing;
  });
  bindLive(status, () => {
    const value = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.status ?? 'missing';
    status.className = `room-status status-${value}`;
    status.textContent = labels[value] ?? labels.missing;
  });
  card.append(header, temperatures, status);
  const solarPlan = data.controlStatus?.decisions?.find(decision => decision.origin === 'thermal' && config.sources.some(source => source.id === decision.sourceId && source.controlRoomId === room.id) && decision.targetC > room.targetC);
  if (solarPlan) card.append(liveText('p', 'solar-target', () => {
    const decision = data.controlStatus?.decisions?.find(item => item.origin === 'thermal' && item.roomName === room.name && item.targetC > (data.thermal?.rooms.find(value => value.id === room.id)?.targetC ?? 0));
    return decision ? `Zonnedoel: ${number(decision.targetC)} °C` : '';
  }));
  if (room.presenceEntity || data.preferences.presenceEntities?.length) card.append(liveText('span', 'room-presence', () => {
    const occupied = data.thermalReadings?.rooms?.find(item => item.id === room.id)?.occupied;
    return occupied === null || occupied === undefined ? 'Onbekend' : occupied ? 'Aanwezig' : 'Afwezig';
  }));
  if (room.sourceIds.some(id => config.sources.find(source => source.id === id)?.solar?.enabled)) card.append(liveText('p', 'solar-target', () => {
    const targetC = data.controlStatus?.decisions?.find(decision => decision.origin === 'thermal' && decision.roomName === room.name && decision.targetC > (data.thermal?.rooms.find(value => value.id === room.id)?.targetC ?? 0))?.targetC;
    return Number.isFinite(targetC) ? `Zonnedoel: ${number(targetC)} °C` : '';
  }));
  const sources = element('ul', 'room-sources');
  for (const id of room.sourceIds) {
    const source = config.sources.find(item => item.id === id);
    if (!source) continue;
    const row = element('li');
    row.append(element('span', '', source.name), liveText('span', 'muted', () => {
      const current = data.thermalReadings?.sources?.find(item => item.id === id);
      return climateStatus(current ?? {});
    }));
    sources.append(row);
  }
  if (!room.sourceIds.length) sources.append(element('li', 'muted', 'Geen warmtebron gekoppeld'));
  card.append(sources);
  return card;
}

function heatOverview() {
  const config = data.thermal ?? { mode: 'off', rooms: [], sources: [] };
  const live = data.thermalReadings ?? { rooms: [], sources: [] };
  const section = element('section', 'heat-overview');
  section.setAttribute('aria-label', 'Warmteoverzicht');
  const header = element('div', 'section-heading');
  const actions = element('div', 'rule-tools');
  actions.append(liveText('span', 'tag', () => ({ off: 'UIT', preview: 'PROEFMODUS', active: 'ACTIEF' }[data.thermal?.mode] ?? 'UIT')), toolButton('arrow-up-right', 'Warmte openen', () => navigate('thermal')));
  header.append(element('h2', '', 'Warmte in huis'), actions);
  section.append(header);
  const grid = element('div', 'heat-overview-grid');
  for (const floor of sortedFloors(config.rooms)) {
    for (const room of config.rooms.filter(room => room.floor === floor)) grid.append(roomCard(room, config, live, true));
  }
  if (config.rooms.length) section.append(grid);
  else section.append(element('p', 'empty-state', 'Nog geen kamers.'));
  main.append(section);
}

function thermal() {
  const config = data.thermal ?? { rooms: [], sources: [] };
  const live = data.thermalReadings ?? { rooms: [], sources: [] };
  const header = heading('Warmte in huis', data.demo ? 'Voorbeeldwoning · fictieve meetwaarden' : 'Kamers en warmtebronnen');
  header.append(toolButton('plus', 'Kamer toevoegen', () => editThermal('room')));
  const controls = element('div', 'rule-controlbar thermal-controls');
  const modeLabel = element('label', 'mapping-setting');
  modeLabel.htmlFor = 'thermal-mode';
  modeLabel.append(element('span', '', 'Warmteregelaar'));
  const mode = element('select'); mode.id = 'thermal-mode';
  for (const [value, title] of [['off', 'Uit'], ['preview', 'Proefmodus'], ['active', 'Actief']]) {
    const option = element('option', '', title); option.value = value;
    option.disabled = value === 'active' && !data.controlStatus?.activeAllowed; mode.append(option);
  }
  mode.value = config.mode ?? 'off'; modeLabel.append(mode);
  const saveMode = element('button', 'primary-button', 'Stand opslaan'); saveMode.prepend(icon('save'));
  const applyMode = async confirmed => {
    saveMode.disabled = true;
    try { await saveThermal({ ...data.thermal, mode: mode.value }, confirmed); notify('Warmtestand opgeslagen.'); }
    catch (error) { notify(error.message, true); }
    finally { saveMode.disabled = false; }
  };
  saveMode.addEventListener('click', () => {
    if (mode.value !== 'active') { applyMode(false); return; }
    const dialog = element('dialog', 'thermal-dialog'); dialog.setAttribute('aria-label', 'Warmtesturing bevestigen');
    dialog.append(element('h2', '', 'Warmtesturing activeren?'), element('p', '', 'De bevestigde warmtebronnen krijgen thermostaatdoelen en eventueel verwarmmodus. Controleer deze eerst in proefmodus.'));
    const actions = element('div', 'dialog-actions');
    actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
    const confirm = element('button', 'primary-button', 'Warmtesturing bevestigen'); confirm.prepend(icon('check'));
    confirm.addEventListener('click', () => { dialog.close(); applyMode(true); }); actions.append(confirm); dialog.append(actions);
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); createIcons({ icons }); dialog.showModal();
  });
  const pause = toolButton('pause', 'Warmte pauzeren', async () => {
    pause.disabled = true;
    try { const result = await api('thermal/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); data.thermal = result.thermal; await refresh(); render(); }
    catch (error) { notify(error.message, true); pause.disabled = false; }
  });
  controls.append(modeLabel, saveMode, pause); main.append(controls);
  if (!config.rooms.length) main.append(element('p', 'empty-state', 'Nog geen kamers.'));
  for (const floor of sortedFloors(config.rooms)) {
    const section = element('section', 'floor-section');
    const header = element('div', 'section-heading');
    header.append(element('h2', '', floor), toolButton('plus', `Kamer toevoegen op ${floor}`, () => editThermal('room', null, floor)));
    const grid = element('div', 'room-grid');
    for (const room of config.rooms.filter(room => room.floor === floor)) {
      grid.append(roomCard(room, config, live));
    }
    section.append(header, grid);
    main.append(section);
  }
  const sourceSection = element('section', 'source-section');
  const sourceHeader = element('div', 'section-heading');
  sourceHeader.append(element('h2', '', 'Warmtebronnen'), toolButton('plus', 'Warmtebron toevoegen', () => editThermal('source')));
  sourceSection.append(sourceHeader);
  for (const source of config.sources) {
    const row = element('div', 'heat-source-row');
    row.dataset.sourceId = source.id;
    const text = element('div');
    const profile = data.heatingProfiles?.find(profile => profile.id === source.profile);
    const rooms = config.rooms.filter(room => room.sourceIds.includes(source.id));
    text.append(element('strong', '', source.name), liveText('small', '', () => {
      const current = data.thermal?.sources.find(item => item.id === source.id);
      const liveSource = data.thermalReadings?.sources.find(item => item.id === source.id);
      return `${data.heatingProfiles?.find(item => item.id === current?.profile)?.name ?? 'Geen profiel'} · ${rooms.length} ${rooms.length === 1 ? 'kamer' : 'kamers'} · ${climateStatus(liveSource ?? {})}`;
    }));
    row.append(icon('heater'), text, toolButton('pencil', `${source.name} bewerken`, () => editThermal('source', source.id)));
    sourceSection.append(row);
  }
  if (!config.sources.length) sourceSection.append(element('p', 'empty-state', 'Nog geen warmtebronnen.'));
  main.append(sourceSection);
  const statusSection = element('section', 'rule-status'); statusSection.append(element('h2', '', 'Warmtebeoordeling'));
  const offStatus = liveText('p', 'muted', () => data.thermal?.mode === 'off' ? 'Warmteregelaar staat uit.' : '');
  bindLive(offStatus, () => { offStatus.hidden = data.thermal?.mode !== 'off'; offStatus.textContent = 'Warmteregelaar staat uit.'; });
  statusSection.append(offStatus);
  const thermalError = liveText('p', 'energy-warning', () => data.controlStatus?.error ?? '');
  bindLive(thermalError, () => { thermalError.hidden = !data.controlStatus?.error; thermalError.textContent = data.controlStatus?.error ?? ''; });
  statusSection.append(thermalError);
  for (const decision of data.controlStatus?.decisions?.filter(decision => decision.origin === 'thermal') ?? []) {
    const row = element('div', 'decision-row'); const text = element('div');
    text.append(element('strong', '', decision.name), liveText('p', 'subtitle', () => data.controlStatus?.decisions?.find(item => item.id === decision.id)?.reason ?? ''));
    const labels = { blocked: 'Geblokkeerd', stable: 'Op doel', planned: 'Gepland', sent: 'Verzonden', waiting: 'Wachten', paused: 'Gepauzeerd' };
    const decisionStatus = liveText('span', `room-status decision-${decision.status}`, () => {
      const current = data.controlStatus?.decisions?.find(item => item.id === decision.id);
      return labels[current?.status] ?? current?.status ?? '';
    });
    bindLive(decisionStatus, () => {
      const current = data.controlStatus?.decisions?.find(item => item.id === decision.id);
      decisionStatus.className = `room-status decision-${current?.status ?? 'blocked'}`;
      decisionStatus.textContent = labels[current?.status] ?? current?.status ?? '';
    });
    row.append(text, decisionStatus); statusSection.append(row);
  }
  main.append(statusSection);
}

function reportRoomTarget(roomId, result) {
  const config = result.thermal;
  if (config.mode !== 'active') { notify(`Kamerdoel opgeslagen; Warmte staat op ${{ off: 'Uit', preview: 'Proefmodus' }[config.mode] ?? config.mode} en stuurt niet.`); return; }
  const sources = config.sources.filter(source => source.controlRoomId === roomId && source.controlEnabled);
  const decisions = (result.controlStatus?.decisions ?? []).filter(decision => sources.some(source => source.id === decision.sourceId));
  const blocked = decisions.find(decision => ['blocked', 'paused', 'waiting'].includes(decision.status));
  if (blocked) { notify(`Kamerdoel opgeslagen; ${blocked.reason}`, true); return; }
  if (decisions.some(decision => decision.status === 'sent')) { notify('Doeltemperatuur naar thermostaat verstuurd; terugmelding volgt.'); return; }
  if (decisions.length && decisions.every(decision => decision.status === 'stable')) { notify('Doeltemperatuur bevestigd door thermostaat.'); return; }
  notify('Kamerdoel opgeslagen; kies een vrijgegeven warmtebron met deze kamer als regelkamer.', true);
}

async function saveThermal(config, confirmActive = false) {
  const result = await api('thermal', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Gridnest-Confirm-Control': String(confirmActive) }, body: JSON.stringify(config) });
  data.thermal = result.thermal;
  if (result.controlStatus) data.controlStatus = result.controlStatus;
  await refresh();
  render();
  return result;
}

function editThermal(kind, id = null, floor = '') {
  const isRoom = kind === 'room';
  const config = data.thermal ?? { rooms: [], sources: [] };
  const original = (isRoom ? config.rooms : config.sources).find(item => item.id === id);
  const dialog = element('dialog', 'thermal-dialog');
  const form = element('form');
  const header = element('div', 'section-heading');
  const title = element('h2', '', original ? `${isRoom ? 'Kamer' : 'Warmtebron'} bewerken` : `${isRoom ? 'Kamer' : 'Warmtebron'} toevoegen`);
  title.id = 'thermal-dialog-title';
  dialog.setAttribute('aria-labelledby', title.id);
  header.append(title, toolButton('x', 'Sluiten', () => dialog.close()));
  form.append(header);
  const fields = element('div', 'dialog-fields');
  function addField(name, title, input) {
    const label = element('label', 'mapping-setting');
    input.id = `thermal-${name}`;
    input.name = name;
    label.htmlFor = input.id;
    label.append(element('span', '', title), input);
    fields.append(label);
    return input;
  }
  function textField(name, title, value) {
    const input = element('input', 'text-input');
    input.type = 'text';
    input.maxLength = 80;
    input.required = true;
    input.value = value;
    return addField(name, title, input);
  }
  function entityField(name, title, value, filter) {
    const select = element('select');
    const empty = element('option', '', 'Niet gekoppeld');
    empty.value = '';
    select.append(empty);
    const candidates = data.entities.filter(filter);
    for (const entity of candidates) {
      const option = element('option', '', `${entity.name} (${entity.id})${entity.available ? '' : ' · niet beschikbaar'}`);
      option.value = entity.id;
      select.append(option);
    }
    if (value && !candidates.some(entity => entity.id === value)) {
      const option = element('option', '', `${value} · niet beschikbaar`);
      option.value = value;
      select.append(option);
    }
    select.value = value ?? '';
    return addField(name, title, select);
  }
  const nameInput = textField('name', 'Naam', original?.name ?? '');
  if (isRoom) {
    const floorSelect = element('select');
    floorSelect.required = true;
    for (const name of new Set(['Kelder', 'Begane grond', '1e verdieping', '2e verdieping', 'Zolder', ...config.rooms.map(room => room.floor)])) {
      const option = element('option', '', name);
      option.value = name;
      floorSelect.append(option);
    }
    floorSelect.value = original?.floor || floor || 'Begane grond';
    addField('floor', 'Verdieping', floorSelect);
    const target = element('input', 'text-input');
    target.type = 'number';
    target.min = 12;
    target.max = 26;
    target.step = 0.5;
    target.required = true;
    target.value = original?.targetC ?? data.preferences.comfortC;
    const tempSelect = entityField('temperatureEntity', 'Temperatuursensor / Thermostaat', original?.temperatureEntity, entity => (entity.domain === 'sensor' && entity.unit === '°C') || entity.domain === 'climate');
    tempSelect.addEventListener('change', () => {
      const selectedEnt = data.entities.find(e => e.id === tempSelect.value);
      if (selectedEnt?.domain === 'climate' && Number.isFinite(selectedEnt.targetTemperature)) {
        target.value = selectedEnt.targetTemperature;
        notify(`Doeltemperatuur overgenomen van thermostaat: ${number(selectedEnt.targetTemperature)} °C.`);
      }
    });
    if (!original && tempSelect.value) {
      const initEnt = data.entities.find(e => e.id === tempSelect.value);
      if (initEnt?.domain === 'climate' && Number.isFinite(initEnt.targetTemperature)) {
        target.value = initEnt.targetTemperature;
      }
    }
    entityField('presenceEntity', 'Aanwezigheidssensor', original?.presenceEntity, entity => ['person', 'device_tracker'].includes(entity.domain) || entity.domain === 'binary_sensor' && ['occupancy', 'presence'].includes(entity.deviceClass));
    const presenceLabel = element('label', 'checkbox-field');
    const presenceControl = element('input');
    presenceControl.type = 'checkbox'; presenceControl.name = 'presenceControl'; presenceControl.checked = original?.presenceControl ?? false;
    presenceLabel.append(presenceControl, element('span', '', 'Afwezigtemperatuur toepassen bij afwezigheid (kamer- of wenssensor)'));
    fields.append(presenceLabel);
    const away = element('input', 'text-input');
    away.type = 'number'; away.name = 'awayC'; away.min = 12; away.max = 24; away.step = 0.5;
    away.value = original?.awayC ?? '';
    addField('awayC', 'Afwezigtemperatuur (°C, leeg = Mijn wensen)', away);
    addField('targetC', 'Gewenste temperatuur (°C)', target);
    const sources = element('fieldset', 'source-choices');
    sources.append(element('legend', '', 'Warmtebronnen'));
    for (const source of config.sources) {
      const label = element('label', 'checkbox-field');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'sourceIds';
      checkbox.value = source.id;
      checkbox.checked = original?.sourceIds.includes(source.id) ?? false;
      label.append(checkbox, element('span', '', source.name));
      sources.append(label);
    }
    if (!config.sources.length) sources.append(element('p', 'muted', 'Geen warmtebronnen beschikbaar.'));
    fields.append(sources);
  } else {
    entityField('entityId', 'Verwarmingsentiteit', original?.entityId, entity => entity.domain === 'climate');
    const profileSelect = element('select');
    for (const profile of data.heatingProfiles ?? []) {
      const option = element('option', '', profile.name);
      option.value = profile.id;
      profileSelect.append(option);
    }
    profileSelect.value = original?.profile ?? 'unspecified';
    addField('profile', 'Afgiftesysteem', profileSelect);
    const advice = element('p', 'profile-advice');
    const updateAdvice = () => { advice.textContent = data.heatingProfiles?.find(profile => profile.id === profileSelect.value)?.advice ?? ''; };
    profileSelect.addEventListener('change', updateAdvice);
    updateAdvice();
    fields.append(advice);
    const controlRoom = element('select');
    const none = element('option', '', 'Geen regelkamer'); none.value = ''; controlRoom.append(none);
    for (const room of config.rooms.filter(room => room.sourceIds.includes(id))) {
      const option = element('option', '', `${room.name} · ${room.floor}`); option.value = room.id; controlRoom.append(option);
    }
    controlRoom.value = original?.controlRoomId ?? ''; addField('controlRoomId', 'Regelkamer voor deze bron', controlRoom);
    function checkField(name, title, checked) {
      const label = element('label', 'checkbox-field'); const input = element('input');
      input.type = 'checkbox'; input.name = name; input.id = `thermal-${name}`; input.checked = checked;
      label.append(input, element('span', '', title)); fields.append(label); return input;
    }
    checkField('controlEnabled', 'Deze bron regelen vanuit Warmte', original?.controlEnabled ?? false);
    checkField('confirmed', 'Thermostaatbediening en gekoppelde regelkamer gecontroleerd', original?.confirmed ?? false);
    function numericField(name, title, value, min, max, step) {
      const input = element('input', 'text-input'); Object.assign(input, { type: 'number', value, min, max, step, required: true });
      return addField(name, title, input);
    }
    numericField('priority', 'Bronprioriteit (1 = hoogste)', original?.priority ?? 50, 1, 100, 1);
    const solar = original?.solar ?? { enabled: false, powerEntity: null, boostC: 1, startW: 1500, stopW: 500, delayMinutes: 5, fromHour: 9, untilHour: 17 };
    const solarEnabled = checkField('solarEnabled', 'Voorverwarmen met zonnestroom (airco)', solar.enabled);
    const solarFields = element('div', 'solar-fields');
    const fieldsBefore = new Set(fields.children);
    entityField('solarPowerEntity', 'Eigen elektrisch aircovermogen (W of kW)', solar.powerEntity, entity => entity.domain === 'sensor' && ['W', 'kW'].includes(entity.unit));
    numericField('solarBoostC', 'Extra temperatuur (°C)', solar.boostC, 0.5, 2, 0.5);
    numericField('solarStartW', 'Startoverschot (W)', solar.startW, 200, 10000, 100);
    numericField('solarStopW', 'Stopoverschot (W)', solar.stopW, 0, 9900, 100);
    numericField('solarDelayMinutes', 'Start- en stopwachttijd (minuten)', solar.delayMinutes, 1, 60, 1);
    numericField('solarFromHour', 'Zonneperiode vanaf (uur)', solar.fromHour, 0, 23, 1);
    numericField('solarUntilHour', 'Zonneperiode tot (uur)', solar.untilHour, 1, 24, 1);
    for (const child of [...fields.children]) if (!fieldsBefore.has(child)) solarFields.append(child);
    fields.append(solarFields);
    const updateSolar = () => { solarEnabled.disabled = profileSelect.value !== 'airco'; if (solarEnabled.disabled) solarEnabled.checked = false; solarFields.hidden = !solarEnabled.checked; };
    profileSelect.addEventListener('change', updateSolar); solarEnabled.addEventListener('change', updateSolar); updateSolar();
  }
  const errorMessage = element('p', 'dialog-error');
  errorMessage.setAttribute('role', 'alert');
  errorMessage.hidden = true;
  const actions = element('div', 'dialog-actions');
  const save = element('button', 'primary-button', 'Opslaan');
  save.type = 'submit';
  save.prepend(icon('save'));
  if (original) {
    let confirmed = false;
    const remove = toolButton('trash-2', `${isRoom ? 'Kamer' : 'Warmtebron'} verwijderen`, async () => {
      if (!confirmed) {
        confirmed = true;
        remove.classList.add('confirm-delete');
        remove.title = 'Definitief verwijderen';
        remove.setAttribute('aria-label', 'Definitief verwijderen');
        errorMessage.textContent = isRoom ? 'Deze kamer verwijderen? Bevestig met de verwijderknop.' : 'Deze bron verwijderen en loskoppelen van alle kamers? Bevestig met de verwijderknop.';
        errorMessage.hidden = false;
        return;
      }
      remove.disabled = true;
      save.disabled = true;
      try {
        const next = structuredClone(data.thermal);
        if (isRoom) {
          next.rooms = next.rooms.filter(room => room.id !== id);
          next.sources = next.sources.map(source => source.controlRoomId === id ? { ...source, controlRoomId: null, controlEnabled: false, confirmed: false } : source);
        }
        else {
          next.sources = next.sources.filter(source => source.id !== id);
          next.rooms = next.rooms.map(room => ({ ...room, sourceIds: room.sourceIds.filter(sourceId => sourceId !== id) }));
        }
        await saveThermal(next);
        dialog.close();
        notify('Verwijderd.');
      } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
        remove.disabled = false;
        save.disabled = false;
      }
    });
    actions.append(remove);
  }
  actions.append(save);
  form.append(fields, errorMessage, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    errorMessage.hidden = true;
    try {
      const values = new FormData(form);
      const next = structuredClone(data.thermal ?? { rooms: [], sources: [] });
      const item = isRoom ? {
        id: id ?? createId(), name: values.get('name'), floor: values.get('floor'),
        temperatureEntity: values.get('temperatureEntity') || null, presenceEntity: values.get('presenceEntity') || null,
        targetC: Number(values.get('targetC')), presenceControl: values.has('presenceControl'),
        awayC: values.get('awayC') === '' ? null : Number(values.get('awayC')), sourceIds: values.getAll('sourceIds')
      } : { ...original, id: id ?? createId(), name: values.get('name'), entityId: values.get('entityId') || null, profile: values.get('profile') };
      if (!isRoom) {
        item.controlEnabled = values.has('controlEnabled'); item.confirmed = values.has('confirmed');
        item.controlRoomId = values.get('controlRoomId') || null; item.priority = Number(values.get('priority'));
        item.solar = { enabled: values.has('solarEnabled'), powerEntity: values.get('solarPowerEntity') || null,
          boostC: Number(values.get('solarBoostC')), startW: Number(values.get('solarStartW')), stopW: Number(values.get('solarStopW')),
          delayMinutes: Number(values.get('solarDelayMinutes')), fromHour: Number(values.get('solarFromHour')), untilHour: Number(values.get('solarUntilHour')) };
      }
      if (!isRoom && original && (original.entityId !== item.entityId || original.profile !== item.profile)) {
        item.controlEnabled = false;
        item.confirmed = false;
      }
      const key = isRoom ? 'rooms' : 'sources';
      next[key] = id ? next[key].map(existing => existing.id === id ? item : existing) : [...next[key], item];
      if (isRoom) next.sources = next.sources.map(source => source.controlRoomId === item.id && !item.sourceIds.includes(source.id) ? { ...source, controlRoomId: null, controlEnabled: false, confirmed: false } : source);
      const targetOnly = isRoom && original && onlyRoomTargetChanged(original, item);
      const result = await saveThermal(next, targetOnly && next.mode === 'active');
      dialog.close();
      if (targetOnly) reportRoomTarget(item.id, result);
      else notify(isRoom ? 'Kamer opgeslagen.' : 'Warmtebron opgeslagen.');
    } catch (error) {
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      save.disabled = false;
    }
  });
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  createIcons({ icons });
  dialog.showModal();
  nameInput.focus();
}

async function saveRules(control, confirmActive = false) {
  const result = await api('rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ control, confirmActive }) });
  data.control = result.control;
  controlDraft = structuredClone(result.control);
  if (result.controlStatus) data.controlStatus = result.controlStatus;
  await refresh();
  render();
}

function updateRuleStatus() {
  const container = document.querySelector('#rule-decisions');
  if (!container) return;
  const status = data.controlStatus;
  const findOrAdd = (selector, tag, className, parent = container) => {
    let node = parent.querySelector(`:scope > ${selector}`);
    if (!node) { node = element(tag, className); parent.append(node); }
    return node;
  };
  const updated = findOrAdd('.rule-last-update', 'p', 'muted rule-last-update');
  updated.hidden = !status?.updatedAt;
  updated.textContent = status?.updatedAt ? `Laatste beoordeling: ${formatTime(status.updatedAt)}` : '';
  const error = findOrAdd('.rule-live-error', 'p', 'energy-warning rule-live-error');
  error.hidden = !status?.error;
  error.textContent = status?.error ?? '';
  const off = findOrAdd('.rule-live-off', 'p', 'empty-state rule-live-off');
  off.hidden = data.control.mode !== 'off';
  off.textContent = 'Regelaar staat uit. Geen opdrachten worden uitgevoerd.';
  const rows = findOrAdd('.rule-live-rows', 'div', 'rule-live-rows');
  const labels = { blocked: 'Geblokkeerd', disabled: 'Uit', planned: 'Gepland', stable: 'Op doel', waiting: 'Wachten', paused: 'Gepauzeerd', sent: 'Verzonden' };
  const decisions = status?.decisions?.filter(decision => decision.origin !== 'thermal') ?? [];
  const liveIds = new Set(decisions.map(decision => decision.id));
  for (const row of [...rows.children]) if (!liveIds.has(row.dataset.decisionId)) row.remove();
  decisions.forEach((decision, index) => {
    let row = [...rows.children].find(item => item.dataset.decisionId === decision.id);
    if (!row) {
      row = element('div', 'decision-row');
      row.dataset.decisionId = decision.id;
      const copy = element('div');
      copy.append(element('strong', '', ''), element('small', 'muted', ''), element('p', 'subtitle', ''), element('small', 'muted', ''));
      row.append(copy, element('span', 'room-status'));
    }
    const current = rows.children[index];
    if (current !== row) rows.insertBefore(row, current ?? null);
    const [name, priority, reason, command] = row.firstElementChild.children;
    name.textContent = decision.name;
    priority.textContent = `Prioriteit ${decision.priority ?? 50}`;
    reason.textContent = decision.reason;
    command.textContent = decision.command ? `${decision.command.entityId} · ${decision.command.value ?? decision.command.service}` : '';
    command.hidden = !decision.command;
    const badge = row.lastElementChild;
    badge.className = `room-status decision-${decision.status}`;
    badge.textContent = labels[decision.status] ?? decision.status;
  });
  if (!decisions.length) {
    const empty = findOrAdd('.rule-live-empty', 'p', 'empty-state rule-live-empty', rows);
    empty.textContent = data.control.rules.length ? 'Geen actuele beslissingen.' : 'Nog geen regels.';
  } else {
    rows.querySelector('.rule-live-empty')?.remove();
  }
}

function rulesView() {
  const header = heading('Stroom', data.demo ? 'Laadpaal, thuisbatterij en zonnepanelen · demowoning' : data.connected ? 'Laadpaal, thuisbatterij en zonnepanelen' : 'Geen verbinding met Home Assistant');
  const actionGroup = element('div', 'page-heading-actions');
  const addBtn = toolButton('plus', 'Stroomregel toevoegen', () => editRule());
  const knmiBtn = element('button', 'secondary-button knmi-btn', 'KNMI weercoderegel');
  knmiBtn.type = 'button';
  knmiBtn.prepend(icon('cloud-lightning'));
  knmiBtn.addEventListener('click', () => editRule(null, 'knmi_weather'));
  actionGroup.append(addBtn, knmiBtn);
  header.append(actionGroup);
  const form = element('form', 'rule-settings');
  const modeLabel = element('label', 'mapping-setting');
  modeLabel.htmlFor = 'control-mode';
  modeLabel.append(element('span', '', 'Stand van de regelaar'));
  const mode = element('select');
  mode.id = 'control-mode';
  for (const [value, title] of [['off', 'Uit'], ['preview', 'Proefmodus'], ['active', 'Actief']]) {
    const option = element('option', '', title);
    option.value = value;
    option.disabled = value === 'active' && !data.controlStatus?.activeAllowed;
    mode.append(option);
  }
  mode.value = controlDraft.mode;
  mode.addEventListener('change', () => { controlDraft.mode = mode.value; });
  modeLabel.append(mode);
  const bar = element('div', 'rule-controlbar');
  const save = element('button', 'primary-button', 'Instellingen opslaan');
  save.type = 'submit';
  save.prepend(icon('save'));
  const evaluate = toolButton('play', 'Regels nu beoordelen', async () => {
    evaluate.disabled = true;
    try { const result = await api('rules/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); data.controlStatus = result.controlStatus; updateRuleStatus(); }
    catch (error) { notify(error.message, true); }
    finally { evaluate.disabled = false; }
  });
  const pause = toolButton('pause', 'Stroom pauzeren', async () => {
    pause.disabled = true;
    try { const result = await api('rules/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); data.control = result.control; controlDraft = structuredClone(result.control); await refresh(); render(); notify('Regelaar uitgeschakeld.'); }
    catch (error) { notify(error.message, true); pause.disabled = false; }
  });
  bar.append(modeLabel, save, evaluate, pause);
  form.append(bar);
  if (!data.controlStatus?.activeAllowed) form.append(element('p', 'muted', data.demo ? 'Echte sturing is geblokkeerd in demomodus.' : 'Echte sturing is niet vrijgegeven in de Home Assistant-app.'));
  const limits = element('details', 'control-limits');
  limits.append(element('summary', '', 'Grenzen en timing'));
  const fields = element('div', 'preference-fields');
  for (const [key, title, min, max, step] of [['maxAgeSeconds', 'Maximale meetouderdom (seconden)', 60, 86400, 60], ['minIntervalSeconds', 'Minimale opdrachttijd (seconden)', 30, 3600, 30], ['manualHoldMinutes', 'Pauze na handmatige wijziging (minuten)', 5, 1440, 5], ['reserveSoc', 'Accureserve (%)', 10, 90, 1], ['maxSoc', 'Maximale acculading (%)', 20, 100, 1]]) {
    const label = element('label', 'mapping-setting');
    label.htmlFor = `control-${key}`;
    label.append(element('span', '', title));
    const input = element('input', 'text-input');
    Object.assign(input, { id: `control-${key}`, type: 'number', min, max, step, required: true, value: controlDraft[key] });
    input.addEventListener('input', () => { controlDraft[key] = input.value === '' ? null : Number(input.value); });
    label.append(input);
    fields.append(label);
  }
  limits.append(fields);
  form.append(limits);
  const activate = async confirm => { save.disabled = true; try { await saveRules(controlDraft, confirm); notify('Regelinstellingen opgeslagen.'); } catch (error) { notify(error.message, true); } finally { save.disabled = false; } };
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (controlDraft.mode !== 'active') { activate(false); return; }
    const dialog = element('dialog', 'thermal-dialog');
    dialog.setAttribute('aria-label', 'Actieve sturing bevestigen');
    dialog.append(element('h2', '', 'Actieve sturing inschakelen?'), element('p', '', 'De ingeschakelde regels kunnen apparaten bedienen. Controleer de entiteiten, grenzen en opdrachten eerst in proefmodus.'));
    const actions = element('div', 'dialog-actions');
    actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
    const confirm = element('button', 'primary-button', 'Sturing bevestigen');
    confirm.prepend(icon('check'));
    confirm.addEventListener('click', () => { dialog.close(); activate(true); });
    actions.append(confirm);
    dialog.append(actions);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    createIcons({ icons });
    dialog.showModal();
  });
  main.append(form);
  const list = element('section', 'rules-list');
  list.append(element('h2', '', 'Stroomregels'));
  const operators = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', contains: 'bevat' };
  for (const rule of [...data.control.rules].sort((first, second) => (first.priority ?? 50) - (second.priority ?? 50))) {
    const row = element('article', 'saved-rule');
    const title = element('div', 'section-heading');
    const label = element('label', 'rule-enabled');
    const enabled = element('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled;
    enabled.addEventListener('change', async () => {
      enabled.disabled = true;
      const next = structuredClone(data.control);
      next.rules = next.rules.map(item => item.id === rule.id ? { ...item, enabled: enabled.checked } : item);
      try { await saveRules(next); notify('Regel bijgewerkt.'); } catch (error) { enabled.checked = rule.enabled; enabled.disabled = false; notify(error.message, true); }
    });
    label.append(enabled, element('h3', '', rule.name));
    const tools = element('div', 'rule-tools');
    tools.append(element('span', 'tag', `Prioriteit ${rule.priority ?? 50}`), toolButton('pencil', `${rule.name} bewerken`, () => editRule(rule.id)));
    title.append(label, tools);
    const conditions = rule.conditions.map(condition => { const entity = data.entities.find(entity => entity.id === condition.entityId); return `${entity?.name ?? condition.entityId} ${operators[condition.operator]} ${condition.value}${entity?.unit ? ` ${entity.unit}` : ''}`; });
    const type = data.actionTypes.find(type => type.id === rule.action.type);
    const actuator = data.entities.find(entity => entity.id === rule.action.entityId);
    const actionLabel = value => type.id === 'ev_enable' ? value === 'on' ? 'laden toestaan' : 'laden stoppen'
      : type.id === 'battery_enable' ? value === 'on' ? 'inschakelen / bijladen' : 'uitschakelen'
      : type.id === 'climate_mode' ? value === 'heat' ? 'verwarmmodus' : 'uitmodus'
      : type.id === 'battery_soc_limit' ? `${number(value)} %`
      : `${number(value)}${type.unit ? ` ${type.unit}` : ''}`;
    row.append(title, element('p', 'rule-summary', `Als ${conditions.join(' én ')}`), element('p', 'rule-summary', `Dan ${actionLabel(rule.action.value)} · anders ${actionLabel(rule.action.otherwise)}`), element('p', 'muted', `${type.name} · ${actuator?.name ?? rule.action.entityId}`));
    list.append(row);
  }
  if (!data.control.rules.length) list.append(element('p', 'empty-state', 'Nog geen regels.'));
  main.append(list);
  const status = element('section', 'rule-status');
  status.append(element('h2', '', 'Regelbeoordeling'), element('div', '', undefined));
  status.lastChild.id = 'rule-decisions';
  main.append(status);
  updateRuleStatus();
}

function editRule(id = null, presetType = 'ev_enable') {
  const original = data.control.rules.find(rule => rule.id === id);
  let draft;
  if (original) {
    draft = structuredClone(original);
  } else if (presetType === 'knmi_weather') {
    const weatherSensor = data.entities.find(e => e.id === 'sensor.thuis_weercode' || e.id.includes('weercode') || e.name.toLowerCase().includes('weercode'))?.id || 'sensor.thuis_weercode';
    const socSensor = data.mappings.batterySoc || data.mappings.batteries?.[0]?.socEntity || 'sensor.demo_battery_soc';
    const batSwitch = data.mappings.batteryEnable || data.mappings.batteries?.[0]?.switchEntity || 'switch.demo_battery_enable';
    draft = {
      id: createId(),
      name: 'KNMI Weeralarm · Accu bijladen',
      priority: 15,
      enabled: true,
      confirmed: false,
      conditions: [
        { entityId: weatherSensor, operator: 'contains', value: 'oranje, rood' },
        { entityId: socSensor, operator: 'lt', value: 80 }
      ],
      action: {
        type: 'battery_enable',
        entityId: batSwitch,
        value: 'on',
        otherwise: 'off',
        batteryDirection: 'positive-charge'
      }
    };
  } else {
    const initialAction = presetType === 'pv_limit' ? { type: presetType, entityId: data.mappings.solarLimit ?? '', value: 70, otherwise: 100, batteryDirection: 'positive-charge' }
      : presetType === 'battery_power' ? { type: presetType, entityId: '', value: 500, otherwise: 0, batteryDirection: 'positive-charge' }
        : presetType === 'battery_enable' ? { type: presetType, entityId: data.mappings.batteryEnable ?? '', value: 'on', otherwise: 'off', batteryDirection: 'positive-charge' }
          : { type: 'ev_enable', entityId: '', value: 'on', otherwise: 'off', batteryDirection: 'positive-charge' };
    draft = { id: createId(), name: presetType === 'pv_limit' ? 'Omvormer begrenzen' : '', priority: 50, enabled: false, confirmed: false, conditions: [{ entityId: '', operator: 'gt', value: 0 }], action: initialAction };
  }
  const dialog = element('dialog', 'thermal-dialog rule-dialog');
  dialog.setAttribute('aria-label', original ? 'Stroomregel bewerken' : 'Stroomregel toevoegen');
  const form = element('form');
  const header = element('div', 'section-heading');
  header.append(element('h2', '', original ? 'Stroomregel bewerken' : 'Stroomregel toevoegen'), toolButton('x', 'Sluiten', () => dialog.close()));
  form.append(header);
  function field(parent, title, input, id) {
    const label = element('label', 'mapping-setting');
    if (id) input.id = id;
    label.htmlFor = input.id;
    label.append(element('span', '', title), input);
    parent.append(label);
    return input;
  }
  function select(options, selected) {
    const input = element('select');
    for (const [value, title] of options) { const option = element('option', '', title); option.value = value; input.append(option); }
    input.value = selected;
    return input;
  }
  function entityPicker(parent, title, id, candidates, selected, changed) {
    const group = element('div', 'entity-picker');
    const searchLabel = element('label', 'entity-search');
    const search = element('input');
    search.type = 'search';
    search.id = `${id}-search`;
    search.placeholder = 'Zoek op naam of entiteit-ID';
    search.setAttribute('aria-label', `Zoek ${title.toLowerCase()}`);
    searchLabel.htmlFor = search.id;
    searchLabel.append(icon('search'), search);
    const input = element('select');
    input.required = true;
    let choice = selected;
    function populate() {
      input.replaceChildren();
      const matching = candidates.filter(entity => entity.id === choice || `${entity.name} ${entity.id}`.toLowerCase().includes(search.value.toLowerCase()));
      const empty = element('option', '', matching.length ? title === 'Meting' ? 'Kies een meting' : 'Kies een bedieningsentiteit' : 'Geen passende entiteiten gevonden');
      empty.value = '';
      input.append(empty);
      for (const entity of matching) {
        const option = element('option', '', `${entity.name} (${entity.id})${entity.unit ? ` · ${entity.unit}` : ''}${entity.available ? '' : ' · niet beschikbaar'}`);
        option.value = entity.id;
        input.append(option);
      }
      if (choice && !candidates.some(entity => entity.id === choice)) {
        const option = element('option', '', `${choice} · niet beschikbaar / niet passend`);
        option.value = choice;
        input.append(option);
      }
      input.value = choice;
    }
    search.addEventListener('input', populate);
    input.addEventListener('change', () => { choice = input.value; changed(choice); });
    group.append(searchLabel);
    field(group, title, input, id);
    parent.append(group);
    populate();
    return input;
  }
  function checkbox(title, checked, changed) {
    const label = element('label', 'checkbox-field');
    const input = element('input'); input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => changed(input.checked)); label.append(input, element('span', '', title)); form.append(label); return input;
  }
  const fields = element('div', 'dialog-fields');
  const name = element('input', 'text-input'); Object.assign(name, { type: 'text', maxLength: 80, required: true, value: draft.name });
  name.addEventListener('input', () => { draft.name = name.value; });
  field(fields, 'Regelnaam', name, 'rule-name');
  const priority = element('input', 'text-input');
  Object.assign(priority, { type: 'number', min: 1, max: 100, step: 1, required: true, value: draft.priority ?? 50 });
  priority.addEventListener('input', () => { draft.priority = priority.value === '' ? null : Number(priority.value); });
  field(fields, 'Prioriteit (1 = hoogste, 100 = laagste)', priority, 'rule-priority');
  const conditionSection = element('section', 'condition-section');
  const conditionHeader = element('div', 'section-heading');
  const addCondition = toolButton('plus', 'Voorwaarde toevoegen', () => { if (draft.conditions.length < 5) { draft.conditions.push({ entityId: '', operator: 'gt', value: 0 }); renderConditions(); } });
  conditionHeader.append(element('h3', '', 'Als alle voorwaarden kloppen'), addCondition);
  const conditions = element('div'); conditionSection.append(conditionHeader, conditions); fields.append(conditionSection);
  function renderConditions() {
    conditions.replaceChildren(); addCondition.disabled = draft.conditions.length >= 5;
    draft.conditions.forEach((condition, index) => {
      const row = element('div', 'condition-row');
      const candidates = data.entities.filter(entity => ['sensor', 'binary_sensor'].includes(entity.domain));
      entityPicker(row, 'Meting', `rule-sensor-${index}`, candidates, condition.entityId, selected => { condition.entityId = selected; renderValues(); });
      const valueFields = element('div', 'condition-values');
      function renderValues() {
        valueFields.replaceChildren();
        const entity = candidates.find(entity => entity.id === condition.entityId);
        const binary = entity?.domain === 'binary_sensor';
        const isTextCandidate = entity?.domain === 'sensor' && (!entity.unit || isNaN(Number(entity.state)));
        if (binary) condition.operator = 'eq';
        else if (!condition.operator || (isTextCandidate && ['gt', 'lt', 'gte', 'lte'].includes(condition.operator))) {
          condition.operator = isTextCandidate ? 'contains' : 'gt';
        }
        const ops = binary ? [['eq', 'Gelijk aan']] : [
          ['contains', 'Bevat tekst'],
          ['eq', 'Gelijk aan'],
          ['gt', 'Groter dan'],
          ['lt', 'Kleiner dan'],
          ['gte', 'Minimaal'],
          ['lte', 'Maximaal']
        ];
        const operator = select(ops, condition.operator);
        operator.addEventListener('change', () => { condition.operator = operator.value; renderValues(); });
        field(valueFields, 'Vergelijking', operator, `rule-operator-${index}`);

        let value;
        if (binary) {
          value = select([['on', 'Aan / aanwezig'], ['off', 'Uit / afwezig']], ['on', 'off'].includes(condition.value) ? condition.value : 'on');
          condition.value = value.value;
          value.addEventListener('change', () => { condition.value = value.value; });
        } else if (condition.operator === 'contains' || (condition.operator === 'eq' && typeof condition.value === 'string' && isNaN(Number(condition.value)))) {
          value = element('input', 'text-input');
          Object.assign(value, { type: 'text', maxLength: 80, required: true, value: typeof condition.value === 'string' ? condition.value : '' });
          condition.value = value.value;
          value.addEventListener('input', () => { condition.value = value.value; });
        } else {
          value = element('input', 'text-input');
          Object.assign(value, { type: 'number', step: 'any', required: true, value: typeof condition.value === 'number' ? condition.value : (Number(condition.value) || 0) });
          condition.value = Number(value.value);
          value.addEventListener('input', () => { condition.value = value.value === '' ? null : Number(value.value); });
        }
        field(valueFields, `Waarde${entity?.unit ? ` (${entity.unit})` : ''}`, value, `rule-value-${index}`);
      }
      renderValues(); row.append(valueFields);
      const remove = toolButton('trash-2', `Voorwaarde ${index + 1} verwijderen`, () => { draft.conditions.splice(index, 1); renderConditions(); });
      remove.disabled = draft.conditions.length === 1; row.append(remove); conditions.append(row);
    });
    createIcons({ icons });
  }
  renderConditions();
  const availableTypes = data.actionTypes;
  const type = select(availableTypes.map(type => [type.id, type.name]), draft.action.type);
  field(fields, 'Actie', type, 'rule-type');
  const actionFields = element('div', 'action-fields'); fields.append(actionFields);
  function renderAction() {
    actionFields.replaceChildren();
    const actionType = data.actionTypes.find(type => type.id === draft.action.type);
    const candidates = data.entities.filter(entity => entity.domain === actionType.domain && (
      entity.domain !== 'number'
      || (actionType.id === 'battery_power' ? ['W', 'kW'].includes(entity.unit) : actionType.id === 'battery_soc_limit' ? entity.unit === '%' : entity.unit === actionType.unit)
    ));
    entityPicker(actionFields, 'Bediening', 'rule-actuator', candidates, draft.action.entityId, selected => { draft.action.entityId = selected; draft.confirmed = false; confirmed.checked = false; });
    for (const [key, title] of [['value', 'Dan'], ['otherwise', 'Anders']]) {
      const binary = ['ev_enable', 'battery_enable', 'switch_control', 'climate_mode'].includes(actionType.id);
      const value = binary ? select(
        actionType.id === 'ev_enable' ? [['on', 'Laden toestaan'], ['off', 'Laden stoppen']]
        : actionType.id === 'battery_enable' ? [['on', 'Inschakelen / bijladen'], ['off', 'Uitschakelen / niet bijladen']]
        : actionType.id === 'switch_control' ? [['on', 'Inschakelen'], ['off', 'Uitschakelen']]
        : [['heat', 'Verwarmmodus'], ['off', 'Uitmodus']],
        draft.action[key]
      ) : element('input', 'text-input');
      if (!binary) Object.assign(value, { type: 'number', step: 'any', required: true, value: draft.action[key] });
      value.addEventListener(binary ? 'change' : 'input', () => { draft.action[key] = binary ? value.value : value.value === '' ? null : Number(value.value); });
      field(actionFields, `${title}${actionType.unit ? ` (${actionType.unit})` : ''}`, value, `rule-${key}`);
    }
    if (actionType.id === 'battery_power') {
      const direction = select([['positive-charge', 'Actuator positief = laden'], ['positive-discharge', 'Actuator positief = ontladen']], draft.action.batteryDirection);
      direction.addEventListener('change', () => { draft.action.batteryDirection = direction.value; draft.confirmed = false; confirmed.checked = false; });
      field(actionFields, 'Tekenrichting apparaat', direction, 'rule-batteryDirection');
      actionFields.append(element('p', 'muted', 'Regelwaarde in W: positief laden, negatief ontladen.'));
    }
    if (actionType.id === 'battery_soc_limit') {
      actionFields.append(element('p', 'muted', 'Stelt de maximale laadgrens of minimale ontlaadgrens van de accu (zoals number.ups_max_charge_level) in op basis van de voorwaarden.'));
    }
    if (actionType.id === 'switch_control') {
      actionFields.append(element('p', 'muted', 'Schakelt een willekeurige switch in Home Assistant (zoals boilers, slimme stekkers, pompen) in of uit.'));
    }
    if (actionType.id === 'pv_limit') actionFields.append(element('p', 'muted', '100% betekent volledige productie, niet volledige dimming.'));
    createIcons({ icons });
  }
  form.append(fields);
  checkbox('Regel ingeschakeld', draft.enabled, value => { draft.enabled = value; });
  const confirmed = checkbox('Ik heb bevestigd dat deze entiteit de genoemde functie bedient, niet de netvoeding van het apparaat.', draft.confirmed, value => { draft.confirmed = value; });
  type.addEventListener('change', () => { const definition = data.actionTypes.find(item => item.id === type.value); draft.action = { type: type.value, entityId: '', value: definition.initial, otherwise: definition.fallback, batteryDirection: 'positive-charge' }; draft.confirmed = false; confirmed.checked = false; renderAction(); });
  renderAction();
  const error = element('p', 'dialog-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = element('div', 'dialog-actions');
  const save = element('button', 'primary-button', 'Regel opslaan'); save.type = 'submit'; save.prepend(icon('save'));
  if (original) {
    let deleting = false;
    const remove = toolButton('trash-2', 'Regel verwijderen', async () => {
      if (!deleting) { deleting = true; remove.setAttribute('aria-label', 'Definitief verwijderen'); remove.title = 'Definitief verwijderen'; remove.classList.add('confirm-delete'); error.textContent = 'Deze regel verwijderen? Bevestig met de verwijderknop.'; error.hidden = false; return; }
      remove.disabled = save.disabled = true;
      try { const next = structuredClone(data.control); next.rules = next.rules.filter(rule => rule.id !== id); await saveRules(next); dialog.close(); notify('Regel verwijderd.'); }
      catch (failure) { error.textContent = failure.message; error.hidden = false; remove.disabled = save.disabled = false; }
    }); actions.append(remove);
  }
  actions.append(save); form.append(error, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; error.hidden = true;
    try {
      const next = structuredClone(data.control);
      next.rules = id ? next.rules.map(rule => rule.id === id ? draft : rule) : [...next.rules, draft];
      await saveRules(next); dialog.close(); notify('Regel opgeslagen.');
    } catch (failure) { error.textContent = failure.message; error.hidden = false; save.disabled = false; }
  });
  dialog.append(form); dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); createIcons({ icons }); dialog.showModal(); name.focus();
}

function entities() {
  heading('Entiteiten koppelen', data.demo ? 'Voorbeeldentiteiten · gescheiden van je echte woning' : `${data.entities.length} entiteiten beschikbaar uit Home Assistant`);

  // Centrale regelaarstand (Uit / Proefmodus / Actief) voor het hele systeem
  const systemCard = element('section', 'system-mode-card');
  const systemHeading = element('div', 'section-heading');
  const modeKey = data.control?.mode ?? 'off';
  const modeBadge = element('span', `tag ${modeKey === 'active' ? 'status-good' : modeKey === 'preview' ? 'status-warn' : 'status-neutral'}`,
    { off: 'UIT', preview: 'PROEFMODUS', active: 'ACTIEF' }[modeKey]);
  systemHeading.append(element('h2', '', 'Stand van Gridnest'), modeBadge);
  const systemHelp = element('p', 'subtitle', 'Geldt overkoepelend voor het hele systeem (Warmte, Stroom, Batterij en Laadpaal).');

  const modeControls = element('div', 'rule-controlbar');
  const modeLabel = element('label', 'mapping-setting');
  modeLabel.htmlFor = 'global-system-mode';
  modeLabel.append(element('span', '', 'Regelaarmodus'));
  const modeSelect = element('select');
  modeSelect.id = 'global-system-mode';
  for (const [val, title] of [['off', 'Uit'], ['preview', 'Proefmodus'], ['active', 'Actief']]) {
    const opt = element('option', '', title);
    opt.value = val;
    opt.disabled = val === 'active' && !data.controlStatus?.activeAllowed;
    modeSelect.append(opt);
  }
  modeSelect.value = modeKey;
  modeLabel.append(modeSelect);

  const saveModeBtn = element('button', 'primary-button', 'Stand toepassen');
  saveModeBtn.type = 'button';
  saveModeBtn.prepend(icon('save'));

  const applySystemMode = async confirmed => {
    saveModeBtn.disabled = true;
    try {
      const res = await api('system/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: modeSelect.value, confirm: confirmed })
      });
      data.control = res.control;
      data.thermal = res.thermal;
      data.controlStatus = res.controlStatus;
      controlDraft = structuredClone(res.control);
      notify(`Gridnest stand gewijzigd naar ${{ off: 'Uit', preview: 'Proefmodus', active: 'Actief' }[res.mode]}.`);
      await refresh();
      render();
    } catch (err) {
      notify(err.message, true);
    } finally {
      saveModeBtn.disabled = false;
    }
  };

  saveModeBtn.addEventListener('click', () => {
    if (modeSelect.value === 'active') {
      const dialog = element('dialog', 'thermal-dialog');
      dialog.setAttribute('aria-label', 'Actieve sturing bevestigen');
      dialog.append(
        element('h2', '', 'Actieve sturing inschakelen?'),
        element('p', '', 'De ingeschakelde regels en warmtebronnen kunnen apparaten in huis daadwerkelijk bedienen. Controleer alle entiteiten en koppelingen eerst in proefmodus.')
      );
      const actions = element('div', 'dialog-actions');
      actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
      const confirm = element('button', 'primary-button', 'Actief inschakelen');
      confirm.prepend(icon('check'));
      confirm.addEventListener('click', () => {
        dialog.close();
        applySystemMode(true);
      });
      actions.append(confirm);
      dialog.append(actions);
      dialog.addEventListener('close', () => dialog.remove());
      document.body.append(dialog);
      createIcons({ icons });
      dialog.showModal();
    } else {
      applySystemMode(false);
    }
  });

  modeControls.append(modeLabel, saveModeBtn);
  systemCard.append(systemHeading, systemHelp, modeControls);
  if (!data.controlStatus?.activeAllowed) {
    systemCard.append(element('p', 'muted', data.demo ? 'Echte sturing is geblokkeerd in demomodus.' : 'Echte sturing vereist apparaatvrijgave in de Home Assistant-app.'));
  }

  const form = element('form', 'entity-form');
  form.append(systemCard);
  const settings = element('div', 'mapping-settings');
  function mappingSetting(key, title, options) {
    const label = element('label', 'mapping-setting');
    label.htmlFor = `mapping-${key}`;
    label.append(element('span', '', title));
    const select = element('select');
    select.id = `mapping-${key}`;
    for (const [value, title] of options) {
      const option = element('option', '', title);
      option.value = value;
      select.append(option);
    }
    select.value = mappingsDraft[key];
    select.disabled = !data.connected && !data.demo;
    select.addEventListener('change', () => { mappingsDraft[key] = select.value; render(); });
    label.append(select);
    settings.append(label);
  }
  mappingSetting('gridMode', 'Netsensor', [['separate', 'Afname en teruglevering apart'], ['signed', 'Eén sensor met positief en negatief vermogen']]);
  if (mappingsDraft.gridMode === 'signed') mappingSetting('gridDirection', 'Tekenrichting netvermogen', [['positive-import', 'Positief = netafname; negatief = export'], ['positive-export', 'Positief = export; negatief = netafname']]);
  mappingSetting('batteryMode', 'Batterij in de woning', [['unknown', 'Nog niet aangegeven'], ['none', 'Geen batterij aanwezig'], ['measured', 'Batterij aanwezig, vermogen meten']]);
  if (mappingsDraft.batteryMode === 'measured') mappingSetting('batteryDirection', 'Tekenrichting batterijvermogen', [['positive-charge', 'Positief = laden; negatief = ontladen'], ['positive-discharge', 'Positief = ontladen; negatief = laden']]);
  mappingSetting('evMode', 'Laadpaal bij de woning', [['unknown', 'Nog niet aangegeven'], ['none', 'Geen laadpaal aanwezig'], ['present', 'Laadpaal aanwezig']]);
  mappingSetting('solarTodayMode', 'Bron zonneopbrengst vandaag', [['daily', 'Dagmeter (reset dagelijks)'], ['total', 'Cumulatieve totaalmeter (verschil sinds middernacht)']]);
  mappingSetting('knownSource', 'Bekende verbruikers', [['individual', 'Afzonderlijke apparaatmetingen optellen'], ['aggregate', 'Eén bestaande bekende-verbruikstotaalsensor']]);
  form.append(settings);
  const toolbar = element('div', 'entity-toolbar');
  const searchLabel = element('label', 'search-field');
  const input = element('input');
  input.type = 'search';
  input.placeholder = 'Zoek op naam of entiteit';
  input.setAttribute('aria-label', 'Zoek entiteiten');
  input.value = search;
  searchLabel.append(icon('search'), input);
  toolbar.append(searchLabel, element('span', 'muted', 'Optionele koppelingen'));
  form.append(toolbar);
  const list = element('div', 'entity-list');
  function consumerSwitchSetting(row, consumerId) {
    const label = element('label', 'consumer-switch-setting');
    label.htmlFor = `consumer-switch-${consumerId}`;
    label.append(element('span', '', 'Aan/uitschakelaar'));
    const select = element('select');
    select.id = label.htmlFor;
    const empty = element('option', '', 'Niet gekoppeld');
    empty.value = '';
    select.append(empty);
    const selected = mappingsDraft.knownConsumerSwitches?.[consumerId];
    const candidates = data.entities.filter(entity => entity.domain === 'switch');
    for (const entity of candidates) {
      const option = element('option', '', `${entity.name} (${entity.id})${entity.available ? '' : ' · niet beschikbaar'}`);
      option.value = entity.id;
      select.append(option);
    }
    if (selected && !candidates.some(entity => entity.id === selected)) {
      const missing = element('option', '', `${selected} · niet beschikbaar`);
      missing.value = selected;
      select.append(missing);
    }
    select.value = selected ?? '';
    select.disabled = !data.connected && !data.demo;
    select.addEventListener('change', () => {
      mappingsDraft.knownConsumerSwitches ??= {};
      if (select.value) mappingsDraft.knownConsumerSwitches[consumerId] = select.value;
      else delete mappingsDraft.knownConsumerSwitches[consumerId];
    });
    label.append(select);
    row.append(label);
  }
  function buildRows() {
    list.replaceChildren();
    const groups = new Map();
    for (const role of data.roles) {
      if (role.id === 'presence') continue;
      if (['gridImport', 'gridExport'].includes(role.id) && mappingsDraft.gridMode === 'signed') continue;
      if (role.id === 'gridPower' && mappingsDraft.gridMode !== 'signed') continue;
      if (mappingsDraft.batteryMode === 'none' && role.id.startsWith('battery')) continue;
      if (role.id === 'batteryPower' && mappingsDraft.batteryMode !== 'measured') continue;
      if (mappingsDraft.evMode === 'none' && role.id.startsWith('ev')) continue;
      if (role.id === 'knownConsumption' && mappingsDraft.knownSource !== 'aggregate') continue;
      const row = element('div', 'entity-row');
      const label = element('label', 'entity-label');
      label.htmlFor = `entity-${role.id}`;
      const copy = element('span');
      const roleHint = role.units.length ? role.units.join(' / ') : role.domain === 'climate' ? 'Climate-entiteit'
        : role.domain === 'binary_sensor' ? 'Statussensor' : role.domain === 'lock' ? 'Vergrendeling'
          : role.domain === 'switch' ? 'Schakelaar' : 'Status';
      copy.append(element('strong', '', role.name), element('small', '', roleHint));
      if (role.id === 'totalConsumption') copy.append(element('small', '', 'Optioneel bij complete energiebalans'));
      label.append(icon(role.icon), copy);
      const select = element('select');
      select.id = `entity-${role.id}`;
      const empty = element('option', '', 'Niet gekoppeld');
      empty.value = '';
      select.append(empty);
      const candidates = data.entities.filter(entity => isCompatibleEntity(role, entity));
      for (const entity of candidates) {
        if (entity.id !== mappingsDraft[role.id] && !`${entity.name} ${entity.id}`.toLowerCase().includes(search.toLowerCase())) continue;
        const option = element('option', '', `${entity.name} (${entity.id})${entity.available ? '' : ' · niet beschikbaar'}`);
        option.value = entity.id;
        select.append(option);
      }
      if (mappingsDraft[role.id] && !candidates.some(entity => entity.id === mappingsDraft[role.id])) {
        const unavailable = element('option', '', `${mappingsDraft[role.id]} · niet beschikbaar`);
        unavailable.value = mappingsDraft[role.id];
        select.append(unavailable);
      }
      select.value = mappingsDraft[role.id] || '';
      select.disabled = !data.connected && !data.demo;
      select.addEventListener('change', () => { mappingsDraft[role.id] = select.value || null; });
      row.append(label, select);
      const group = role.id.startsWith('ev') ? 'Laadpaal'
        : role.id.startsWith('battery') ? 'Hoofdbatterij'
          : role.id.startsWith('solar') ? 'Zonnepanelen'
            : role.id.startsWith('grid') || role.id.startsWith('phase') ? 'Net & fasen'
              : ['gasConsumption', 'waterConsumption'].includes(role.id) ? 'Gas & water'
                : ['temperature', 'climate'].includes(role.id) ? 'Warmte' : 'Verbruikers';
      if (!groups.has(group)) {
        const section = element('section', 'mapping-group');
        section.append(element('h2', '', group));
        groups.set(group, section);
      }
      groups.get(group).append(row);
    }
    if (groups.has('Hoofdbatterij')) {
      const batteryGroup = groups.get('Hoofdbatterij');
      const multiSec = element('div', 'multi-batteries-section');
      multiSec.append(element('h3', '', 'Extra batterijsystemen'), element('p', 'subtitle', 'Koppel extra thuisaccu’s en kies of ze op de startpagina worden weergegeven.'));
      mappingsDraft.batteries ??= [];
      mappingsDraft.batteries.forEach((bat, idx) => {
        const card = element('div', 'battery-config-card');
        const header = element('div', 'battery-config-header');
        const nameInput = element('input', 'text-input');
        nameInput.type = 'text';
        nameInput.value = bat.name;
        nameInput.placeholder = `Batterij ${idx + 1}`;
        nameInput.addEventListener('input', () => { bat.name = nameInput.value.trim() || `Batterij ${idx + 1}`; });

        const showLabel = element('label', 'checkbox-field');
        const showCheck = element('input');
        showCheck.type = 'checkbox';
        showCheck.checked = bat.showOnOverview !== false;
        showCheck.addEventListener('change', () => { bat.showOnOverview = showCheck.checked; });
        showLabel.append(showCheck, element('span', '', 'Op startpagina tonen'));

        const removeBtn = toolButton('trash-2', 'Batterij verwijderen', () => {
          mappingsDraft.batteries.splice(idx, 1);
          buildRows();
        });
        header.append(nameInput, showLabel, removeBtn);

        const fields = element('div', 'battery-config-fields');
        const makeSelectField = (labelTitle, domain, units, key) => {
          const lbl = element('label');
          lbl.append(element('span', '', labelTitle));
          const sel = element('select');
          const empty = element('option', '', 'Niet gekoppeld');
          empty.value = '';
          sel.append(empty);
          const filterFn = e => (domain ? e.domain === domain : true) && (!units?.length || units.includes(e.unit));
          for (const ent of data.entities.filter(filterFn)) {
            const opt = element('option', '', `${ent.name} (${ent.id})`);
            opt.value = ent.id;
            sel.append(opt);
          }
          sel.value = bat[key] || '';
          sel.addEventListener('change', () => { bat[key] = sel.value || null; });
          lbl.append(sel);
          return lbl;
        };

        fields.append(
          makeSelectField('Laadtoestand (%)', 'sensor', ['%'], 'socEntity'),
          makeSelectField('Vermogen (W / kW)', 'sensor', ['W', 'kW'], 'powerEntity'),
          makeSelectField('Input vermogen (W / kW)', 'sensor', ['W', 'kW'], 'inputEntity'),
          makeSelectField('Output vermogen (W / kW)', 'sensor', ['W', 'kW'], 'outputEntity'),
          makeSelectField('Resterende tijd', 'sensor', ['h', 'min', 's'], 'remainingEntity'),
          makeSelectField('State of health (%)', 'sensor', ['%'], 'healthEntity'),
          makeSelectField('Aan/uit schakelaar', 'switch', [], 'switchEntity'),
          makeSelectField('Laadstatus / doorvoer', 'sensor', [], 'chargingStateEntity'),
          makeSelectField('Minimum batterijniveau (%)', 'number', ['%'], 'minLevelEntity'),
          makeSelectField('Maximum batterijniveau (%)', 'number', ['%'], 'maxLevelEntity')
        );
        card.append(header, fields);
        multiSec.append(card);
      });

      if (mappingsDraft.batteries.length < 4) {
        const addBtn = element('button', 'secondary-button add-battery-btn', `Batterijsysteem toevoegen (${mappingsDraft.batteries.length}/4)`);
        addBtn.type = 'button';
        addBtn.prepend(icon('plus'));
        addBtn.addEventListener('click', () => {
          mappingsDraft.batteries.push({
            id: `bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: `Batterij ${mappingsDraft.batteries.length + 1}`,
            socEntity: null,
            powerEntity: null,
            inputEntity: null,
            outputEntity: null,
            remainingEntity: null,
            healthEntity: null,
            switchEntity: null,
            showOnOverview: true
          });
          buildRows();
        });
        multiSec.append(addBtn);
      } else {
        multiSec.append(element('p', 'muted', 'Maximaal 4 batterijsystemen ondersteund.'));
      }
      batteryGroup.append(multiSec);
    }
    for (const title of ['Net & fasen', 'Zonnepanelen', 'Hoofdbatterij', 'Laadpaal', 'Warmte', 'Gas & water', 'Verbruikers']) {
      if (groups.has(title)) list.append(groups.get(title));
    }
    if (mappingsDraft.knownSource === 'individual') {
      const section = element('section', 'consumer-selection');
      section.append(element('h2', '', 'Bekende apparaten'), element('p', 'subtitle', 'Niet-overlappende apparaatmetingen · geen groepmeter samen met onderliggende apparaten'));
      const selected = mappingsDraft.knownConsumers ?? [];
      const excluded = ['totalConsumption', 'knownConsumption', 'gridPower', 'gridImport', 'gridExport', 'solar', 'batteryPower'].map(role => mappingsDraft[role]);
      const candidates = data.entities.filter(entity => entity.domain === 'sensor' && ['W', 'kW'].includes(entity.unit) &&
        (selected.includes(entity.id) || (!excluded.includes(entity.id) && `${entity.name} ${entity.id}`.toLowerCase().includes(search.toLowerCase()))));
      const choices = element('div', 'known-consumer-choices');
      for (const entity of candidates) {
        const row = element('div', 'known-consumer-row');
        const label = element('label', 'consumer-choice');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.value = entity.id;
        checkbox.checked = selected.includes(entity.id);
        checkbox.disabled = !data.connected && !data.demo;
        checkbox.addEventListener('change', () => {
          const next = new Set(mappingsDraft.knownConsumers ?? []);
          if (checkbox.checked) next.add(entity.id);
          else {
            next.delete(entity.id);
            delete mappingsDraft.knownConsumerNames?.[entity.id];
            delete mappingsDraft.knownConsumerSwitches?.[entity.id];
          }
          mappingsDraft.knownConsumers = [...next];
          buildRows();
        });
        const text = element('span');
        text.append(element('strong', '', entity.name), element('small', '', `${entity.id}${entity.available ? '' : ' · niet beschikbaar'}`));
        label.append(checkbox, text);
        row.append(label);
        if (selected.includes(entity.id)) {
          const nameLabel = element('label', 'consumer-name-setting');
          nameLabel.append(element('span', '', 'Eigen naam'));
          const nameInput = element('input', 'text-input');
          Object.assign(nameInput, { type: 'text', maxLength: 80, value: mappingsDraft.knownConsumerNames?.[entity.id] ?? '', placeholder: entity.name });
          nameInput.setAttribute('aria-label', `Eigen naam voor ${entity.name}`);
          nameInput.addEventListener('input', () => {
            mappingsDraft.knownConsumerNames ??= {};
            if (nameInput.value.trim()) mappingsDraft.knownConsumerNames[entity.id] = nameInput.value;
            else delete mappingsDraft.knownConsumerNames[entity.id];
          });
          nameLabel.append(nameInput);
          row.append(nameLabel);
          consumerSwitchSetting(row, entity.id);
        }
        choices.append(row);
      }
      for (const id of selected.filter(id => !candidates.some(entity => entity.id === id))) {
        const row = element('div', 'known-consumer-row');
        const label = element('label', 'consumer-choice');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          mappingsDraft.knownConsumers = (mappingsDraft.knownConsumers ?? []).filter(value => value !== id);
          delete mappingsDraft.knownConsumerNames?.[id];
          delete mappingsDraft.knownConsumerSwitches?.[id];
          buildRows();
        });
        label.append(checkbox, element('span', '', `${id} · niet beschikbaar`));
        const nameLabel = element('label', 'consumer-name-setting');
        nameLabel.append(element('span', '', 'Eigen naam'));
        const nameInput = element('input', 'text-input');
        Object.assign(nameInput, { type: 'text', maxLength: 80, value: mappingsDraft.knownConsumerNames?.[id] ?? '', placeholder: id });
        nameInput.setAttribute('aria-label', `Eigen naam voor ${id}`);
        nameInput.addEventListener('input', () => {
          mappingsDraft.knownConsumerNames ??= {};
          if (nameInput.value.trim()) mappingsDraft.knownConsumerNames[id] = nameInput.value;
          else delete mappingsDraft.knownConsumerNames[id];
        });
        nameLabel.append(nameInput);
        row.append(label, nameLabel);
        consumerSwitchSetting(row, id);
        choices.append(row);
      }
      if (!choices.childElementCount) choices.append(element('p', 'muted', 'Geen passende apparaatmetingen gevonden.'));
      section.append(choices);
      list.append(section);
    }
    createIcons({ icons });
  }
  input.addEventListener('input', () => { search = input.value; buildRows(); });
  buildRows();
  const actions = element('div', 'form-actions');
  const save = element('button', 'primary-button', 'Koppelingen opslaan');
  save.type = 'submit';
  save.disabled = !data.connected && !data.demo;
  save.prepend(icon('save'));
  actions.append(save);
  form.append(list, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      await api('mappings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mappingsDraft) });
      notify('Koppelingen opgeslagen.');
      await refresh();
    } catch (error) { notify(error.message, true); }
    finally { save.disabled = !data.connected && !data.demo; }
  });
  main.append(form);
}

function preferences() {
  heading('Mijn wensen', 'Comfort, aanwezigheid en energiebehoefte');
  const form = element('form', 'preferences-form');
  const presenceSection = element('section', 'preference-section');
  presenceSection.append(element('h2', '', 'Aanwezigheid huishouden'));
  const modeLabel = element('label', 'mapping-setting');
  modeLabel.htmlFor = 'pref-presenceMode'; modeLabel.append(element('span', '', 'Wanneer geldt aanwezigheid?'));
  const presenceMode = element('select'); presenceMode.id = 'pref-presenceMode';
  for (const [value, title] of [['any', 'Minstens één persoon thuis'], ['all', 'Iedereen thuis']]) {
    const option = element('option', '', title); option.value = value; presenceMode.append(option);
  }
  presenceMode.value = preferencesDraft.presenceMode ?? 'any';
  presenceMode.addEventListener('change', () => { preferencesDraft.presenceMode = presenceMode.value; });
  modeLabel.append(presenceMode); presenceSection.append(modeLabel);
  const searchLabel = element('label', 'search-field presence-search');
  const peopleSearch = element('input'); peopleSearch.type = 'search'; peopleSearch.placeholder = 'Zoek personen of aanwezigheidssensoren'; peopleSearch.setAttribute('aria-label', 'Zoek personen');
  searchLabel.append(icon('search'), peopleSearch); presenceSection.append(searchLabel);
  const people = element('div', 'consumer-choices');
  function renderPeople() {
    people.replaceChildren();
    const selected = preferencesDraft.presenceEntities ?? [];
    const candidates = data.entities.filter(entity => ['person', 'device_tracker'].includes(entity.domain) || entity.domain === 'binary_sensor' && ['occupancy', 'presence'].includes(entity.deviceClass));
    const choices = candidates.filter(entity => selected.includes(entity.id) || `${entity.name} ${entity.id}`.toLowerCase().includes(peopleSearch.value.toLowerCase()));
    for (const id of selected.filter(id => !candidates.some(entity => entity.id === id))) choices.push({ id, name: id, available: false });
    for (const entity of choices) {
      const label = element('label', 'consumer-choice');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.value = entity.id; checkbox.checked = selected.includes(entity.id);
      checkbox.addEventListener('change', () => {
        const next = new Set(preferencesDraft.presenceEntities ?? []);
        if (checkbox.checked) next.add(entity.id); else next.delete(entity.id);
        preferencesDraft.presenceEntities = [...next];
      });
      let state = 'Onbekend';
      if (entity.available && ['person', 'device_tracker'].includes(entity.domain) && entity.state && !['unknown', 'unavailable'].includes(entity.state)) state = entity.state === 'home' ? 'Thuis' : 'Niet thuis';
      if (entity.available && entity.domain === 'binary_sensor' && ['on', 'off'].includes(entity.state)) state = entity.state === 'on' ? 'Aanwezig' : 'Afwezig';
      const text = element('span'); text.append(element('strong', '', entity.name), element('small', '', `${entity.id} · ${state}`));
      label.append(checkbox, text); people.append(label);
    }
    if (!choices.length) people.append(element('p', 'muted', 'Geen passende personen of aanwezigheidssensoren gevonden.'));
  }
  peopleSearch.addEventListener('input', renderPeople); renderPeople(); presenceSection.append(people); form.append(presenceSection);
  const profileSection = element('section', 'preference-section');
  profileSection.append(element('h2', '', 'Verwarmingsprofiel'));
  const profileLabel = element('label', 'mapping-setting');
  profileLabel.htmlFor = 'pref-heatingProfile';
  profileLabel.append(element('span', '', 'Afgiftesysteem'));
  const profileSelect = element('select');
  profileSelect.id = 'pref-heatingProfile';
  for (const profile of data.heatingProfiles ?? []) {
    const option = element('option', '', profile.name);
    option.value = profile.id;
    profileSelect.append(option);
  }
  profileSelect.value = preferencesDraft.heatingProfile || 'unspecified';
  const advice = element('p', 'profile-advice');
  const updateAdvice = () => {
    advice.textContent = data.heatingProfiles?.find(profile => profile.id === profileSelect.value)?.advice ?? '';
  };
  profileSelect.addEventListener('change', () => { preferencesDraft.heatingProfile = profileSelect.value; updateAdvice(); });
  updateAdvice();
  profileLabel.append(profileSelect);
  profileSection.append(profileLabel, advice);
  form.append(profileSection);
  const utilitySection = element('section', 'preference-section');
  utilitySection.append(element('h2', '', 'Verbruiksmeters'), element('p', 'subtitle', 'Toon optionele gas- en watermeters op het overzicht.'));
  for (const [key, title] of [
    ['showGas', 'Gasverbruik tonen'],
    ['showWater', 'Waterverbruik tonen'],
    ['showBatteries', 'Batterijenoverzicht tonen op startpagina'],
    ['confirmSwitches', 'Bevestiging vragen bij handmatig schakelen']
  ]) {
    const label = element('label', 'checkbox-field');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = Boolean(preferencesDraft[key] ?? (['confirmSwitches', 'showBatteries'].includes(key) ? true : false));
    input.addEventListener('change', () => { preferencesDraft[key] = input.checked; });
    label.append(input, element('span', '', title));
    utilitySection.append(label);
  }
  form.append(utilitySection);
  const refreshSection = element('section', 'preference-section');
  refreshSection.append(element('h2', '', 'Metingen verversen'));
  const refreshLabel = element('label', 'mapping-setting');
  refreshLabel.htmlFor = 'pref-refreshSeconds';
  refreshLabel.append(element('span', '', 'Verversingsinterval'));
  const refreshSelect = element('select');
  refreshSelect.id = 'pref-refreshSeconds';
  for (const [seconds, title] of [[1, 'Elke seconde'], [5, 'Elke 5 seconden'], [10, 'Elke 10 seconden'], [30, 'Elke 30 seconden'], [60, 'Elke 60 seconden'], [0, 'Alleen handmatig']]) {
    const option = element('option', '', title);
    option.value = seconds;
    refreshSelect.append(option);
  }
  refreshSelect.value = preferencesDraft.refreshSeconds ?? 10;
  refreshSelect.addEventListener('change', () => { preferencesDraft.refreshSeconds = Number(refreshSelect.value); });
  refreshLabel.append(refreshSelect);
  refreshSection.append(refreshLabel);
  form.append(refreshSection);
  const sections = [
    ['Warmte & aanwezigheid', [['comfortC', 'Comforttemperatuur', '°C', 16, 24, 0.5], ['awayC', 'Temperatuur bij afwezigheid', '°C', 12, 24, 0.5], ['occupiedFrom', 'Aanwezig vanaf', 'uur', 0, 23, 1], ['occupiedUntil', 'Aanwezig tot', 'uur', 1, 24, 1]]],
    ['Stroom & laden', [['gridLimitKw', 'Maximale netafname', 'kW', 1, 25, 0.1], ['evEnergyKwh', 'Gewenste laadenergie', 'kWh', 0, 100, 1], ['deadlineHours', 'Laden gereed binnen', 'uur', 1, 24, 1]]]
  ];
  for (const [title, fields] of sections) {
    const section = element('section', 'preference-section');
    section.append(element('h2', '', title));
    const fieldsContainer = element('div', 'preference-fields');
    for (const [key, title, unit, minimum, maximum, step] of fields) {
      const label = element('label', 'number-field');
      label.htmlFor = `pref-${key}`;
      label.append(element('span', '', title));
      const inputGroup = element('div', 'input-unit');
      const input = element('input');
      input.id = `pref-${key}`;
      input.name = key;
      input.type = 'number';
      input.min = minimum;
      input.max = maximum;
      input.step = step;
      input.required = true;
      input.value = preferencesDraft[key];
      input.addEventListener('input', () => { preferencesDraft[key] = input.value === '' ? null : Number(input.value); });
      inputGroup.append(input, element('span', '', unit));
      label.append(inputGroup);
      fieldsContainer.append(label);
    }
    section.append(fieldsContainer);
    form.append(section);
  }
  const checkboxLabel = element('label', 'checkbox-field');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.checked = preferencesDraft.preferSolar;
  checkbox.addEventListener('change', () => { preferencesDraft.preferSolar = checkbox.checked; });
  checkboxLabel.append(checkbox, element('span', '', 'Voorkeur voor eigen zonnestroom'));
  const actions = element('div', 'form-actions');
  const save = element('button', 'primary-button', 'Wensen opslaan');
  save.type = 'submit';
  save.prepend(icon('save'));
  actions.append(save);
  form.append(checkboxLabel, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      await api('preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferencesDraft) });
      notify('Wensen opgeslagen.');
      await refresh();
    } catch (error) { notify(error.message, true); }
    finally { save.disabled = false; }
  });
  main.append(form);
}

async function utilityHistoryData(utility, entityId, reload = false) {
  const key = `${utility}:${entityId}`;
  const cached = utilityHistoryCache[key];
  if (!reload && cached && Date.now() - cached.fetchedAt <= 30000) return cached;
  if (!utilityHistoryRequests[key]) {
    utilityHistoryRequests[key] = api(`utility-history/${utility}`, reload ? { cache: 'no-store' } : {}).then(result => {
      utilityHistoryCache[key] = { ...result, fetchedAt: Date.now() };
      return utilityHistoryCache[key];
    }).finally(() => { delete utilityHistoryRequests[key]; });
  }
  return utilityHistoryRequests[key];
}

async function drawUtilityCharts(utility, status, entityId, reload = false) {
  try {
    const result = await utilityHistoryData(utility, entityId, reload);
    if (!document.body.contains(status)) return;
    for (const totalLabel of status.parentElement.querySelectorAll('[data-utility-total]')) {
      const total = result.totals?.[totalLabel.dataset.utilityTotal];
      const hasPoints = result.series?.[totalLabel.dataset.utilityTotal]?.some(b => b.value !== null);
      totalLabel.textContent = total?.value === null || total?.value === undefined ? 'Niet beschikbaar'
        : `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 3 }).format(total.value)} m³${!hasPoints ? ' (onvolledig)' : ''}`;
    }
    status.textContent = result.available ? '' : 'Nog onvoldoende meterhistorie beschikbaar.';
    if (!result.available) return;
    const styles = getComputedStyle(document.documentElement);
    const color = styles.getPropertyValue('--green').trim();
    const muted = styles.getPropertyValue('--muted').trim();
    const line = styles.getPropertyValue('--line').trim();
    for (const [key, title, interval] of [
      ['hours24', 'Laatste 24 uur · per uur', 60 * 60 * 1000],
      ['days7', 'Afgelopen week · per dag', 24 * 60 * 60 * 1000],
      ['days30', 'Afgelopen 30 dagen · per dag', 24 * 60 * 60 * 1000]
    ]) {
      const canvas = status.parentElement.querySelector(`[data-utility-chart="${key}"]`);
      if (!canvas) continue;
      const formatter = new Intl.DateTimeFormat('nl-NL', interval === 60 * 60 * 1000
        ? { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }
        : { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit' });
      const labels = result.series[key].map(bucket => formatter.format(new Date(bucket.timestamp)));
      const values = result.series[key].map(bucket => bucket.value !== null && bucket.value !== undefined ? bucket.value : 0);
      const existing = utilityCharts.find(item => item.utility === utility && item.chart.canvas === canvas);
      if (existing) {
        existing.chart.data.labels = labels;
        existing.chart.data.datasets[0].data = values;
        existing.chart.update('none');
        continue;
      }
      utilityCharts.push({ utility, chart: new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: `${utility === 'gas' ? 'Gas' : 'Water'}verbruik`, data: values, borderColor: color,
            backgroundColor: `${color}24`, borderWidth: 2, pointRadius: key === 'hours24' ? 2 : 1.5,
            pointHoverRadius: 5, tension: 0.25, fill: true, spanGaps: true }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${number(context.parsed.y)} m³` } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: key === 'hours24' ? 8 : 10, maxRotation: 0 } },
            y: { beginAtZero: true, grid: { color: line }, ticks: { color: muted }, title: { display: true, text: 'm³', color: muted } }
          },
          animation: { duration: 250 }
        }
      }) });
    }
  } catch (error) {
    if (document.body.contains(status)) {
      status.textContent = error.message;
      status.parentElement.querySelectorAll('[data-utility-total]').forEach(label => {
        const total = utilityHistoryCache[`${utility}:${entityId}`]?.totals?.[label.dataset.utilityTotal];
        if (!total) label.textContent = 'Niet beschikbaar';
      });
    }
  }
}

function utilityPanel(utility) {
  const isGas = utility === 'gas';
  const label = isGas ? 'Gas' : 'Water';
  const role = isGas ? 'gasConsumption' : 'waterConsumption';
  const entityId = data.mappings[role];
  const section = element('section', 'utility-panel');
  const header = element('div', 'section-heading');
  header.append(element('h2', '', `${label}verbruik`));
  if (entityId) {
    const reload = toolButton('refresh-cw', `${label}historie vernieuwen`, () => {
      const status = section.querySelector('.utility-history-status');
      drawUtilityCharts(utility, status, entityId, true);
    });
    header.append(reload);
  }
  section.append(header);
  if (!entityId) {
    const copy = element('p', 'empty-state', `Koppel een cumulatieve ${label.toLowerCase()}meter in Koppelingen.`);
    const connect = element('button', 'secondary-button', `${label}meter koppelen`);
    connect.prepend(icon('link'));
    connect.addEventListener('click', () => navigate('entities'));
    section.append(copy, connect);
    main.append(section);
    return;
  }
  const status = element('p', 'utility-history-status muted', 'Meterhistorie laden…');
  status.classList.add(`utility-history-${utility}`);
  section.append(status);
  for (const [key, title] of [['hours24', 'Laatste 24 uur · per uur'], ['days7', 'Afgelopen week · per dag'], ['days30', 'Afgelopen 30 dagen · per dag']]) {
    const chartSection = element('div', 'utility-chart-section');
    const chartHeading = element('div', 'utility-chart-heading');
    chartHeading.append(element('h3', '', title));
    const total = element('strong', 'utility-period-total', 'Ophalen...');
    total.dataset.utilityTotal = key;
    chartHeading.append(total);
    chartSection.append(chartHeading);
    const wrapper = element('div', 'utility-chart');
    const canvas = element('canvas');
    canvas.dataset.utilityChart = key;
    canvas.dataset.utility = utility;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${label}verbruik ${title.toLowerCase()}`);
    wrapper.append(canvas);
    chartSection.append(wrapper);
    section.append(chartSection);
  }
  main.append(section);
  drawUtilityCharts(utility, status, entityId);
}

function singleBatteryPanel(batConfig) {
  const panel = element('section', 'appliance-panel battery-panel');
  const socEntity = data.entities.find(e => e.id === batConfig.socEntity);
  const powerEntity = data.entities.find(e => e.id === batConfig.powerEntity);
  const switchEntity = data.entities.find(e => e.id === batConfig.switchEntity);
  const inputEntity = data.entities.find(e => e.id === batConfig.inputEntity);
  const outputEntity = data.entities.find(e => e.id === batConfig.outputEntity);
  const remainingEntity = data.entities.find(e => e.id === batConfig.remainingEntity);
  const healthEntity = data.entities.find(e => e.id === batConfig.healthEntity);
  const usesBatterySpecificSwitch = !batConfig.isMain;
  const actualSwitchEntity = usesBatterySpecificSwitch
    ? switchEntity
    : data.entities.find(e => e.id === data.mappings.batteryEnable) || (data.demo ? switchEntity : null);
  const getSwitchEntity = () => {
    const id = usesBatterySpecificSwitch ? batConfig.switchEntity : data.mappings.batteryEnable || (data.demo ? batConfig.switchEntity : null);
    return data.entities.find(entity => entity.id === id);
  };
  const switchStateLabel = () => {
    const entity = getSwitchEntity();
    return !entity ? 'Geen schakelaar' : !entity.available ? 'Niet beschikbaar'
      : entity.state === 'on' ? 'Aan' : entity.state === 'off' ? 'Uit' : 'Onbekend';
  };

  const header = element('header', 'appliance-header');
  const copy = element('div');
  copy.append(element('h2', '', batConfig.name || 'Thuisbatterij'), liveText('span', 'appliance-status', switchStateLabel));
  header.append(icon('battery-charging'), copy);
  panel.append(header);

  const visual = element('div', 'appliance-visual battery-visual');
  visual.setAttribute('role', 'img');
  visual.setAttribute('aria-label', batConfig.name || 'Thuisbatterij');
  const housing = element('div', 'appliance-housing');
  const face = element('div', 'appliance-face');
  const fill = element('div', 'battery-fill');
  bindLive(fill, () => {
    const entity = data.entities.find(item => item.id === batConfig.socEntity);
    const value = entity?.available && Number.isFinite(Number(entity.state)) ? Number(entity.state) : null;
    fill.style.height = `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`;
  });
  face.append(fill);
  housing.prepend(face);
  visual.append(housing);
  panel.append(visual);

  panel.append(liveText('strong', 'battery-charge', () => {
    const entity = data.entities.find(item => item.id === batConfig.socEntity);
    return entity?.available && Number.isFinite(Number(entity.state)) ? `${number(Math.round(Number(entity.state)))} %` : 'Niet beschikbaar';
  }));

  if (actualSwitchEntity) {
    const section = element('section', 'battery-control-section');
    const toggle = element('button', 'primary-button');
    const toggleIcon = icon('play');
    const toggleLabel = liveText('span', '', () => getSwitchEntity()?.state === 'on' ? 'Accu uitschakelen' : 'Accu inschakelen');
    toggle.append(toggleIcon, toggleLabel);
    bindLive(toggle, () => {
      const entity = getSwitchEntity();
      const enabled = entity?.state === 'on';
      toggleIcon.dataset.lucide = enabled ? 'pause' : 'play';
      toggle.disabled = !data.controlStatus?.activeAllowed || !entity?.available || !['on', 'off'].includes(entity?.state);
    });
    toggle.addEventListener('click', async () => {
      const currentSwitch = getSwitchEntity();
      if (!currentSwitch || !['on', 'off'].includes(currentSwitch.state)) return;
      const targetEnabled = currentSwitch.state !== 'on';
      try {
        if (usesBatterySpecificSwitch) {
          await api(`batteries/${encodeURIComponent(batConfig.id)}/enable`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ switchId: currentSwitch.id, enabled: targetEnabled, expectedState: currentSwitch.state, confirm: true })
          });
        } else {
          await api('battery/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: targetEnabled, confirm: true })
          });
        }
        notify(`Accu ${targetEnabled ? 'ingeschakeld' : 'uitgeschakeld'}.`);
        await refresh();
      } catch (err) { notify(err.message, true); }
    });
    section.append(toggle);
    panel.append(section);
  } else if (batConfig.isMain) {
    batteryControlPanel(panel);
  } else {
    const section = element('section', 'battery-control-section');
    section.append(element('p', 'subtitle', 'Koppel voor deze accu een eigen schakelaar.'));
    const connect = element('button', 'secondary-button', 'Accuschakelaar koppelen');
    connect.prepend(icon('link'));
    connect.addEventListener('click', () => navigate('entities'));
    section.append(connect);
    panel.append(section);
  }

  const tiles = element('div', 'appliance-measurements');
  const metric = (title, value) => {
    const cell = element('div', 'appliance-measurement');
    cell.append(element('span', '', title), value instanceof Node ? value : element('strong', '', value));
    return cell;
  };

  const formatEntityVal = ent => {
    if (!ent?.available || ent.state.trim() === '' || !Number.isFinite(Number(ent.state))) return 'Niet beschikbaar';
    if (['W', 'kW'].includes(ent.unit)) return powerText(Number(ent.state) / (ent.unit === 'W' ? 1000 : 1));
    return `${number(Number(ent.state))} ${ent.unit || ''}`.trim();
  };

  const entityValue = key => {
    const entityId = batConfig[key];
    return formatEntityVal(data.entities.find(item => item.id === entityId));
  };
  tiles.append(
    metric('Input', liveText('strong', '', () => entityValue('inputEntity'))),
    metric('Output', liveText('strong', '', () => entityValue('outputEntity'))),
    metric('Resterende tijd', liveText('strong', '', () => entityValue('remainingEntity'))),
    metric('State of health', liveText('strong', '', () => entityValue('healthEntity')))
  );
  panel.append(tiles);

  const limits = element('form', 'battery-level-settings');
  limits.append(element('h3', 'charger-phase-heading', 'Batterijniveaus (min / max %)'));
  const limitsGrid = element('div', 'battery-limits-grid');
  const inputs = {};
  const reportedValues = {};
  const pendingValues = {};
  for (const [key, title, fallbackVal] of [['min', 'Minimum niveau (%)', '20'], ['max', 'Maximum niveau (%)', '80']]) {
    const entityId = batConfig[`${key}LevelEntity`];
    const entity = data.entities.find(item => item.id === entityId);
    const label = element('label', 'mapping-setting');
    const input = element('input', 'text-input');
    const curVal = entity?.state && Number.isFinite(Number(entity.state)) ? Number(entity.state) : (data.demo ? Number(fallbackVal) : '');
    reportedValues[key] = String(curVal);
    pendingValues[key] = null;
    Object.assign(input, {
      type: 'number',
      min: Math.max(0, entity?.minimum ?? 0),
      max: Math.min(100, entity?.maximum ?? 100),
      step: entity?.step ?? 1,
      required: true,
      value: curVal,
      placeholder: entity ? `${entity.name}` : `${fallbackVal}% (niet gekoppeld)`
    });
    bindLive(input, () => {
      if (limits.contains(document.activeElement)) return;
      const current = data.entities.find(item => item.id === entityId);
      if (!current?.available || !Number.isFinite(Number(current.state))) return;
      const currentValue = String(Number(current.state));
      if (pendingValues[key] !== null) {
        if (currentValue === pendingValues[key]) {
          reportedValues[key] = currentValue;
          pendingValues[key] = null;
        }
        return;
      }
      if (String(input.value) === reportedValues[key]) {
        input.value = currentValue;
        reportedValues[key] = currentValue;
      }
    });
    input.addEventListener('input', () => {
      if (pendingValues[key] !== null && input.value !== pendingValues[key]) pendingValues[key] = null;
    });
    const canControl = Boolean(entity?.available && entity.domain === 'number' && data.controlStatus?.activeAllowed && data.control?.mode === 'active');
    input.disabled = !canControl && !data.demo;
    input.setAttribute('aria-label', `${batConfig.name}: ${title}`);
    label.append(element('span', '', title), input);
    inputs[key] = input;
    limitsGrid.append(label);
  }
  limits.append(limitsGrid);

  const actions = element('div', 'battery-limits-actions');
  const apply = element('button', 'primary-button', 'Niveaus instellen');
  apply.type = 'submit';
  apply.prepend(icon('save'));
  const canApply = (!inputs.min.disabled && !inputs.max.disabled) || data.demo;
  apply.disabled = !canApply;
  actions.append(apply);

  limits.append(actions);

  if (!data.controlStatus?.activeAllowed || data.control?.mode !== 'active') {
    limits.append(element('p', 'appliance-control-note', 'Niveaus instellen vereist apparaatvrijgave in Home Assistant en de stand Actief.'));
  }

  limits.addEventListener('submit', async event => {
    event.preventDefault();
    if (Number(inputs.min.value) >= Number(inputs.max.value)) { notify('Minimum moet lager zijn dan maximum.', true); return; }
    apply.disabled = true;
    try {
      await api('battery/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batteryId: batConfig.id, min: Number(inputs.min.value), max: Number(inputs.max.value), confirm: true }) });
      pendingValues.min = String(Number(inputs.min.value));
      pendingValues.max = String(Number(inputs.max.value));
      apply.disabled = !canApply;
      notify('Batterijniveaus verstuurd; terugmelding volgt.');
      await refresh();
    } catch (error) { notify(error.message, true); }
    finally { apply.disabled = !canApply; }
  });
  panel.append(limits);

  if (powerEntity) {
    panel.append(liveText('p', 'appliance-footer', () => {
      const power = batteryInfo(batConfig).powerW;
      return `Batterijvermogen · ${powerText(power === null ? null : power / 1000)}`;
    }));
  }

  return panel;
}

function devicePanel(kind) {
  if (kind === 'battery') {
    // 1. Hoofdbatterij eerst (als deze gekoppeld is)
    const hasMainBattery = Boolean(data.mappings?.batterySoc || data.mappings?.batteryPower || data.mappings?.batteryEnable || data.mappings?.batteryInputPower || data.mappings?.batteryOutputPower || data.mappings?.batteryRemainingTime || data.mappings?.batteryHealth);
    if (hasMainBattery) {
      main.append(singleBatteryPanel({
        id: 'main_battery',
        name: 'Hoofdbatterij',
        isMain: true,
        chargingStateEntity: data.mappings.batteryChargingState || (data.demo ? 'sensor.ups_battery_charging_state' : null),
        minLevelEntity: data.mappings.batteryMinLevel || (data.demo ? 'number.ups_min_charge_level' : null),
        maxLevelEntity: data.mappings.batteryMaxLevel || (data.demo ? 'number.ups_max_charge_level' : null),
        socEntity: data.mappings.batterySoc,
        powerEntity: data.mappings.batteryPower,
        switchEntity: data.mappings.batteryEnable,
        inputEntity: data.mappings.batteryInputPower,
        outputEntity: data.mappings.batteryOutputPower,
        remainingEntity: data.mappings.batteryRemainingTime,
        healthEntity: data.mappings.batteryHealth
      }));
    }

    // 2. Extra batterijsystemen onder elkaar
    if (data.mappings?.batteries?.length) {
      for (const bat of data.mappings.batteries) {
        main.append(singleBatteryPanel(bat));
      }
    } else if (!hasMainBattery && data.demo) {
      // In demo zonder handmatige invoer
      main.append(singleBatteryPanel({
        id: 'demo_main',
        name: 'Hoofdbatterij',
        isMain: true,
        chargingStateEntity: 'sensor.ups_battery_charging_state',
        minLevelEntity: 'number.ups_min_charge_level',
        maxLevelEntity: 'number.ups_max_charge_level',
        socEntity: 'sensor.demo_battery_soc',
        powerEntity: 'sensor.demo_battery_power',
        switchEntity: 'switch.demo_battery_enable',
        inputEntity: 'sensor.demo_battery_input',
        outputEntity: 'sensor.demo_battery_output',
        remainingEntity: 'sensor.demo_battery_remaining',
        healthEntity: 'sensor.demo_battery_health'
      }));
    }
    return;
  }
  const battery = kind === 'battery';
  const panel = element('section', `appliance-panel ${battery ? 'battery-panel' : 'charger-panel'}`);
  const primaryRole = battery ? 'batterySoc' : 'evPower';
  const entity = data.entities.find(item => item.id === data.mappings[primaryRole]);
  const header = element('header', 'appliance-header');
  const copy = element('div');
  copy.append(element('h2', '', entity?.name.split(' · ')[0] || (battery ? 'Thuisbatterij' : 'Laadpaal')),
    liveText('span', 'appliance-status', () => battery ? measurement('batteryEnable') : measurement('evCableStatus')));
  header.append(icon(battery ? 'battery-charging' : 'car'), copy);
  panel.append(header);
  const visual = element('div', `appliance-visual ${battery ? 'battery-visual' : 'charger-visual'}`);
  visual.setAttribute('role', 'img');
  visual.setAttribute('aria-label', battery ? 'Thuisbatterij' : 'Laadpaal');
  const housing = element('div', 'appliance-housing');
  const face = element('div', 'appliance-face');
  if (battery) {
    const reading = data.readings.find(item => item.role === 'batterySoc');
    const fill = element('div', 'battery-fill');
    fill.style.height = `${reading?.valid ? Math.max(0, Math.min(100, Number(reading.value))) : 0}%`;
    face.append(fill);
  } else {
    face.append(element('div', 'charger-indicator'));
    housing.append(element('div', 'charger-socket'));
  }
  housing.prepend(face);
  visual.append(housing);
  panel.append(visual);
  const tiles = element('div', 'appliance-measurements');
  const metric = (title, value) => {
    const cell = element('div', 'appliance-measurement');
    const valueNode = typeof value === 'function' ? liveText('strong', '', value) : element('strong', '', value);
    cell.append(element('span', '', title), valueNode);
    return cell;
  };
  if (battery) {
    panel.append(element('strong', 'battery-charge', measurement('batterySoc')));
    batteryControlPanel(panel);
    for (const [role, title] of [['batteryInputPower', 'Input'], ['batteryOutputPower', 'Output'], ['batteryRemainingTime', 'Resterende tijd'], ['batteryHealth', 'State of health']]) {
      tiles.append(metric(title, measurement(role)));
    }
    panel.append(tiles);
    if (data.mappings.batteryPower) panel.append(liveText('p', 'appliance-footer', () => `Batterijvermogen · ${measurement('batteryPower')}`));
  } else {
    const allowed = data.controlStatus?.activeAllowed;
    const currentEnable = () => data.readings.find(item => item.role === 'evEnable');
    const currentLock = () => data.readings.find(item => item.role === 'evLockStatus');
    const executeCommand = async (command, successMsg) => {
      try {
        await api('ev/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, confirm: true }) });
        notify(successMsg);
        await refresh();
      } catch (error) { notify(error.message, true); }
    };
    const confirmCommand = (title, command, reset = () => {}) => {
      if (data.preferences?.confirmSwitches === false) {
        executeCommand(command, 'Laadpaalopdracht verstuurd.');
        return;
      }
      const dialog = element('dialog', 'thermal-dialog');
      dialog.setAttribute('aria-label', title);
      dialog.append(element('h2', '', `${title}?`), element('p', '', 'Dit bedient de gekoppelde laadpaal rechtstreeks. Een actieve Stroomregel kan deze instelling later wijzigen.'));
      const actions = element('div', 'dialog-actions');
      actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
      const confirm = element('button', 'primary-button', 'Bevestigen');
      confirm.prepend(icon('check'));
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        try {
          await api('ev/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, confirm: true }) });
          dialog.close();
          notify('Laadpaalopdracht verstuurd.');
          await refresh();
        } catch (error) { notify(error.message, true); confirm.disabled = false; }
      });
      actions.append(confirm);
      dialog.append(actions);
      dialog.addEventListener('close', () => { reset(); dialog.remove(); });
      document.body.append(dialog);
      createIcons({ icons });
      dialog.showModal();
    };
    const lockControl = element('div', 'charger-lock-control');
    const lockEntity = data.entities.find(item => item.id === data.mappings.evLockStatus);
    const lockState = () => {
      const entity = data.entities.find(item => item.id === data.mappings.evLockStatus);
      const value = currentLock()?.value;
      if (entity?.domain === 'lock') return value === 'locked' ? 'locked' : value === 'unlocked' ? 'unlocked' : 'unknown';
      if (['switch', 'binary_sensor'].includes(entity?.domain)) return value === 'on' ? 'locked' : value === 'off' ? 'unlocked' : 'unknown';
      return 'unknown';
    };
    const lockButton = toolButton('lock', 'Kabelstatus onbekend', () => {
      const state = lockState();
      if (state === 'unknown') return;
      confirmCommand(state === 'locked' ? 'Kabel ontgrendelen' : 'Kabel vergrendelen', { action: 'lock', locked: state === 'unlocked' });
    });
    lockButton.firstElementChild.classList.add('lock-state-closed');
    const openLockIcon = icon('unlock');
    openLockIcon.classList.add('lock-state-open');
    lockButton.append(openLockIcon);
    bindLive(lockButton, () => {
      const state = lockState();
      const label = state === 'locked' ? 'Kabel ontgrendelen' : state === 'unlocked' ? 'Kabel vergrendelen' : 'Kabelstatus onbekend';
      lockButton.title = label;
      lockButton.setAttribute('aria-label', label);
      lockButton.disabled = !data.controlStatus?.activeAllowed || !['switch', 'lock'].includes(lockEntity?.domain) || state === 'unknown';
      lockButton.classList.toggle('is-unlocked', state === 'unlocked');
    });
    lockControl.append(lockButton, element('span', '', 'Kabelvergrendeling'));
    panel.append(lockControl);
    const start = element('button', 'primary-button appliance-command');
    const startLabel = liveText('span', '', () => currentEnable()?.value === 'on' ? 'Laden stoppen' : 'Laden starten');
    start.append(icon('play'), startLabel);
    bindLive(start, () => {
      const enabled = currentEnable();
      const cable = data.readings.find(item => item.role === 'evCableStatus');
      start.disabled = !data.controlStatus?.activeAllowed || !enabled?.valid || (enabled.value !== 'on' && (!cable?.valid || cable.value !== 'on'));
    });
    start.addEventListener('click', () => {
      const charging = currentEnable()?.value === 'on';
      confirmCommand(charging ? 'Laden stoppen' : 'Laden starten', { action: 'enable', enabled: !charging });
    });
    panel.append(start);
    const limit = data.entities.find(item => item.id === data.mappings.evCurrentLimit);
    const limitLabel = element('label', 'charger-limit-control');
    limitLabel.htmlFor = 'ev-current-slider';
    const value = liveText('strong', '', () => {
      const current = data.entities.find(item => item.id === data.mappings.evCurrentLimit);
      return current?.available ? `${number(Number(current.state))} A` : 'Niet gekoppeld';
    });
    limitLabel.append(element('span', '', 'Laadlimiet'), value);
    const slider = element('input');
    slider.id = 'ev-current-slider';
    slider.type = 'range';
    slider.min = Math.max(6, limit?.minimum ?? 6);
    slider.max = Math.min(32, limit?.maximum ?? 16);
    slider.step = limit?.step || 1;
    slider.value = limit?.state ?? slider.min;
    slider.disabled = !allowed || !limit?.available || !Number.isFinite(limit.minimum) || !Number.isFinite(limit.maximum) || !Number.isFinite(limit.step) || limit.step <= 0 || Number(slider.min) > Number(slider.max);
    bindLive(value, () => {
      if (document.activeElement === slider) return;
      const current = data.entities.find(item => item.id === data.mappings.evCurrentLimit);
      value.textContent = current?.available ? `${number(Number(current.state))} A` : 'Niet gekoppeld';
    });
    bindLive(slider, () => {
      const current = data.entities.find(item => item.id === data.mappings.evCurrentLimit);
      if (document.activeElement !== slider && current?.available) slider.value = current.state;
      if (current) {
        slider.min = Math.max(6, current.minimum ?? 6);
        slider.max = Math.min(32, current.maximum ?? 16);
        slider.step = current.step || 1;
      }
      slider.disabled = !data.controlStatus?.activeAllowed || !current?.available || !Number.isFinite(current?.minimum) || !Number.isFinite(current?.maximum) || !Number.isFinite(current?.step) || current.step <= 0 || Number(slider.min) > Number(slider.max);
    });
    slider.addEventListener('input', () => { value.textContent = `${number(Number(slider.value))} A`; });
    slider.addEventListener('change', () => confirmCommand(`Laadlimiet ${number(Number(slider.value))} A instellen`, { action: 'current', value: Number(slider.value) }, () => {
      slider.value = limit.state;
      value.textContent = `${number(Number(limit.state))} A`;
    }));
    limitLabel.append(slider);
    panel.append(limitLabel);
    tiles.append(metric('Vermogen', () => measurement('evPower')), metric('Sessie', () => measurement('evSessionEnergy')));
    if (data.mappings.evSoc) tiles.append(metric('Auto-accu', () => measurement('evSoc')));
    panel.append(tiles, element('h3', 'charger-phase-heading', 'Laadstroom per fase'));
    const phases = element('div', 'charger-phases');
    for (const phase of [1, 2, 3]) {
      const role = `evPhase${phase}Current`;
      const phaseCell = metric(`L${phase}`, () => measurement(role));
      const reading = data.readings.find(item => item.role === role);
      const meter = element('meter');
      meter.min = 0;
      meter.max = Math.max(32, Number(reading?.value) || 0);
      meter.value = reading?.valid ? Number(reading.value) : 0;
      meter.setAttribute('aria-label', `Gemeten laadstroom L${phase}`);
      if (!reading?.valid) meter.hidden = true;
      bindLive(meter, () => {
        const current = data.readings.find(item => item.role === role);
        meter.hidden = !current?.valid;
        meter.value = current?.valid ? Number(current.value) : 0;
        meter.max = Math.max(32, Number(current?.value) || 0);
      });
      phaseCell.append(meter);
      phases.append(phaseCell);
    }
    panel.append(phases);
    const footer = element('p', 'appliance-footer');
    const footerClosedIcon = icon('lock');
    footerClosedIcon.classList.add('lock-state-closed');
    const footerOpenIcon = icon('unlock');
    footerOpenIcon.classList.add('lock-state-open');
    bindLive(footer, () => footer.classList.toggle('is-unlocked', lockState() === 'unlocked'));
    footer.append(footerClosedIcon, footerOpenIcon, liveText('span', '', () => measurement('evLockStatus')));
    panel.append(footer);
    if (!allowed) panel.append(element('p', 'appliance-control-note', 'Handmatige bediening vereist vrijgave voor echte apparaatsturing.'));
    if (!data.mappings.evEnable || !data.mappings.evCurrentLimit) {
      const connect = element('button', 'secondary-button', 'Laadpaalbediening koppelen');
      connect.prepend(icon('link'));
      connect.addEventListener('click', () => navigate('entities'));
      panel.append(connect);
    }
  }
  main.append(panel);
}

const solarEnergyText = value => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(value)} kWh`;

function solarDayText(row, solarMeter = null) {
  const entity = data.entities.find(item => item.id === data.mappings.solarToday);
  const cumulative = isCumulativeSolarMeter(entity, data.mappings.solarTodayMode);
  const value = data.mappings.solarToday ? cumulative ? solarMeter?.energyKwh : data.energy?.solarOutlook?.actualTodayKwh : row?.energyKwh;
  if (value === null || value === undefined) return 'Niet beschikbaar';
  return `${solarEnergyText(value)}${!data.mappings.solarToday && !row.complete ? ' (schatting)' : ''}`;
}

async function loadSolarChart(panel, reload = false) {
  const status = panel.querySelector('.solar-chart-status');
  try {
    const recap = await dailyHistory(reload);
    if (!panel.isConnected) return;
    const row = recap.rows.find(item => item.label === 'Zonnepanelen');
    const text = solarDayText(row, recap.solarToday);
    panel.querySelector('.solar-today-total').textContent = text;
    panel.querySelector('#solar-actual-today').textContent = text;
    const cumulative = isCumulativeSolarMeter(data.entities.find(entity => entity.id === data.mappings.solarToday), data.mappings.solarTodayMode);
    status.textContent = cumulative && data.mappings.solarToday && recap.solarToday?.energyKwh == null ? 'Geen geldig dagverschil: beginstand rond middernacht ontbreekt of de teller is gereset.'
      : data.mappings.solarToday && !cumulative && data.energy?.solarOutlook?.actualTodayKwh === null ? 'De gekoppelde dagopbrengst is niet beschikbaar.'
      : !row || row.energyKwh === null ? 'Geen opbrengsthistorie beschikbaar.' : '';
    const periods = row?.periods ?? [];
    const labels = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);
    const values = Array.from({ length: 48 }, (_, index) => periods.find(bucket => bucket.index === index)?.energyKwh ?? null);
    const labelFor = context => `${solarEnergyText(context.parsed.y)}${periods.find(bucket => bucket.index === context.dataIndex)?.complete ? '' : ' (schatting)'}`;
    const colors = getComputedStyle(document.documentElement);
    const mutedColor = colors.getPropertyValue('--appliance-muted').trim();
    const outlineColor = colors.getPropertyValue('--appliance-outline').trim();
    const accentColor = colors.getPropertyValue('--appliance-accent').trim();
    const canvas = panel.querySelector('canvas');
    const previous = utilityCharts.find(item => item.chart.canvas === canvas);
    if (previous) {
      previous.chart.data.labels = labels;
      previous.chart.data.datasets[0].data = values;
      previous.chart.data.datasets[0].backgroundColor = accentColor;
      previous.chart.options.plugins.tooltip.callbacks.label = labelFor;
      previous.chart.options.scales.x.border.color = outlineColor;
      previous.chart.options.scales.x.ticks.color = mutedColor;
      previous.chart.update('none');
      return;
    }
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: accentColor, borderRadius: 3, maxBarThickness: 24 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: labelFor } }
        },
        scales: {
          x: { grid: { display: false }, border: { color: outlineColor, dash: [5, 4] }, ticks: { color: mutedColor, maxRotation: 0, autoSkip: false, font: { size: 10 }, callback: (_value, index) => [0, 12, 24, 36, 47].includes(index) ? `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}` : '' } },
          y: { beginAtZero: true, display: false }
        }
      }
    });
    utilityCharts.push({ utility: 'solar', chart });
  } catch (error) {
    if (!panel.isConnected) return;
    panel.querySelector('.solar-today-total').textContent = solarDayText();
    panel.querySelector('#solar-actual-today').textContent = solarDayText();
    status.textContent = error.message;
  }
}

function deviceDetail(kind) {
  const definitions = {
    ev: { title: 'Laadpaal', subtitle: 'Gekoppelde laadpaalmetingen', metrics: [['evPower', 'Laadvermogen', 'car'], ['evCableStatus', 'Kabelstatus', 'plug'], ['evLockStatus', 'Vergrendeling', 'lock'], ['evSessionEnergy', 'Sessieverbruik', 'activity'], ['evPhase1Current', 'Laadstroom L1', 'activity'], ['evPhase2Current', 'Laadstroom L2', 'activity'], ['evPhase3Current', 'Laadstroom L3', 'activity']], filter: row => row.label === 'Laadpaal' },
    battery: { title: 'Batterij', subtitle: 'Thuisbatterijmetingen', metrics: [['batterySoc', 'Laadtoestand', 'battery-charging'], ['batteryHealth', 'Batterijgezondheid', 'activity'], ['batteryInputPower', 'Input', 'activity'], ['batteryOutputPower', 'Output', 'arrow-up-right'], ['batteryRemainingTime', 'Resterende tijd', 'activity'], ['batteryPower', 'Batterijvermogen', 'activity']], filter: row => row.label.startsWith('Batterij ') },
    solar: { title: 'Zonnepanelen', subtitle: 'Productie en dagopbrengst', metrics: [['solarExpectedNow', 'Verwachte opbrengst nu'], ['solar', 'Actuele opbrengst nu'], ['solarExpectedToday', 'Verwachte opbrengst vandaag']], filter: row => row.label === 'Zonnepanelen' }
  };
  const config = definitions[kind];
  if (kind !== 'solar') heading(config.title, config.subtitle);
  if (kind !== 'solar') devicePanel(kind);
  const solarPanel = kind === 'solar' ? element('section', 'appliance-panel solar-panel') : null;
  const solarMenu = element('details', 'solar-menu');
  if (solarPanel) {
    const header = element('header', 'appliance-header');
    const copy = element('div');
    const power = data.readings.find(item => item.role === 'solar');
    copy.append(element('h1', '', 'Zonnepanelen'), liveText('span', 'appliance-status', () => {
      const current = data.readings.find(item => item.role === 'solar');
      return !current?.valid ? 'Productie onbekend' : Number(current.value) > 0 ? 'Produceert' : 'Produceert niet';
    }));
    const summary = element('summary');
    summary.setAttribute('aria-label', 'Zonnepanelenopties');
    summary.title = 'Zonnepanelenopties';
    summary.append(icon('ellipsis-vertical'));
    solarMenu.append(summary);
    header.append(icon('sun'), copy, solarMenu);
    const today = element('div', 'solar-today-heading');
    today.append(element('span', '', 'Vandaag'), liveText('strong', 'solar-today-total', () => data.mappings.solarToday ? solarDayText(dailyRecapCache?.rows?.find(item => item.label === 'Zonnepanelen'), dailyRecapCache?.solarToday) : 'Ophalen...'));
    const graph = element('div', 'solar-day-chart');
    const canvas = element('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Zonneopbrengst vandaag per half uur in kWh');
    graph.append(canvas);
    solarPanel.append(header, today, graph);
  }
  const metrics = element('section', kind === 'solar' ? 'solar-measurements' : 'device-metrics');
  let count = 0;
  for (const [role, title, iconName] of config.metrics) {
    if (!data.mappings[role] && kind !== 'solar') continue;
    count++;
    if (kind !== 'solar') continue;
    const card = element('div', 'solar-measurement');
    const reading = data.readings.find(item => item.role === role);
    card.append(element('span', '', title), liveText('strong', '', () => {
      const current = data.readings.find(item => item.role === role);
      return role === 'solarExpectedToday' && current?.valid ? solarEnergyText(Number(current.value)) : measurement(role);
    }));
    metrics.append(card);
  }
  if (kind === 'solar') {
    const today = element('div', 'solar-measurement');
    const label = element('span', '', 'Actuele opbrengst vandaag');
    const actual = liveText('strong', '', () => data.mappings.solarToday ? solarDayText(dailyRecapCache?.rows?.find(item => item.label === 'Zonnepanelen'), dailyRecapCache?.solarToday) : 'Ophalen...');
    actual.id = 'solar-actual-today';
    today.append(label, actual);
    metrics.append(today);
  }
  if (metrics.childElementCount && kind !== 'solar') main.append(metrics);
  if (kind === 'solar') {
    const pvRules = data.control.rules.filter(rule => rule.action.type === 'pv_limit');
    const section = element('section', 'solar-control-section');
    const entity = data.entities.find(item => item.id === data.mappings.solarLimit);
    if (!entity) {
      const label = element('label', 'solar-limit-control');
      label.htmlFor = 'solar-limit-slider';
      const slider = element('input', 'solar-limit-slider');
      Object.assign(slider, { id: 'solar-limit-slider', type: 'range', min: 0, max: 100, disabled: true });
      label.append(element('span', '', 'Omvormer terugdimmen'), element('strong', 'solar-limit-value', 'Niet gekoppeld'), slider);
      section.append(label);
      const connect = element('button', 'secondary-button', 'Productielimiet koppelen');
      connect.prepend(icon('link'));
      connect.addEventListener('click', () => navigate('entities'));
      solarMenu.append(connect);
    } else {
      const sliderLabel = element('label', 'solar-limit-control');
      sliderLabel.htmlFor = 'solar-limit-slider';
      const limitValue = liveText('strong', 'solar-limit-value', () => {
        const current = data.entities.find(item => item.id === data.mappings.solarLimit);
        return current?.available && Number.isFinite(Number(current.state)) ? `${number(Number(current.state))}%` : 'Niet beschikbaar';
      });
      sliderLabel.append(element('span', '', 'Omvormer terugdimmen'), limitValue);
      const slider = element('input', 'solar-limit-slider');
      slider.id = 'solar-limit-slider';
      slider.type = 'range';
      const supportsFullRange = Number.isFinite(entity.minimum) && entity.minimum <= 0 && Number.isFinite(entity.maximum) && entity.maximum >= 100;
      slider.min = 0;
      slider.max = 100;
      slider.step = entity.step > 0 ? entity.step : 1;
      slider.value = Number.isFinite(Number(entity.state)) ? Number(entity.state) : 100;
      slider.disabled = !entity.available || !supportsFullRange || !Number.isFinite(entity.step) || entity.step <= 0 || !data.controlStatus?.activeAllowed || data.control?.mode !== 'active' || solarLimitPending;
      bindLive(limitValue, () => {
        if (document.activeElement === slider) return;
        const current = data.entities.find(item => item.id === data.mappings.solarLimit);
        limitValue.textContent = current?.available && Number.isFinite(Number(current.state)) ? `${number(Number(current.state))}%` : 'Niet beschikbaar';
      });
      bindLive(slider, () => {
        const current = data.entities.find(item => item.id === data.mappings.solarLimit);
        if (document.activeElement !== slider && current?.available && Number.isFinite(Number(current.state))) slider.value = Number(current.state);
        const supportsRange = Number.isFinite(current?.minimum) && current.minimum <= 0 && Number.isFinite(current?.maximum) && current.maximum >= 100;
        slider.disabled = !current?.available || !supportsRange || !Number.isFinite(current?.step) || current.step <= 0 || !data.controlStatus?.activeAllowed || data.control?.mode !== 'active' || solarLimitPending;
      });
      slider.addEventListener('input', () => { sliderLabel.querySelector('.solar-limit-value').textContent = `${number(Number(slider.value))}%`; });
      sliderLabel.append(slider);
      section.append(sliderLabel);
      const applyLimit = async value => {
        if (solarLimitPending) return false;
        solarLimitPending = true;
        slider.disabled = true;
        try {
          await api('solar/limit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, confirm: true }) });
          solarLimitConsentEntity = entity.id;
          notify('Omvormerlimiet ingesteld.');
          return true;
        } catch (error) {
          solarLimitConsentEntity = undefined;
          notify(error.message, true);
          return false;
        } finally {
          solarLimitPending = false;
          await refresh();
        }
      };
      slider.addEventListener('change', async () => {
        const value = Number(slider.value);
        if (solarLimitPending) return;
        if (solarLimitConsentEntity === entity.id) {
          await applyLimit(value);
          return;
        }
        const dialog = element('dialog', 'thermal-dialog');
        dialog.setAttribute('aria-label', 'Omvormerlimiet bevestigen');
        dialog.append(element('h2', '', 'Direct toepassen toestaan?'), element('p', '', `De omvormerlimiet wordt ingesteld op ${number(value)}%. Daarna worden sliderwijzigingen in deze browsersessie direct toegepast bij loslaten. 100% is volledige productie.`));
        const actions = element('div', 'dialog-actions');
        actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
        const confirm = element('button', 'primary-button', 'Toestaan en toepassen');
        confirm.prepend(icon('check'));
        confirm.addEventListener('click', async () => {
          confirm.disabled = true;
          await applyLimit(value);
          dialog.close();
        });
        actions.append(confirm);
        dialog.append(actions);
        dialog.addEventListener('close', () => {
          slider.value = Number.isFinite(Number(entity.state)) ? Number(entity.state) : 100;
          sliderLabel.querySelector('.solar-limit-value').textContent = `${number(Number(slider.value))}%`;
          dialog.remove();
        });
        document.body.append(dialog);
        createIcons({ icons });
        dialog.showModal();
      });
      if (!data.controlStatus?.activeAllowed || data.control?.mode !== 'active') solarMenu.append(element('p', 'appliance-control-note', 'Toepassen vereist vrijgave voor echte apparaatsturing en de stand Actief.'));
    }
    const setup = element('button', 'secondary-button', pvRules.length ? 'Stroomregels openen' : 'Terugdimregel toevoegen');
    setup.prepend(icon(pvRules.length ? 'list-checks' : 'sliders-horizontal'));
    setup.addEventListener('click', () => { navigate('rules'); if (!pvRules.length) editRule(null, 'pv_limit'); });
    solarMenu.append(toolButton('refresh-cw', 'Zonneopbrengst vernieuwen', () => loadSolarChart(solarPanel, true)), setup);
    solarPanel.append(section, metrics, element('p', 'solar-chart-status', 'Opbrengsthistorie laden...'));
    main.append(solarPanel);
    loadSolarChart(solarPanel, true);
    return;
  }
  const hasBatterySwitch = kind === 'battery' && data.mappings.batteryEnable;
  const hasRelatedRule = (kind === 'ev' && data.control.rules.some(rule => ['ev_enable', 'ev_current'].includes(rule.action.type))) ||
    (kind === 'battery' && data.control.rules.some(rule => rule.action.type === 'battery_power')) ||
    (kind === 'solar' && data.control.rules.some(rule => rule.action.type === 'pv_limit'));
  if (!count && !hasBatterySwitch && !hasRelatedRule) {
    main.prepend(element('p', 'empty-state', 'Koppel eerst een passende entiteit om apparaatmetingen te tonen.'));
  }
}

function batteryControlPanel(parent = main) {
  if (!data.mappings.batteryEnable) {
    const section = element('section', 'battery-control-section');
    section.append(element('h2', '', 'Accu aan/uit'), element('p', 'subtitle', 'Koppel een accuschakelaar om deze vanaf Gridnest te bedienen.'));
    const connect = element('button', 'secondary-button', 'Accuschakelaar koppelen');
    connect.prepend(icon('link'));
    connect.addEventListener('click', () => navigate('entities'));
    section.append(connect);
    parent.append(section);
    return;
  }
  const reading = data.readings.find(item => item.role === 'batteryEnable');
  const stateKnown = reading?.valid && ['on', 'off'].includes(reading.value);
  const enabled = stateKnown && reading.value === 'on';
  const section = element('section', 'battery-control-section');
  const readSwitch = () => data.entities.find(entity => entity.id === data.mappings.batteryEnable);
  const status = liveText('span', 'room-status', () => readSwitch()?.state === 'on' ? 'Actief' : readSwitch()?.state === 'off' ? 'Stand-by' : 'Status onbekend');
  const toggle = element('button', 'primary-button');
  const toggleIcon = icon(enabled ? 'pause' : 'play');
  const toggleLabel = liveText('span', '', () => readSwitch()?.state === 'on' ? 'Accu uitschakelen' : 'Accu inschakelen');
  toggle.append(toggleIcon, toggleLabel);
  bindLive(toggle, () => {
    const current = readSwitch();
    toggle.disabled = !data.controlStatus?.activeAllowed || !current?.available || !['on', 'off'].includes(current?.state);
  });
  toggle.addEventListener('click', () => {
    const executeBattery = async () => {
      try {
        const current = readSwitch();
        if (!current || !['on', 'off'].includes(current.state)) return;
        const targetEnabled = current.state !== 'on';
        const result = await api('battery/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: targetEnabled, confirm: true }) });
        notify(result.verified ? `Accuschakelaar ${targetEnabled ? 'ingeschakeld' : 'uitgeschakeld'}; status bevestigd.` : 'Accuopdracht verstuurd; de gewenste stand is nog niet teruggekoppeld.', !result.verified);
        await refresh();
      } catch (error) { notify(error.message, true); }
    };
    if (data.preferences?.confirmSwitches === false) {
      executeBattery();
    const targetEnabled = readSwitch()?.state !== 'on';
      return;
    }
    const dialog = element('dialog', 'thermal-dialog');
    dialog.setAttribute('aria-label', targetEnabled ? 'Accu activeren bevestigen' : 'Accu uitschakelen bevestigen');
    dialog.append(element('h2', '', targetEnabled ? 'Accu activeren?' : 'Accu uitschakelen?'), element('p', '', 'Dit stuurt de gekoppelde schakelaar rechtstreeks aan. Controleer eerst dat de juiste accu-entiteit gekoppeld is.'));
    const actions = element('div', 'dialog-actions');
    actions.append(toolButton('x', 'Annuleren', () => dialog.close()));
    const confirm = element('button', 'primary-button', targetEnabled ? 'Accu activeren' : 'Accu uitschakelen');
    confirm.prepend(icon('check'));
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        const result = await api('battery/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: targetEnabled, confirm: true }) });
        dialog.close();
        notify(result.verified ? `Accuschakelaar ${targetEnabled ? 'ingeschakeld' : 'uitgeschakeld'}; status bevestigd.` : 'Accuopdracht verstuurd; de gewenste stand is nog niet teruggekoppeld.', !result.verified);
        await refresh();
      } catch (error) { notify(error.message, true); confirm.disabled = false; }
    });
    actions.append(confirm);
    dialog.append(actions);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    createIcons({ icons });
    dialog.showModal();
  });
  section.append(element('h2', '', 'Accubediening'), status, toggle);
  if (!data.controlStatus?.activeAllowed) section.append(element('p', 'muted', 'Accubediening vereist vrijgave via Echte apparaatsturing in Home Assistant.'));
  parent.append(section);
}

function render() {
  if (!data) return;
  liveBindings.clear();
  for (const item of utilityCharts) item.chart.destroy();
  utilityCharts = [];
  main.replaceChildren();
  main.setAttribute('aria-busy', 'false');
  ({ overview, thermal, rules: rulesView, entities, preferences, ev: () => deviceDetail('ev'), battery: () => deviceDetail('battery'), solar: () => deviceDetail('solar') })[view]();
  createIcons({ icons });
}
function navigate(next) {
  view = next;
  for (const button of document.querySelectorAll('[data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  render();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
document.querySelector('#refresh').addEventListener('click', () => refresh(true));
const sidebar = document.querySelector('.sidebar');
const menuToggle = document.querySelector('#mobile-menu-toggle');
const menuBackdrop = document.querySelector('#nav-backdrop');
function closeMobileMenu() {
  document.body.classList.remove('nav-open');
  sidebar.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuBackdrop.hidden = true;
}
menuToggle.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('is-open');
  document.body.classList.toggle('nav-open', isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuBackdrop.hidden = !isOpen;
});
menuBackdrop.addEventListener('click', closeMobileMenu);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', closeMobileMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileMenu(); });
const themeToggle = document.querySelector('#theme-toggle');
const powerUnitToggle = document.querySelector('#power-unit-toggle');
function applyPowerUnit() {
  powerUnitToggle.textContent = powerUnit;
  powerUnitToggle.setAttribute('aria-label', `${powerUnit === 'kW' ? 'Watt' : 'Kilowatt'} tonen`);
}
function updateChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const green = styles.getPropertyValue('--green').trim();
  const muted = styles.getPropertyValue('--appliance-muted').trim();
  const line = styles.getPropertyValue('--appliance-outline').trim();
  const accent = styles.getPropertyValue('--appliance-accent').trim();
  for (const item of utilityCharts) {
    const chart = item.chart;
    if (item.utility === 'solar') {
      chart.data.datasets[0].backgroundColor = accent;
      chart.options.scales.x.border.color = line;
      chart.options.scales.x.ticks.color = muted;
    } else {
      chart.data.datasets[0].borderColor = green;
      chart.data.datasets[0].backgroundColor = `${green}24`;
      chart.options.scales.x.ticks.color = muted;
      chart.options.scales.y.grid.color = line;
      chart.options.scales.y.ticks.color = muted;
      chart.options.scales.y.title.color = muted;
    }
    chart.update('none');
  }
}
applyPowerUnit();
powerUnitToggle.addEventListener('click', () => {
  powerUnit = powerUnit === 'kW' ? 'W' : 'kW';
  try { localStorage.setItem('gridnest-power-unit', powerUnit); } catch {}
  applyPowerUnit();
  updateLiveBindings();
});
function applyTheme(theme, persist = false) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-label', dark ? 'Lichte modus inschakelen' : 'Donkere modus inschakelen');
  themeToggle.title = dark ? 'Lichte modus inschakelen' : 'Donkere modus inschakelen';
  themeToggle.replaceChildren(icon(dark ? 'sun' : 'moon'));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#151c19' : '#17694d';
  updateChartTheme();
  if (persist) {
    try { localStorage.setItem('gridnest-theme', dark ? 'dark' : 'light'); } catch {}
  }
}
let savedTheme;
try { savedTheme = localStorage.getItem('gridnest-theme'); } catch {}
applyTheme(savedTheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  updateLiveBindings();
});
createIcons({ icons });
setRefreshInterval(10);
refresh();