export type Role = 'ADMIN' | 'CONTRIBUTOR';
export type DisasterStatus = 'ACTIVE' | 'RESOLVED' | 'CLOSED';
export type LocationStatus = 'PENDING' | 'RESOLVED' | 'FAILED';
export type ResourceType = 'SHELTER' | 'HOSPITAL' | 'FOOD' | 'WATER' | 'RESCUE';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithHash extends User {
  password_hash: string;
}

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
  created_at: Date;
  updated_at: Date;
}

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  distance_km: number;
  location: LatLng;
}

export interface CommunityReport {
  external_id: string;
  source: string;
  author: string | null;
  content: string;
  reported_at: string;
}

/** Envelope published on the Redis stream. `event_id` = outbox row id (consumer idempotency key). */
export interface EventEnvelope {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}
