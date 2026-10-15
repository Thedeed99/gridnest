import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const retentionMs = 45 * 24 * 60 * 60 * 1000;
const sampleIntervalMs = 55 * 60 * 1000;
const entityIdPattern = /^[a-z_]+\.[a-z0-9_]+$/;

export async function createPriceHistory(directory) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'price-history.json');
  let histories = {};
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (saved.version !== 1 || !saved.histories || typeof saved.histories !== 'object' || Array.isArray(saved.histories)) {
      throw new Error('Ongeldige tariefhistorie.');
    }
    for (const [entityId, samples] of Object.entries(saved.histories)) {
      if (!entityIdPattern.test(entityId) || !Array.isArray(samples) || samples.some(sample =>
        !sample || !Number.isFinite(sample.at) || sample.value !== null && !Number.isFinite(sample.value))) throw new Error('Ongeldige tariefhistorie.');
      histories[entityId] = samples;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Opgeslagen tariefhistorie is ongeldig; herstel price-history.json voordat je start.', { cause: error });
  }

  let pending = Promise.resolve();
  const persist = () => {
    const operation = pending.then(async () => {
      await writeFile(`${path}.tmp`, `${JSON.stringify({ version: 1, histories })}\n`, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    pending = operation.catch(() => {});
    return operation;
  };

  return {
    get(entityId) {
      return structuredClone(histories[entityId] ?? []);
    },
    all() {
      return structuredClone(histories);
    },
    async record(entityId, value, at = Date.now(), minimumIntervalMs = sampleIntervalMs) {
      if (!entityIdPattern.test(entityId) || value !== null && !Number.isFinite(value) || !Number.isFinite(at) || !Number.isFinite(minimumIntervalMs) || minimumIntervalMs <= 0) return false;
      const samples = histories[entityId] ?? (histories[entityId] = []);
      const previous = samples.at(-1);
      if (previous && at <= previous.at) return false;
      if (previous && Object.is(value, previous.value) && at - previous.at < minimumIntervalMs) return false;
      samples.push({ at, value });
      const cutoff = at - retentionMs;
      const firstRetained = samples.findIndex(sample => sample.at >= cutoff);
      const keepPrevious = firstRetained > 0 && at - samples[firstRetained - 1].at <= minimumIntervalMs;
      const removeCount = firstRetained > 0 ? firstRetained - (keepPrevious ? 1 : 0) : 0;
      if (removeCount) samples.splice(0, removeCount);
      await persist();
      return true;
    },
    async close() {
      await pending;
    }
  };
}