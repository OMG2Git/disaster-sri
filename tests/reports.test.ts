import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockApp } from '../mock-community-api/app.js';
import { HttpCommunityReportsProvider } from '../src/providers/community.js';
import { login, setup } from './helpers.js';

const disaster = { title: 'Flood', description: 'Flooding in Manhattan', tags: [] };

async function withDisaster(ctx: ReturnType<typeof setup>) {
  const auth = await login(ctx.app, ctx.fakes, 'c@x.com');
  const { body } = await request(ctx.app).post('/disasters').set(auth).send(disaster);
  return body.id as string;
}

describe('GET /disasters/:id/reports (fake provider)', () => {
  it('fetches, normalizes, persists, then serves from cache', async () => {
    const ctx = setup();
    const id = await withDisaster(ctx);

    const first = await request(ctx.app).get(`/disasters/${id}/reports`).expect(200);
    expect(first.body.meta).toEqual({ source: 'external', stale: false });
    expect(first.body.reports[0]).toEqual({
      external_id: 'ext-1', source: 'mock-social', author: 'user1', content: 'Flooding near downtown.', reported_at: '2026-01-01T10:00:00.000Z',
    });
    expect(first.body.reports[1].author).toBeNull();
    expect(ctx.fakes.reports.byKey.size).toBe(2);

    const second = await request(ctx.app).get(`/disasters/${id}/reports`).expect(200);
    expect(second.body.meta.source).toBe('cache');
    expect(ctx.fakes.community.calls).toBe(1);
  });

  it('is idempotent: refetching the same external reports does not duplicate rows', async () => {
    const ctx = setup();
    const id = await withDisaster(ctx);
    await request(ctx.app).get(`/disasters/${id}/reports`);
    await ctx.fakes.cache.del(`community_reports:disaster:${id}`); // force a second external fetch
    await request(ctx.app).get(`/disasters/${id}/reports`);
    expect(ctx.fakes.community.calls).toBe(2);
    expect(ctx.fakes.reports.byKey.size).toBe(2);
  });

  it('returns 503 with a clear message (no stack) when upstream fails and nothing is cached', async () => {
    const ctx = setup();
    const id = await withDisaster(ctx);
    ctx.fakes.community.mode = 'fail';

    const res = await request(ctx.app).get(`/disasters/${id}/reports`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/upstream down|stack|at /);
  });

  it('serves stale cached data when the upstream fails after the fresh entry expired', async () => {
    const ctx = setup();
    const id = await withDisaster(ctx);
    await request(ctx.app).get(`/disasters/${id}/reports`).expect(200); // primes fresh + stale keys
    await ctx.fakes.cache.del(`community_reports:disaster:${id}`); // fresh TTL expired
    ctx.fakes.community.mode = 'fail';

    const res = await request(ctx.app).get(`/disasters/${id}/reports`).expect(200);

    expect(res.body.meta).toEqual({ source: 'stale-cache', stale: true });
    expect(res.body.reports).toHaveLength(2);
  });

  it('coalesces concurrent cache misses into a single upstream call', async () => {
    const ctx = setup();
    const id = await withDisaster(ctx);
    ctx.fakes.community.delayMs = 100;

    const responses = await Promise.all(Array.from({ length: 10 }, () => request(ctx.app).get(`/disasters/${id}/reports`)));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(ctx.fakes.community.calls).toBe(1);
  });

  it('404s for an unknown disaster', async () => {
    const ctx = setup();
    await request(ctx.app).get('/disasters/11111111-1111-4111-8111-111111111111/reports').expect(404);
  });
});

describe('HttpCommunityReportsProvider against the real mock service', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createMockApp(1500).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => void server.close());

  const params = { query: 'Manhattan', disasterId: 'd1' };

  it('success: returns validated reports', async () => {
    const reports = await new HttpCommunityReportsProvider(base, 1000).fetchReports(params);
    expect(reports).toHaveLength(3);
    expect(reports[0]).toMatchObject({ source: 'mock-social', id: expect.stringMatching(/^ext-/) });
  });

  it('empty scenario: returns []', async () => {
    expect(await new HttpCommunityReportsProvider(base, 1000, 'empty').fetchReports(params)).toEqual([]);
  });

  it('error scenario: throws on HTTP 500', async () => {
    await expect(new HttpCommunityReportsProvider(base, 1000, 'error').fetchReports(params)).rejects.toThrow(/HTTP 500/);
  });

  it('slow scenario: times out instead of hanging', async () => {
    const started = Date.now();
    await expect(new HttpCommunityReportsProvider(base, 200, 'slow').fetchReports(params)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it('end to end through the API: mock 500 => 503 response', async () => {
    const ctx = setup({ community: new HttpCommunityReportsProvider(base, 1000, 'error') });
    const id = await withDisaster(ctx);
    await request(ctx.app).get(`/disasters/${id}/reports`).expect(503);
  });
});
