export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`./api/${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Gridnest is niet bereikbaar. Controleer de verbinding met Home Assistant.');
  }
  const fallback = response.status === 401 || response.status === 403
    ? 'Toegang tot Gridnest verlopen of geweigerd. Open Gridnest opnieuw via Home Assistant.'
    : !response.ok
      ? `Gridnest is tijdelijk niet bereikbaar (HTTP ${response.status}).`
      : 'Gridnest ontving een ongeldig antwoord. Open Gridnest opnieuw via Home Assistant als dit aanhoudt.';
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(fallback);
  }
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : fallback);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(fallback);
  return body;
}