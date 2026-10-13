export function batteryState(entity, powerW) {
  if (entity) {
    if (!entity.available) return { label: 'Status onbekend', powerW: null };
    const state = String(entity.state).trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (['bypass', 'pass through', 'passthrough', 'doorvoer', 'doorvoeren'].includes(state)) return { label: 'Doorvoer', powerW: 0 };
    if (['charging', 'charge', 'laden'].includes(state)) return { label: 'Laden', powerW: powerW === null ? null : Math.abs(powerW) };
    if (['discharging', 'discharge', 'ontladen'].includes(state)) return { label: 'Ontladen', powerW: powerW === null ? null : -Math.abs(powerW) };
    if (['idle', 'standby', 'stand by', 'not charging', 'fully charged', 'full'].includes(state)) return { label: 'Stand-by', powerW: 0 };
    return { label: `Status: ${entity.state}`, powerW: null };
  }
  return { label: powerW === null ? 'Status onbekend' : powerW > 10 ? 'Laden' : powerW < -10 ? 'Ontladen' : 'Stand-by', powerW };
}