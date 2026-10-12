function powerKw(entity, signed = false) {
  if (!entity?.available || entity.domain !== 'sensor' || !['W', 'kW'].includes(entity.unit) || entity.state.trim() === '') return null;
  const value = Number(entity.state);
  if (!Number.isFinite(value) || (!signed && value < 0)) return null;
  return entity.unit === 'W' ? value / 1000 : value;
}

export function energySummary(mappings, entities) {
  const find = id => entities.find(entity => entity.id === id);
  const get = (role, signed = false) => powerKw(find(mappings[role]), signed);
  const signedGrid = mappings.gridMode === 'signed';
  const rawNet = get('gridPower', true);
  const netKw = rawNet === null ? null : rawNet * (mappings.gridDirection === 'positive-export' ? -1 : 1);
  const importKw = signedGrid ? netKw === null ? null : Math.max(0, netKw) : get('gridImport');
  const exportKw = signedGrid ? netKw === null ? null : Math.max(0, -netKw) : get('gridExport');
  const solarKw = get('solar');
  const warnings = [];
  const direct = Boolean(mappings.totalConsumption);
  let totalKw = direct ? get('totalConsumption') : null;
  let totalSource = direct ? 'sensor' : 'unavailable';
  if (!direct) {
    let batteryKw = null;
    if (mappings.batteryMode === 'none') batteryKw = 0;
    if (mappings.batteryMode === 'measured') {
      const value = get('batteryPower', true);
      batteryKw = value === null ? null : value * (mappings.batteryDirection === 'positive-discharge' ? -1 : 1);
    }
    if ([importKw, exportKw, solarKw, batteryKw].every(value => value !== null)) {
      const calculated = solarKw + importKw - exportKw - batteryKw;
      if (calculated >= 0) {
        totalKw = calculated;
        totalSource = 'balance';
      } else warnings.push('De energiebalans is negatief. Controleer tekenrichting, meetpunten en meetmomenten.');
    }
    if (mappings.batteryMode === 'unknown') warnings.push('Batterijsituatie onbekend: koppel totaal woningverbruik of geef aan of er een batterij is.');
  }
  if (totalKw === null) warnings.push('Totaal woningverbruik niet beschikbaar. Netafname alleen is geen woningverbruik.');
  const consumers = (mappings.knownConsumers ?? []).map(id => ({ id, name: find(id)?.name ?? id, powerKw: powerKw(find(id)) }));
  const aggregate = mappings.knownSource === 'aggregate';
  const knownKw = aggregate ? get('knownConsumption') : consumers.length && consumers.every(item => item.powerKw !== null) ? consumers.reduce((sum, item) => sum + item.powerKw, 0) : null;
  if (knownKw === null) warnings.push(aggregate ? 'Bekend-verbruiksensor niet beschikbaar.' : 'Selecteer bekende apparaten; alle geselecteerde metingen moeten beschikbaar zijn.');
  const mismatch = totalKw !== null && knownKw !== null && knownKw > totalKw;
  if (mismatch) warnings.push('Bekend verbruik is hoger dan totaalverbruik. Controleer overlappende meters en meetmomenten.');
  return {
    importKw, exportKw, totalKw, totalSource, knownKw,
    unknownKw: totalKw !== null && knownKw !== null && !mismatch ? totalKw - knownKw : null,
    consumers: aggregate ? [] : consumers,
    status: mismatch ? 'mismatch' : totalKw === null || knownKw === null ? 'incomplete' : 'complete', warnings
  };
}