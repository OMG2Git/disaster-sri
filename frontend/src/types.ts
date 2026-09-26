export type Role = 'ADMIN' | 'CONTRIBUTOR';
export const DISASTER_STATUSES = ['ACTIVE', 'RESOLVED', 'CLOSED'] as const;
export type DisasterStatus = (typeof DISASTER_STATUSES)[number];
export const RESOURCE_TYPES = ['SHELTER', 'HOSPITAL', 'FOOD', 'WATER', 'RESCUE'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type LocationStatus = 'PENDING' | 'RESOLVED' | 'FAILED';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Disaster {
  id: string;
  title: string;
  description: string;
  location_text: string | null;
  location: LatLng | null;
  location_status: LocationStatus;
  location_attempts: number;
  location_error: string | null;
  tags: string[];
  status: DisasterStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  distance_km: number;
  location: LatLng;
}

export interface Report {
  external_id: string;
  source: string;
  author: string | null;
  content: string;
  reported_at: string;
}

export interface ReportsResponse {
  reports: Report[];
  meta: { source: 'cache' | 'external' | 'stale-cache'; stale: boolean };
}

export interface DisasterEvent {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  occurred_at: string;
  payload: Partial<Disaster>;
}

export interface Health {
  status: 'ok' | 'degraded' | 'down';
  checks: Record<string, 'up' | 'down'>;
}
