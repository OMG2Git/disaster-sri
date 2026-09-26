import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { RedisCache, createCacheRedis } from './infra/cache.js';
import { createPool } from './infra/db.js';
import { PgUserRepository } from './modules/auth/auth.repository.js';
import { PgDisasterRepository } from './modules/disasters/disaster.repository.js';
import { PgReportRepository } from './modules/reports/report.repository.js';
import { PgResourceRepository } from './modules/resources/resource.repository.js';
import { HttpCommunityReportsProvider } from './providers/community.js';
import { logger } from './utils/logger.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const redis = createCacheRedis(config.REDIS_URL);

const app = createApp({
  config,
  users: new PgUserRepository(pool),
  disasters: new PgDisasterRepository(pool),
  resources: new PgResourceRepository(pool),
  reports: new PgReportRepository(pool),
  cache: new RedisCache(redis),
  community: new HttpCommunityReportsProvider(
    config.COMMUNITY_API_URL,
    config.EXTERNAL_API_TIMEOUT_MS,
    config.COMMUNITY_API_SCENARIO || undefined,
  ),
  healthChecks: {
    postgres: () => pool.query('SELECT 1'),
    redis: () => redis.ping(),
  },
});

const server = app.listen(config.PORT, () => logger.info('api listening', { port: config.PORT }));

const shutdown = () => {
  server.close(() => void Promise.all([pool.end(), redis.quit()]).finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
