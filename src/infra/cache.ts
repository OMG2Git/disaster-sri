import { Redis } from 'ioredis';
import { errMsg, logger } from '../utils/logger.js';

export interface Cache {
  getJson<T>(key: string): Promise<T | null>;
  /** Stores with TTL (seconds). Every entry expires - there are no permanent keys. */
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
  /** SET NX EX. Returns true if this caller now owns the lock. */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}

/** Base TTL + up to 10% random extra, so keys written together don't all expire together. */
export function withJitter(ttlSeconds: number, ratio = 0.1): number {
  return Math.round(ttlSeconds + Math.random() * ttlSeconds * ratio);
}

/** Fail-fast client for cache traffic: a dead Redis should slow requests by ms, not hang them. */
export function createCacheRedis(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 500 });
  redis.on('error', (e) => logger.warn('redis error', { error: e.message }));
  return redis;
}

/**
 * Redis is an optimisation, never a hard dependency: every operation swallows errors
 * so callers fall back to PostgreSQL / the external API.
 */
export class RedisCache implements Cache {
  constructor(private redis: Redis) {}

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (e) {
      logger.warn('cache get failed', { key, error: errMsg(e) });
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', withJitter(ttlSeconds));
    } catch (e) {
      logger.warn('cache set failed', { key, error: errMsg(e) });
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.redis.del(...keys);
    } catch (e) {
      logger.warn('cache del failed', { keys, error: errMsg(e) });
    }
  }

  async delByPrefix(prefix: string): Promise<void> {
    try {
      const stream = this.redis.scanStream({ match: `${prefix}*`, count: 100 });
      for await (const keys of stream) {
        if ((keys as string[]).length) await this.redis.del(...(keys as string[]));
      }
    } catch (e) {
      logger.warn('cache prefix delete failed', { prefix, error: errMsg(e) });
    }
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      return (await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    } catch (e) {
      // Redis down: don't block callers on a lock nobody can hold - go straight to the source.
      logger.warn('lock acquire failed, proceeding without lock', { key, error: errMsg(e) });
      return true;
    }
  }

  async releaseLock(key: string): Promise<void> {
    await this.del(key);
  }
}
