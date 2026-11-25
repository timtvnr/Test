// Petite persistance JSON sans dépendance externe.
// Écriture atomique (fichier temporaire + rename) pour éviter la corruption.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const cache = new Map();

async function ensureDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function readStore(name, fallback) {
  if (cache.has(name)) return structuredClone(cache.get(name));
  await ensureDir();
  const file = path.join(config.dataDir, `${name}.json`);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    cache.set(name, parsed);
    return structuredClone(parsed);
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache.set(name, fallback);
      return structuredClone(fallback);
    }
    // Fichier corrompu : on garde une copie et on repart sur la valeur par défaut.
    if (err instanceof SyntaxError) {
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      cache.set(name, fallback);
      return structuredClone(fallback);
    }
    throw err;
  }
}

export async function writeStore(name, value) {
  await ensureDir();
  const file = path.join(config.dataDir, `${name}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  cache.set(name, structuredClone(value));
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
  return value;
}

export async function updateStore(name, fallback, mutator) {
  const current = await readStore(name, fallback);
  const next = (await mutator(current)) ?? current;
  return writeStore(name, next);
}
