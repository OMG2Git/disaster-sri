import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { createPool, type Pool } from '../infra/db.js';
import { createStreamRedis, publishEvent } from '../infra/event-bus.js';
import type { EventEnvelope } from '../types.js';
import { errMsg, logger } from '../utils/logger.js';

/**
 * Publishes one batch of unpublished outbox rows. Returns how many were published.
 * FOR UPDATE SKIP LOCKED lets several publishers run concurrently without double-picking rows.
 * Delivery is at-least-once (crash between XADD and COMMIT re-publishes) - consumers dedupe on event_id.
 */
export async function publishOutboxBatch(
  pool: Pool,
  publish: (e: EventEnvelope) => Promise<void>,
  limit = 50,
): Promise<number> {
  const client = await pool.connect();
  let published = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload, created_at
         FROM outbox_events WHERE published_at IS NULL
        ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const row of rows) {
      try {
        await publish({
          event_id: row.id,
          event_type: row.event_type,
          aggregate_type: row.aggregate_type,
          aggregate_id: row.aggregate_id,
          occurred_at: new Date(row.created_at).toISOString(),
          payload: row.payload,
        });
        await client.query('UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
        published++;
      } catch (e) {
        logger.error('outbox publish failed', { outbox_id: row.id, event_type: row.event_type, error: errMsg(e) });
        await client.query('UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [
          row.id, errMsg(e),
        ]);
        break; // Redis is likely down; keep order and retry on the next tick instead of hammering it.
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return published;
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const redis = createStreamRedis(config.REDIS_URL);
  let running = true;
  const stop = () => (running = false);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  logger.info('outbox publisher started');
  while (running) {
    let n = 0;
    try {
      n = await publishOutboxBatch(pool, (e) => publishEvent(redis, e));
    } catch (e) {
      logger.error('outbox poll failed', { error: errMsg(e) });
    }
    // Busy: poll again immediately. Idle/failing: wait a second.
    if (n === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  await Promise.all([pool.end(), redis.quit()]);
}

// Only run when executed directly (so tests can import publishOutboxBatch).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
