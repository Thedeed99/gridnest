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

export function roomClimateFeedback(result, roomId, enabled) {
  if (result.thermal.mode !== 'active') return { message: 'Instelling opgeslagen; zet Warmteregelaar op Actief om apparaten te bedienen.', error: false };
  if (result.controlStatus?.error) return { message: result.controlStatus.error, error: true };
  const sources = result.thermal.sources.filter(source => source.controlRoomId === roomId && source.controlEnabled);
  const decisions = (result.controlStatus?.decisions ?? []).filter(decision => decision.origin === 'thermal' && sources.some(source => source.id === decision.sourceId));
  if (!sources.length) return { message: 'Instelling opgeslagen; kies een vrijgegeven warmtebron met deze kamer als regelkamer.', error: true };
  const issue = decisions.find(decision => ['blocked', 'paused', 'waiting'].includes(decision.status));
  if (issue) return { message: `Instelling opgeslagen; ${issue.reason}`, error: issue.status !== 'waiting' };
  if (decisions.some(decision => decision.status === 'sent')) return { message: 'Opdracht verzonden; wachten op bevestiging van het apparaat.', error: false };
  const modes = decisions.filter(decision => decision.definition?.action?.type === 'climate_mode');
  if (modes.length === sources.length && modes.every(decision => decision.status === 'stable' && (enabled ? ['heat', 'cool'].includes(decision.observed) : decision.observed === 'off'))) {
    return { message: enabled ? 'Klimaatstand bevestigd door het apparaat.' : 'Uitschakelen bevestigd door het apparaat.', error: false };
  }
  return { message: 'Instelling opgeslagen; de gewenste apparaatstand is nog niet bevestigd.', error: true };
}