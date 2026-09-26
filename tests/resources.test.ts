import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { login, setup } from './helpers.js';

async function ctxWithDisaster() {
  const findNearby = vi.fn(async () => [{ id: 'r1', name: 'City Hospital', type: 'HOSPITAL', distance_km: 1.42, location: { lat: 40.78, lng: -73.97 } }]);
  const ctx = setup({ resources: { findNearby } });
  const auth = await login(ctx.app, ctx.fakes, 'c@x.com');
  const { body } = await request(ctx.app).post('/disasters').set(auth).send({ title: 'Flood', description: 'Flood in NYC' });
  return { ...ctx, findNearby, id: body.id as string };
}

describe('GET /disasters/:id/resources', () => {
  it('converts km to meters and uses the supplied center', async () => {
    const { app, id, findNearby } = await ctxWithDisaster();
    const res = await request(app).get(`/disasters/${id}/resources?lat=40.78&lng=-73.97&radius=5`).expect(200);
    expect(res.body.resources[0].name).toBe('City Hospital');
    expect(findNearby).toHaveBeenCalledWith(expect.objectContaining({ lat: 40.78, lng: -73.97, radiusMeters: 5000 }));
  });

  it('falls back to the disaster location when lat/lng are omitted', async () => {
    const { app, id, fakes, findNearby } = await ctxWithDisaster();
    await fakes.disasters.resolveLocation(id, 'NYC', 40.7, -74, 'Flood in NYC');
    await request(app).get(`/disasters/${id}/resources?radius=2`).expect(200);
    expect(findNearby).toHaveBeenCalledWith(expect.objectContaining({ lat: 40.7, lng: -74, radiusMeters: 2000 }));
  });

  it('422s when there is no center (location still PENDING)', async () => {
    const { app, id } = await ctxWithDisaster();
    const res = await request(app).get(`/disasters/${id}/resources?radius=2`).expect(422);
    expect(res.body.error.message).toMatch(/PENDING/);
  });

  it.each([
    'lat=91&lng=0&radius=5',
    'lat=0&lng=181&radius=5',
    'lat=0&lng=0&radius=-1',
    'lat=0&lng=0&radius=0',
    'lat=0&lng=0&radius=99999',
    'lat=0&radius=5', // lat without lng
  ])('400s on invalid params: %s', async (qs) => {
    const { app, id } = await ctxWithDisaster();
    await request(app).get(`/disasters/${id}/resources?${qs}`).expect(400);
  });
});
