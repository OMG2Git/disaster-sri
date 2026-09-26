import type { Pool } from '../../infra/db.js';
import type { Resource, ResourceType } from '../../types.js';

export interface ResourceRepository {
  findNearby(params: { lat: number; lng: number; radiusMeters: number; type?: ResourceType; limit: number }): Promise<Resource[]>;
}

export class PgResourceRepository implements ResourceRepository {
  constructor(private pool: Pool) {}

  async findNearby({ lat, lng, radiusMeters, type, limit }: Parameters<ResourceRepository['findNearby']>[0]) {
    // The filtering, distance math and sorting all happen inside PostGIS.
    // ST_DWithin on geography takes METERS and can use the GiST index.
    // ST_MakePoint argument order is (x = longitude, y = latitude).
    const { rows } = await this.pool.query(
      `WITH q AS (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS pt)
       SELECT r.id, r.name, r.type,
              ROUND((ST_Distance(r.location, q.pt) / 1000)::numeric, 2)::float8 AS distance_km,
              json_build_object('lat', ST_Y(r.location::geometry), 'lng', ST_X(r.location::geometry)) AS location
         FROM resources r, q
        WHERE ST_DWithin(r.location, q.pt, $3)
          AND ($4::resource_type IS NULL OR r.type = $4::resource_type)
        ORDER BY ST_Distance(r.location, q.pt)
        LIMIT $5`,
      [lat, lng, radiusMeters, type ?? null, limit],
    );
    return rows;
  }
}
