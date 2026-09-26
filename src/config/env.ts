import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  REALTIME_PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  NOMINATIM_BASE_URL: z.string().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: z.string().default('disaster-response-takehome/1.0'),
  COMMUNITY_API_URL: z.string().default('http://localhost:4000'),
  COMMUNITY_API_SCENARIO: z.string().optional(),
  CACHE_DISASTER_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  CACHE_REPORTS_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  CACHE_STALE_REPORTS_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  LOCATION_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  LOCATION_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(1000),
  CORS_ORIGIN: z.string().default('*'),
});

export type Config = z.infer<typeof schema>;

/** Validates env vars once at process start; fails fast with a readable message. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  return parsed.data;
}
