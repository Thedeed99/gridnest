export function formatPower(kilowatts, unit = 'kW') {
  if (kilowatts === null || kilowatts === undefined || !Number.isFinite(kilowatts)) return 'Niet beschikbaar';
  const displayed = unit === 'W' ? kilowatts * 1000 : kilowatts;
  const maximumFractionDigits = unit === 'W' ? 0 : 2;
  return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits }).format(displayed)} ${unit}`;
}