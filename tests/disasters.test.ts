import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { listCacheKey } from '../src/modules/disasters/disaster.service.js';
import { withJitter } from '../src/infra/cache.js';
import { login, setup } from './helpers.js';

const valid = { title: 'Heavy flooding in Manhattan', description: 'Heavy flooding has affected Manhattan, NYC.', tags: ['Flood', 'urban'] };

describe('POST /disasters', () => {
  it('creates the disaster PENDING and writes a disaster.created outbox event', async () => {
    const { app, fakes } = setup();
    const auth = await login(app, fakes, 'c@x.com');

    const res = await request(app).post('/disasters').set(auth).send(valid);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ location_status: 'PENDING', location: null, status: 'ACTIVE', tags: ['flood', 'urban'] });
    expect(fakes.disasters.rows.has(res.body.id)).toBe(true);
    expect(fakes.disasters.outbox).toHaveLength(1);
    expect(fakes.disasters.outbox[0]).toMatchObject({ event_type: 'disaster.created', aggregate_id: res.body.id });
  });

  it('rejects an empty title with a 400 VALIDATION_ERROR and creates nothing', async () => {
    const { app, fakes } = setup();
    const auth = await login(app, fakes, 'c@x.com');

    const res = await request(app).post('/disasters').set(auth).send({ ...valid, title: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
    expect(fakes.disasters.rows.size).toBe(0);
    expect(fakes.disasters.outbox).toHaveLength(0);
  });

  it('requires authentication (401 without token, 401 with garbage token)', async () => {
    const { app } = setup();
    await request(app).post('/disasters').send(valid).expect(401);
    await request(app).post('/disasters').set('Authorization', 'Bearer nope').send(valid).expect(401);
  });
});

describe('PATCH/DELETE authorization', () => {
  async function seeded() {
    const ctx = setup();
    const a = await login(ctx.app, ctx.fakes, 'a@x.com');
    const b = await login(ctx.app, ctx.fakes, 'b@x.com');
    const admin = await login(ctx.app, ctx.fakes, 'admin@x.com', { promoteToAdmin: true });
    const created = await request(ctx.app).post('/disasters').set(b).send(valid);
    return { ...ctx, a, b, admin, id: created.body.id as string };
  }

  it("contributor A cannot update contributor B's disaster (403); admin can; owner can", async () => {
    const { app, fakes, a, b, admin, id } = await seeded();

    await request(app).patch(`/disasters/${id}`).set(a).send({ title: 'hijack' }).expect(403);
    expect(fakes.disasters.rows.get(id)!.title).toBe(valid.title);

    const byAdmin = await request(app).patch(`/disasters/${id}`).set(admin).send({ status: 'RESOLVED' });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.status).toBe('RESOLVED');

    await request(app).patch(`/disasters/${id}`).set(b).send({ title: 'mine' }).expect(200);
    expect(fakes.disasters.outbox.filter((e) => e.event_type === 'disaster.updated')).toHaveLength(2);
  });

  it('rejects unknown/forbidden fields on PATCH (cannot set location or created_by)', async () => {
    const { app, b, id } = await seeded();
    await request(app).patch(`/disasters/${id}`).set(b).send({ location_status: 'RESOLVED' }).expect(400);
    await request(app).patch(`/disasters/${id}`).set(b).send({}).expect(400);
  });

  it('only ADMIN can delete; delete emits disaster.deleted', async () => {
    const { app, fakes, b, admin, id } = await seeded();
    await request(app).delete(`/disasters/${id}`).set(b).expect(403);
    await request(app).delete(`/disasters/${id}`).expect(401);
    await request(app).delete(`/disasters/${id}`).set(admin).expect(204);
    await request(app).get(`/disasters/${id}`).expect(404);
    expect(fakes.disasters.outbox.at(-1)?.event_type).toBe('disaster.deleted');
  });
});

