import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPriceHistory } from '../src/price-history.js';

test('tariefhistorie bewaart wijzigingen en uurmomenten na herstart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gridnest-price-history-'));
  try {
    const history = await createPriceHistory(directory);
    assert.equal(await history.record('sensor.dynamic_price', 0.2, 1000), true);
    assert.equal(await history.record('sensor.dynamic_price', 0.2, 1000 + 30 * 60 * 1000), false);
    assert.equal(await history.record('sensor.dynamic_price', 0.3, 1000 + 31 * 60 * 1000), true);
    assert.equal(await history.record('sensor.dynamic_price', 0.3, 1000 + 90 * 60 * 1000), true);
    await history.close();

    const reopened = await createPriceHistory(directory);
    assert.deepEqual(reopened.get('sensor.dynamic_price'), [
      { at: 1000, value: 0.2 },
      { at: 1000 + 31 * 60 * 1000, value: 0.3 },
      { at: 1000 + 90 * 60 * 1000, value: 0.3 }
    ]);
    assert.match(await readFile(join(directory, 'price-history.json'), 'utf8'), /"version":1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('tariefhistorie verwerpt ongeldige waarden en ruimt oudere samples op', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gridnest-price-history-'));
  try {
    const history = await createPriceHistory(directory);
    const now = 100 * 24 * 60 * 60 * 1000;
    assert.equal(await history.record('sensor.dynamic_price', Number.NaN, now), false);
    assert.equal(await history.record('sensor.dynamic_price', 0.2, now - 60 * 24 * 60 * 60 * 1000), true);
    assert.equal(await history.record('sensor.dynamic_price', 0.25, now - 29 * 24 * 60 * 60 * 1000), true);
    assert.equal(await history.record('sensor.dynamic_price', 0.3, now), true);
    assert.deepEqual(history.get('sensor.dynamic_price'), [
      { at: now - 29 * 24 * 60 * 60 * 1000, value: 0.25 },
      { at: now, value: 0.3 }
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});