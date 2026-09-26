import { z } from 'zod';
import { ExternalServiceError, type GeocodeResult, type Geocoder } from './types.js';

const resultSchema = z.array(
  z.object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    display_name: z.string().optional(),
  }),
);

export class NominatimGeocoder implements Geocoder {
  constructor(
    private baseUrl: string,
    private userAgent: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async geocode(locationText: string): Promise<GeocodeResult | null> {
    const url = `${this.baseUrl}/search?${new URLSearchParams({ q: locationText, format: 'jsonv2', limit: '1' })}`;
    let body: unknown;
    try {
      // Nominatim's usage policy requires an identifying User-Agent (and max ~1 req/s).
      const res = await this.fetchImpl(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      throw new ExternalServiceError('nominatim', e instanceof Error ? e.message : String(e));
    }

    const parsed = resultSchema.safeParse(body);
    if (!parsed.success) throw new ExternalServiceError('nominatim', 'unexpected response shape or out-of-range coordinates');
    const first = parsed.data[0];
    return first ? { lat: first.lat, lng: first.lon, displayName: first.display_name } : null;
  }
}
