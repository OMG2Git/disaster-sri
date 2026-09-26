import { hostname } from 'node:os';
import cors from 'cors';
import express from 'express';
import { loadConfig } from '../config/env.js';
import { GROUP_REALTIME, consume, createStreamRedis } from '../infra/event-bus.js';
import { SseHub } from '../modules/realtime/sse-hub.js';
import { logger } from '../utils/logger.js';

const BROADCAST = new Set([
  'disaster.created',
  'disaster.updated',
  'disaster.deleted',
  'disaster.location_resolved',
]);

const config = loadConfig();
const hub = new SseHub();

const app = express();
app.use(cors({ origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN.split(',') }));
app.get('/events/disasters', (req, res) => hub.connect(req, res));
app.get('/health', (_req, res) => void res.json({ status: 'ok', clients: hub.size }));
const server = app.listen(config.REALTIME_PORT, () => logger.info('realtime listening', { port: config.REALTIME_PORT }));

const abort = new AbortController();
const shutdown = () => {
  abort.abort();
  hub.closeAll();
  server.close();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Live feed: a fresh group starts at '$' (only new events); no need to replay history to browsers.
await consume(createStreamRedis(config.REDIS_URL), {
  group: GROUP_REALTIME,
  consumer: `${hostname()}-${process.pid}`,
  handler: async (event) => {
    if (BROADCAST.has(event.event_type)) hub.broadcast(event);
  },
  signal: abort.signal,
  startId: '$',
});
process.exit(0);
