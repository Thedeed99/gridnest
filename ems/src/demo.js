import { normalizeStates } from './home-assistant.js';

export function demoEntities() {
  const now = new Date().toISOString();
  const sensor = (entity_id, friendly_name, state, unit, device_class) => ({
    entity_id, state: String(state), last_updated: now,
    attributes: { friendly_name, unit_of_measurement: unit, device_class }
  });
  return normalizeStates([
    sensor('sensor.demo_grid_import', 'Slimme meter · Netafname', 420, 'W', 'power'),
    sensor('sensor.demo_grid_export', 'Slimme meter · Teruglevering', 0, 'W', 'power'),
    sensor('sensor.demo_grid_power', 'Slimme meter · Getekend netvermogen', 420, 'W', 'power'),
    sensor('sensor.demo_total_consumption', 'Woning · Totaal verbruik', 2970, 'W', 'power'),
    sensor('sensor.demo_known_consumption', 'Apparaten · Bekend verbruik totaal', 2200, 'W', 'power'),
    sensor('sensor.demo_battery_power', 'Batterij · Laden positief, ontladen negatief', -400, 'W', 'power'),
    sensor('sensor.demo_heating_power', 'Warmtepomp · Elektrisch vermogen', 900, 'W', 'power'),
    sensor('sensor.demo_airco_power', 'Airco · Eigen elektrisch vermogen', 0, 'W', 'power'),
    sensor('sensor.demo_fridge_power', 'Koelkast · Elektrisch vermogen', 100, 'W', 'power'),
    sensor('sensor.demo_solar', 'Omvormer · Zonnevermogen', 2150, 'W', 'power'),
    sensor('sensor.demo_temperature', 'Woonkamer · Temperatuur', 20.2, '°C', 'temperature'),
    sensor('sensor.demo_ev_power', 'Laadpaal · Vermogen', 1200, 'W', 'power'),
    sensor('sensor.demo_battery_soc', 'Thuisbatterij · Laadtoestand', 68, '%', 'battery'),
    sensor('sensor.demo_energy', 'Slimme meter · Dagverbruik', 8.4, 'kWh', 'energy'),
    sensor('binary_sensor.demo_presence', 'Woonkamer · Aanwezig', 'on', '', 'occupancy'),
    { entity_id: 'person.demo_one', state: 'home', last_updated: now, attributes: { friendly_name: 'Bewoner 1' } },
    { entity_id: 'person.demo_two', state: 'not_home', last_updated: now, attributes: { friendly_name: 'Bewoner 2' } },
    { entity_id: 'climate.demo_heating', state: 'heat', last_updated: now,
      attributes: { friendly_name: 'Woonkamer · Thermostaat', temperature: 20, hvac_modes: ['heat', 'off'], supported_features: 1, target_temp_step: 0.5, min_temp: 7, max_temp: 30 } },
    { entity_id: 'climate.demo_airco', state: 'off', last_updated: now,
      attributes: { friendly_name: 'Woonkamer · Airco', temperature: 21, hvac_modes: ['heat', 'off', 'cool'], supported_features: 1, target_temp_step: 0.5, min_temp: 16, max_temp: 30 } },
    { entity_id: 'switch.demo_ev_enable', state: 'off', last_updated: now,
      attributes: { friendly_name: 'Laadpaal · Laden toegestaan' } },
    { entity_id: 'number.demo_ev_current', state: '6', last_updated: now,
      attributes: { friendly_name: 'Laadpaal · Stroomlimiet', unit_of_measurement: 'A', min: 6, max: 16, step: 1 } },
    { entity_id: 'number.demo_battery_target', state: '0', last_updated: now,
      attributes: { friendly_name: 'Thuisbatterij · Vermogensdoel', unit_of_measurement: 'W', min: -3000, max: 3000, step: 100 } },
    { entity_id: 'number.demo_pv_limit', state: '100', last_updated: now,
      attributes: { friendly_name: 'Omvormer · Productielimiet', unit_of_measurement: '%', min: 0, max: 100, step: 1 } },
    sensor('sensor.demo_bedroom_temperature', 'Slaapkamer · Temperatuur', 18.1, '°C', 'temperature'),
    sensor('sensor.demo_attic_temperature', 'Zolder · Temperatuur', 17.4, '°C', 'temperature')
  ]);
}