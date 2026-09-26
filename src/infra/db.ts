import pg from 'pg';

export type Pool = pg.Pool;
export type Queryable = Pick<pg.PoolClient, 'query'>;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000 });
}

/** Runs `fn` inside a transaction; commits on success, rolls back on any throw. */
export async function withTx<T>(pool: Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Writes an outbox row. Must be called with the SAME client as the business write. */
export async function insertOutbox(
  client: Queryable,
  eventType: string,
  aggregateId: string,
  payload: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1, 'disaster', $2, $3::jsonb)`,
    [eventType, aggregateId, JSON.stringify(payload)],
  );
}
