import { Redis } from 'ioredis';
import type { EventEnvelope } from '../types.js';
import { errMsg, logger } from '../utils/logger.js';

export const STREAM = 'disaster-events';
export const GROUP_LOCATION = 'location-workers';
export const GROUP_REALTIME = 'realtime-service';

/** Streams/consumers use blocking commands, so they get their own patient (auto-retrying) connection. */
export function createStreamRedis(url: string): Redis {
  const redis = new Redis(url);
  redis.on('error', (e) => logger.warn('redis error', { error: e.message }));
  return redis;
}

export async function publishEvent(redis: Redis, event: EventEnvelope): Promise<void> {
  // ~ = approximate trim: keeps memory bounded without an exact-trim cost.
  await redis.xadd(STREAM, 'MAXLEN', '~', 100000, '*', 'event', JSON.stringify(event));
}

type StreamEntry = [id: string, fields: string[]];

interface ConsumeOptions {
  group: string;
  consumer: string;
  handler: (event: EventEnvelope) => Promise<void>;
  signal: AbortSignal;
  /** '0' = a brand-new group processes the whole history; '$' = only new events. */
  startId?: '0' | '$';
  /** Pending messages idle longer than this are reclaimed (crashed / failed consumer). */
  minIdleMs?: number;
  blockMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Consumer-group loop: reclaim stale pending messages, then read new ones.
 * A message is ACKed only after the handler resolves. If the handler throws, the
 * message stays in the pending list and is re-delivered after `minIdleMs`.
 */
export async function consume(redis: Redis, opts: ConsumeOptions): Promise<void> {
  const { group, consumer, handler, signal, startId = '0', minIdleMs = 30_000, blockMs = 5000 } = opts;

  try {
    await redis.xgroup('CREATE', STREAM, group, startId, 'MKSTREAM');
  } catch (e) {
    if (!errMsg(e).includes('BUSYGROUP')) throw e;
  }

  const process = async (entries: StreamEntry[]) => {
    for (const [id, fields] of entries) {
      let event: EventEnvelope;
      try {
        event = JSON.parse(fields[1]);
      } catch {
        logger.error('dropping malformed stream message', { id, group });
        await redis.xack(STREAM, group, id);
        continue;
      }
      try {
        await handler(event);
        await redis.xack(STREAM, group, id);
      } catch (e) {
        logger.error('event handler failed; left pending for redelivery', {
          id, group, event_id: event.event_id, error: errMsg(e),
        });
      }
    }
  };

  while (!signal.aborted) {
    try {
      const claimed = (await redis.xautoclaim(STREAM, group, consumer, minIdleMs, '0', 'COUNT', 10)) as unknown as [
        string,
        StreamEntry[],
      ];
      await process(claimed[1] ?? []);

      const res = (await redis.xreadgroup(
        'GROUP', group, consumer, 'COUNT', 10, 'BLOCK', blockMs, 'STREAMS', STREAM, '>',
      )) as [string, StreamEntry[]][] | null;
      for (const [, entries] of res ?? []) await process(entries);
    } catch (e) {
      if (signal.aborted) return;
      logger.error('stream consume loop error', { group, error: errMsg(e) });
      await sleep(1000);
    }
  }
}
