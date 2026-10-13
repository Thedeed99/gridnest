export function onlyRoomTargetChanged(previous, next) {
  const { targetC: previousTarget, ...previousSettings } = previous;
  const { targetC: nextTarget, ...nextSettings } = next;
  return previousTarget !== nextTarget && JSON.stringify(previousSettings) === JSON.stringify(nextSettings);
}

export function modeLabel({ demo, activeAllowed, mode }) {
  if (demo) return 'Demomodus';
  if (mode === 'active') return activeAllowed ? 'Actieve regels' : 'Actieve regels geblokkeerd';
  if (activeAllowed) return 'Sturing vrijgegeven';
  if (mode === 'preview') return 'Proefmodus';
  return 'Regels uit';
}

export function climateStatus({ available, mode, action }) {
  if (!available) return 'Niet beschikbaar';
  const actions = { heating: 'Verwarmt', cooling: 'Koelt', idle: 'Stand-by', off: 'Uit', defrosting: 'Ontdooien', drying: 'Ontvochtigen', fan: 'Ventileren' };
  const modes = { heat: 'Verwarmmodus', cool: 'Koelmodus', off: 'Uit', auto: 'Automatische modus', heat_cool: 'Automatische modus', dry: 'Ontvochtigingsmodus', fan_only: 'Ventilatiemodus' };
  return actions[action] ?? modes[mode] ?? 'Status onbekend';
}