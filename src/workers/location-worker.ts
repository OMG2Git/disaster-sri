import { hostname } from 'node:os';
import { loadConfig } from '../config/env.js';
import { RedisCache, createCacheRedis } from '../infra/cache.js';
import { createPool } from '../infra/db.js';
import { GROUP_LOCATION, consume, createStreamRedis } from '../infra/event-bus.js';
import { PgDisasterRepository } from '../modules/disasters/disaster.repository.js';
import { DisasterService } from '../modules/disasters/disaster.service.js';
import { LocationService } from '../modules/location/location.service.js';
import { GeminiLocationExtractor } from '../providers/gemini.js';
import { NominatimGeocoder } from '../providers/nominatim.js';
import { logger } from '../utils/logger.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const repo = new PgDisasterRepository(pool);
const disasters = new DisasterService(repo, new RedisCache(createCacheRedis(config.REDIS_URL)), config.CACHE_DISASTER_TTL_SECONDS);

const service = new LocationService(
  repo,
  disasters,
  new GeminiLocationExtractor(config.GEMINI_API_KEY, config.GEMINI_MODEL, config.EXTERNAL_API_TIMEOUT_MS),
  new NominatimGeocoder(config.NOMINATIM_BASE_URL, config.NOMINATIM_USER_AGENT, config.EXTERNAL_API_TIMEOUT_MS),
  { maxRetries: config.LOCATION_MAX_RETRIES, retryBaseMs: config.LOCATION_RETRY_BASE_MS },
);

const abort = new AbortController();
process.on('SIGINT', () => abort.abort());
process.on('SIGTERM', () => abort.abort());

logger.info('location worker started');
// minIdle > worst-case handler time (retries+backoff), so a slow-but-alive handler isn't re-claimed.
await consume(createStreamRedis(config.REDIS_URL), {
  group: GROUP_LOCATION,
  consumer: `${hostname()}-${process.pid}`,
  handler: (e) => service.handle(e),
  signal: abort.signal,
  startId: '0',
  minIdleMs: 60_000,
});
await pool.end();
process.exit(0);
