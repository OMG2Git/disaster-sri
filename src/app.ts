import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Config } from './config/env.js';
import type { Cache } from './infra/cache.js';
import { createAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { AuthService } from './modules/auth/auth.service.js';
import type { UserRepository } from './modules/auth/auth.repository.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import type { DisasterRepository } from './modules/disasters/disaster.repository.js';
import { DisasterService } from './modules/disasters/disaster.service.js';
import { disasterRoutes } from './modules/disasters/disaster.routes.js';
import type { ReportRepository } from './modules/reports/report.repository.js';
import { ReportsService } from './modules/reports/report.service.js';
import { reportRoutes } from './modules/reports/report.routes.js';
import type { ResourceRepository } from './modules/resources/resource.repository.js';
import { ResourceService } from './modules/resources/resource.service.js';
import { resourceRoutes } from './modules/resources/resource.routes.js';
import { openApiSpec } from './openapi.js';
import type { CommunityReportsProvider } from './providers/types.js';

export interface AppDeps {
  config: Config;
  users: UserRepository;
  disasters: DisasterRepository;
  resources: ResourceRepository;
  reports: ReportRepository;
  cache: Cache;
  community: CommunityReportsProvider;
  /** Dependency probes for /health, e.g. { postgres: () => pool.query('select 1') } */
  healthChecks?: Record<string, () => Promise<unknown>>;
  /** Overridable so tests don't trip the limiter. */
  authRateLimitMax?: number;
  reportsPollMs?: number;
}

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off only so Swagger UI can load its inline assets
  app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '100kb' }));

  const auth = createAuth(config);
  const disasterService = new DisasterService(deps.disasters, deps.cache, config.CACHE_DISASTER_TTL_SECONDS);
  const authService = new AuthService(deps.users, config);
  const resourceService = new ResourceService(deps.resources, disasterService);
  const reportsService = new ReportsService(disasterService, deps.reports, deps.cache, deps.community, {
    ttlSeconds: config.CACHE_REPORTS_TTL_SECONDS,
    staleTtlSeconds: config.CACHE_STALE_REPORTS_TTL_SECONDS,
    externalTimeoutMs: config.EXTERNAL_API_TIMEOUT_MS,
    pollMs: deps.reportsPollMs,
  });

  app.get('/health', async (_req, res) => {
    const checks: Record<string, 'up' | 'down'> = {};
    await Promise.all(
      Object.entries(deps.healthChecks ?? {}).map(async ([name, probe]) => {
        checks[name] = await probe().then(() => 'up' as const, () => 'down' as const);
      }),
    );
    // Postgres is the source of truth: without it we're down. Redis down only degrades us.
    const status = checks.postgres === 'down' ? 'down' : Object.values(checks).includes('down') ? 'degraded' : 'ok';
    res.status(status === 'down' ? 503 : 200).json({ status, checks });
  });

  app.get('/openapi.json', (_req, res) => void res.json(openApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use('/auth', authRoutes(authService, { rateLimitMax: deps.authRateLimitMax ?? 20 }));
  app.use('/disasters', disasterRoutes(disasterService, auth));
  app.use('/disasters', resourceRoutes(resourceService));
  app.use('/disasters', reportRoutes(reportsService));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
