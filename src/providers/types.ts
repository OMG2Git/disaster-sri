/** Gemini's job: text in, place NAME out. Never coordinates. Returns null if no reliable location. */
export interface LocationExtractor {
  extractLocation(description: string): Promise<string | null>;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}

/** Turns a place name into coordinates. Returns null if nothing matched; throws on provider failure. */
export interface Geocoder {
  geocode(locationText: string): Promise<GeocodeResult | null>;
}

export interface ExternalReport {
  id: string;
  source: string;
  author: string | null;
  content: string;
  reported_at: string;
}

export interface CommunityReportsProvider {
  fetchReports(params: { query: string; disasterId: string }): Promise<ExternalReport[]>;
}

/** Thrown by providers when the upstream is down/slow/misbehaving (distinct from "no result"). */
export class ExternalServiceError extends Error {
  constructor(public service: string, message: string) {
    super(`${service}: ${message}`);
  }
}
