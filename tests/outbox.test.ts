import { describe, expect, it, vi } from 'vitest';
import { publishOutboxBatch } from '../src/workers/outbox-publisher.js';

/** Scripted pg pool: returns fixed unpublished rows and records every UPDATE it receives. */
function fakePool(rows: unknown[]) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return { rows: sql.includes('SELECT') ? rows : [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client } as any, queries, client };
}

const row = (id: string) => ({
  id, event_type: 'disaster.created', aggregate_type: 'disaster',
  aggregate_id: '11111111-1111-4111-8111-111111111111', payload: { a: 1 }, created_at: new Date('2026-01-01T00:00:00Z'),
});

describe('outbox publisher', () => {
  it('publishes unpublished rows in order with event_id = outbox id, and marks them published', async () => {
    const { pool, queries } = fakePool([row('e1'), row('e2')]);
    const publish = vi.fn(async () => {});

    expect(await publishOutboxBatch(pool, publish)).toBe(2);

    expect(publish.mock.calls.map((c: any) => c[0].event_id)).toEqual(['e1', 'e2']);
    expect((publish.mock.calls[0] as any)[0]).toMatchObject({ event_type: 'disaster.created', aggregate_type: 'disaster', occurred_at: '2026-01-01T00:00:00.000Z', payload: { a: 1 } });
    expect(queries.some((q) => q.sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
    expect(queries.filter((q) => q.sql.includes('SET published_at')).map((q) => q.params![0])).toEqual(['e1', 'e2']);
    expect(queries.at(-1)!.sql).toBe('COMMIT');
  });

  it('when Redis is down: records attempts + last_error, leaves the row unpublished, stops the batch, does not throw', async () => {
    const { pool, queries } = fakePool([row('e1'), row('e2')]);
    const publish = vi.fn(async () => { throw new Error('redis unavailable'); });

    expect(await publishOutboxBatch(pool, publish)).toBe(0);

    expect(publish).toHaveBeenCalledTimes(1); // e2 not attempted: preserve order, don't hammer Redis
    expect(queries.some((q) => q.sql.includes('SET published_at'))).toBe(false);
    const failure = queries.find((q) => q.sql.includes('last_error'))!;
    expect(failure.params).toEqual(['e1', 'redis unavailable']);
  });
});
