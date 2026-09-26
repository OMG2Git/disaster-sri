import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisasterService } from '../src/modules/disasters/disaster.service.js';
import { LocationService } from '../src/modules/location/location.service.js';
import { NominatimGeocoder } from '../src/providers/nominatim.js';
import type { EventEnvelope } from '../src/types.js';
import { FakeDisasterRepo, MemoryCache } from './fakes.js';

const event = (id: string): EventEnvelope => ({
  event_id: 'e1', event_type: 'disaster.created', aggregate_type: 'disaster', aggregate_id: id,
  occurred_at: new Date().toISOString(), payload: {},
});

describe('LocationService (fake Gemini + fake geocoder)', () => {
  let repo: FakeDisasterRepo;
  let cache: MemoryCache;
  let id: string;
  const sleep = vi.fn(async (_ms: number) => {});
  const build = (extractor: any, geocoder: any, maxRetries = 3) =>
    new LocationService(repo, new DisasterService(repo, cache, 60), extractor, geocoder, { maxRetries, retryBaseMs: 100, sleep });

  beforeEach(async () => {
    repo = new FakeDisasterRepo();
    cache = new MemoryCache();
    sleep.mockClear();
    id = (await repo.create({ title: 't', description: 'Flooding in Manhattan, NYC', tags: [], status: 'ACTIVE', createdBy: 'u' })).id;
  });

  it('extracts text, geocodes, resolves, and emits disaster.location_resolved', async () => {
    const extractor = { extractLocation: vi.fn(async () => 'Manhattan, NYC') };
    const geocoder = { geocode: vi.fn(async () => ({ lat: 40.78, lng: -73.97 })) };

    await build(extractor, geocoder).handle(event(id));

    expect(extractor.extractLocation).toHaveBeenCalledWith('Flooding in Manhattan, NYC');
    expect(geocoder.geocode).toHaveBeenCalledWith('Manhattan, NYC'); // coordinates come from the geocoder, not the LLM
    expect(repo.rows.get(id)).toMatchObject({ location_status: 'RESOLVED', location_text: 'Manhattan, NYC', location: { lat: 40.78, lng: -73.97 } });
    expect(repo.outbox.map((e) => e.event_type)).toContain('disaster.location_resolved');
  });

  it('retries provider errors with exponential backoff, then succeeds', async () => {
    const extractor = { extractLocation: vi.fn().mockRejectedValueOnce(new Error('gemini 503')).mockRejectedValueOnce(new Error('gemini 503')).mockResolvedValue('Manhattan') };
    const geocoder = { geocode: vi.fn(async () => ({ lat: 1, lng: 2 })) };

    await build(extractor, geocoder).handle(event(id));

    expect(repo.rows.get(id)!.location_status).toBe('RESOLVED');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it('marks FAILED with the reason after max retries, keeping the disaster', async () => {
    const extractor = { extractLocation: vi.fn(async () => 'Manhattan') };
    const geocoder = { geocode: vi.fn(async () => { throw new Error('nominatim down'); }) };

    await build(extractor, geocoder, 3).handle(event(id));

    expect(geocoder.geocode).toHaveBeenCalledTimes(3);
    expect(repo.rows.get(id)).toMatchObject({ location_status: 'FAILED', location_error: 'nominatim down', location_attempts: 3 });
    expect(repo.rows.has(id)).toBe(true);
  });

  it('does not retry when no location can be extracted; FAILED immediately', async () => {
    const extractor = { extractLocation: vi.fn(async () => null) };
    const geocoder = { geocode: vi.fn() };

    await build(extractor, geocoder).handle(event(id));

    expect(geocoder.geocode).not.toHaveBeenCalled();
    expect(extractor.extractLocation).toHaveBeenCalledTimes(1);
    expect(repo.rows.get(id)!.location_status).toBe('FAILED');
  });

  it('is idempotent: a duplicate delivery after RESOLVED calls no provider', async () => {
    const extractor = { extractLocation: vi.fn(async () => 'Manhattan') };
    const geocoder = { geocode: vi.fn(async () => ({ lat: 1, lng: 2 })) };
    const svc = build(extractor, geocoder);

    await svc.handle(event(id));
    await svc.handle(event(id));

    expect(extractor.extractLocation).toHaveBeenCalledTimes(1);
    expect(repo.outbox.filter((e) => e.event_type === 'disaster.location_resolved')).toHaveLength(1);
  });

  it('re-resolves after the description is edited (disaster.location_requested)', async () => {
    const extractor = { extractLocation: vi.fn().mockResolvedValueOnce('Manhattan, NYC').mockResolvedValueOnce('Brooklyn, NYC') };
    const geocoder = { geocode: vi.fn(async (t: string) => (t.startsWith('Manhattan') ? { lat: 40.78, lng: -73.97 } : { lat: 40.65, lng: -73.95 })) };
    const svc = build(extractor, geocoder);

    await svc.handle(event(id));
    expect(repo.rows.get(id)).toMatchObject({ location_text: 'Manhattan, NYC', location_status: 'RESOLVED' });

    await repo.update(id, { description: 'Correction: the flooding is in Brooklyn, NYC' });
    expect(repo.rows.get(id)).toMatchObject({ location: null, location_status: 'PENDING' });
    await svc.handle({ ...event(id), event_type: 'disaster.location_requested' });

    expect(extractor.extractLocation).toHaveBeenLastCalledWith('Correction: the flooding is in Brooklyn, NYC');
    expect(repo.rows.get(id)).toMatchObject({ location_text: 'Brooklyn, NYC', location: { lat: 40.65, lng: -73.95 }, location_status: 'RESOLVED' });
  });

  it('discards a result computed from an older description if the text was edited mid-flight', async () => {
    const extractor = {
      extractLocation: vi.fn(async () => {
        await repo.update(id, { description: 'Edited while the worker was busy: Queens, NYC' }); // user edits during extraction
        return 'Manhattan, NYC'; // ...but this answer is for the OLD text
      }),
    };
    const geocoder = { geocode: vi.fn(async () => ({ lat: 40.78, lng: -73.97 })) };

    await build(extractor, geocoder).handle(event(id));

    // The stale answer must not be applied: the incident stays PENDING, waiting for its own location_requested event.
    expect(repo.rows.get(id)).toMatchObject({ location: null, location_status: 'PENDING' });
    expect(repo.outbox.filter((e) => e.event_type === 'disaster.location_resolved')).toHaveLength(0);
  });

  it('ignores events for deleted disasters and other event types', async () => {
    const extractor = { extractLocation: vi.fn() };
    const svc = build(extractor, { geocode: vi.fn() });
    await svc.handle(event('00000000-0000-4000-8000-000000000000'));
    await svc.handle({ ...event(id), event_type: 'disaster.updated' });
    expect(extractor.extractLocation).not.toHaveBeenCalled();
  });
});

describe('NominatimGeocoder (mocked fetch)', () => {
  const geocoder = (fetchImpl: any) => new NominatimGeocoder('http://nominatim.test', 'ua', 500, fetchImpl);
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('parses lat/lon strings into numbers and sends a User-Agent', async () => {
    const f = ok([{ lat: '40.7831', lon: '-73.9712', display_name: 'Manhattan' }]);
    expect(await geocoder(f).geocode('Manhattan, NYC')).toEqual({ lat: 40.7831, lng: -73.9712, displayName: 'Manhattan' });
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toContain('q=Manhattan%2C+NYC');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('ua');
  });

  it('returns null when nothing matches; throws on HTTP errors and out-of-range coordinates', async () => {
    expect(await geocoder(ok([])).geocode('Atlantis')).toBeNull();
    await expect(geocoder(vi.fn(async () => new Response('x', { status: 503 }))).geocode('x')).rejects.toThrow(/503/);
    await expect(geocoder(ok([{ lat: '95', lon: '0' }])).geocode('x')).rejects.toThrow(/out-of-range/);
  });
});
