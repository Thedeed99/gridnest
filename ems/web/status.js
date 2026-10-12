export function modeLabel({ demo, activeAllowed, mode }) {
  if (demo) return 'Demomodus';
  if (mode === 'active') return activeAllowed ? 'Actieve regels' : 'Actieve regels geblokkeerd';
  if (activeAllowed) return 'Sturing vrijgegeven';
  if (mode === 'preview') return 'Proefmodus';
  return 'Regels uit';
}