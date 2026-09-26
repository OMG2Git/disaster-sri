import { createHash } from 'node:crypto';
import express from 'express';

/**
 * Stand-in for an external social-media/community service.
 *   ?scenario=success (default) | error (HTTP 500) | slow (delayed) | empty
 * Reports are deterministic per query so tests and dedup behave predictably.
 */
export function createMockApp(slowMs = 6000) {
  const app = express();

  app.get('/external/community-reports', async (req, res) => {
    const query = String(req.query.query ?? 'unknown');
    const scenario = String(req.query.scenario ?? 'success');

    if (scenario === 'error') {
      res.status(500).json({ error: 'simulated upstream failure' });
      return;
    }
    if (scenario === 'slow') await new Promise((r) => setTimeout(r, slowMs));
    if (scenario === 'empty') {
      res.json({ reports: [] });
      return;
    }

    const h = createHash('sha1').update(query).digest('hex').slice(0, 8);
    const now = Date.now();
    const texts = [
      `Water rising fast near ${query}, roads are blocked.`,
      `Volunteers are gathering supplies for people affected around ${query}.`,
      `Power is out in parts of ${query}. Please check on your neighbours.`,
    ];
    res.json({
      reports: texts.map((content, i) => ({
        id: `ext-${h}-${i + 1}`,
        source: 'mock-social',
        author: `user${100 + i}`,
        content,
        reported_at: new Date(now - (i + 1) * 15 * 60_000).toISOString(),
      })),
    });
  });

  app.get('/health', (_req, res) => void res.json({ status: 'ok' }));
  return app;
}
