import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../web/api.js';

test('API verwerkt JSON, proxyfouten en herstel zonder opdrachten te herhalen', async context => {
  const calls = [];
  let response = new Response(JSON.stringify({ demo: true }));
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (response instanceof Error) throw response;
    return response;
  });
  assert.deepEqual(await api('bootstrap'), { demo: true });
  assert.equal(calls[0].url, './api/bootstrap');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  for (const status of [502, 504]) {
    response = new Response(`${status}: Bad Gateway`, { status });
    await assert.rejects(api('bootstrap'), new RegExp(`HTTP ${status}`));
  }
  for (const status of [401, 403]) {
    response = new Response('Access denied', { status });
    await assert.rejects(api('bootstrap'), /Open Gridnest opnieuw via Home Assistant/);
  }
  response = new Response(JSON.stringify({ error: 'Bevestig de gewenste stand.' }), { status: 409 });
  await assert.rejects(api('ev/control', { method: 'POST', body: '{}' }), /Bevestig de gewenste stand/);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  for (const body of ['<html>Login</html>', '502: Bad Gateway', 'null', '42', '[]']) {
    response = new Response(body);
    await assert.rejects(api('bootstrap'), /ongeldig antwoord/);
  }
  response = new Error('Failed to fetch');
  await assert.rejects(api('bootstrap'), /Controleer de verbinding/);
  response = new Response(JSON.stringify({ demo: true }));
  assert.deepEqual(await api('bootstrap'), { demo: true });
});