describe('editing the description re-runs location resolution', () => {
  async function resolvedDisaster() {
    const ctx = setup();
    const auth = await login(ctx.app, ctx.fakes, 'c@x.com');
    const { body } = await request(ctx.app).post('/disasters').set(auth).send(valid);
    await ctx.fakes.disasters.resolveLocation(body.id, 'Manhattan, NYC', 40.78, -73.97, valid.description);
    ctx.fakes.disasters.outbox.length = 0;
    return { ...ctx, auth, id: body.id as string };
  }

  it('clears the old location, sets PENDING and emits disaster.location_requested', async () => {
    const { app, fakes, auth, id } = await resolvedDisaster();

    const res = await request(app).patch(`/disasters/${id}`).set(auth).send({ description: 'Actually the flooding is in Brooklyn, NYC.' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ location: null, location_text: null, location_status: 'PENDING', location_attempts: 0, location_error: null });
    expect(fakes.disasters.outbox.map((e) => e.event_type)).toEqual(['disaster.updated', 'disaster.location_requested']);
  });

  it('does not touch the location when only other fields change, or the description is unchanged', async () => {
    const { app, fakes, auth, id } = await resolvedDisaster();

    await request(app).patch(`/disasters/${id}`).set(auth).send({ title: 'New title', tags: ['x'] }).expect(200);
    await request(app).patch(`/disasters/${id}`).set(auth).send({ description: valid.description }).expect(200);

    expect(fakes.disasters.rows.get(id)).toMatchObject({ location_status: 'RESOLVED', location_text: 'Manhattan, NYC' });
    expect(fakes.disasters.outbox.map((e) => e.event_type)).toEqual(['disaster.updated', 'disaster.updated']);
  });
});

describe('reads + cache-aside', () => {
  it('serves GET /disasters/:id from cache on the second call and drops it on PATCH', async () => {
    const { app, fakes } = setup();
    const auth = await login(app, fakes, 'c@x.com');
    const { body } = await request(app).post('/disasters').set(auth).send(valid);

    await request(app).get(`/disasters/${body.id}`).expect(200);
    await request(app).get(`/disasters/${body.id}`).expect(200);
    const dbReadsAfterTwoGets = fakes.disasters.findCalls;
    expect(dbReadsAfterTwoGets).toBe(1);

    await request(app).patch(`/disasters/${body.id}`).set(auth).send({ title: 'Updated' }).expect(200); // +1 read for ownership check
    const fresh = await request(app).get(`/disasters/${body.id}`);
    expect(fresh.body.title).toBe('Updated'); // not the stale cached copy
  });

  it('caches list queries, and a new disaster invalidates them', async () => {
    const { app, fakes } = setup();
    const auth = await login(app, fakes, 'c@x.com');
    await request(app).post('/disasters').set(auth).send(valid);

    await request(app).get('/disasters?tag=flood&status=ACTIVE').expect(200);
    await request(app).get('/disasters?status=ACTIVE&tag=flood').expect(200); // same logical query
    expect(fakes.disasters.listCalls).toBe(1);

    await request(app).post('/disasters').set(auth).send(valid);
    const list = await request(app).get('/disasters?tag=flood&status=ACTIVE');
    expect(list.body).toHaveLength(2);
  });

  it('400s on invalid query params and malformed ids', async () => {
    const { app } = setup();
    await request(app).get('/disasters?status=NOPE').expect(400);
    await request(app).get('/disasters/not-a-uuid').expect(400);
  });

  it('still works when the cache layer is a no-op (Redis down => DB fallback)', async () => {
    const noop = { getJson: async () => null, setJson: async () => {}, del: async () => {}, delByPrefix: async () => {}, acquireLock: async () => true, releaseLock: async () => {} };
    const ctx = setup({ cache: noop });
    const auth = await login(ctx.app, ctx.fakes, 'c@x.com');
    const { body } = await request(ctx.app).post('/disasters').set(auth).send(valid);
    await request(ctx.app).get(`/disasters/${body.id}`).expect(200);
  });
});

describe('cache helpers', () => {
  it('list cache key is order-independent', () => {
    const a = listCacheKey({ tag: 'flood', status: 'ACTIVE', limit: 50, offset: 0 });
    const b = listCacheKey({ status: 'ACTIVE', offset: 0, limit: 50, tag: 'flood' });
    expect(a).toBe(b);
    expect(a).toBe('disasters:list:limit=50&offset=0&status=ACTIVE&tag=flood');
  });

  it('TTL jitter stays within [ttl, ttl*1.1]', () => {
    for (let i = 0; i < 200; i++) {
      const t = withJitter(60);
      expect(t).toBeGreaterThanOrEqual(60);
      expect(t).toBeLessThanOrEqual(66);
    }
  });
});

describe('misc', () => {
  it('404s unknown routes with the standard error shape and health reports degraded when Redis is down', async () => {
    const { app } = setup({
      healthChecks: { postgres: async () => 1, redis: async () => { throw new Error('down'); } },
    });
    const nf = await request(app).get('/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    const h = await request(app).get('/health');
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ status: 'degraded', checks: { postgres: 'up', redis: 'down' } });
  });
});
