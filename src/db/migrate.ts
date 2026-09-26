import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { createPool } from '../infra/db.js';

// Tiny forward-only migration runner: applies migrations/*.sql in name order, once each.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
const pool = createPool(loadConfig().DATABASE_URL);

const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(727274)'); // safe if several containers start together
  await client.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await client.query('SELECT name FROM _migrations')).rows.map((r) => r.name));

  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    console.log(`applying ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(await readFile(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  console.log('migrations up to date');
} finally {
  client.release();
  await pool.end();
}
