import { insertOutbox, withTx, type Pool } from '../../infra/db.js';
import type { Disaster, DisasterStatus } from '../../types.js';
import type { ListDisastersQuery, UpdateDisasterInput } from './disaster.schema.js';

/**
 * Every write that changes a disaster also writes its outbox event in the SAME transaction.
 * That's the outbox guarantee: no committed change without an event, and no event without a change.
 */
export interface DisasterRepository {
  create(input: {
    title: string;
    description: string;
    tags: string[];
    status: DisasterStatus;
    createdBy: string;
  }): Promise<Disaster>;
  findById(id: string): Promise<Disaster | null>;
  list(query: ListDisastersQuery): Promise<Disaster[]>;
  update(id: string, patch: UpdateDisasterInput): Promise<Disaster | null>;
  delete(id: string): Promise<boolean>;
  /**
   * Location pipeline (called by the location worker). Every write is conditional on `description`
   * still being the text the worker processed, so a result computed from an older description
   * can never overwrite the state of a newer edit.
   */
  recordLocationAttempt(id: string, attempts: number, error: string, description: string): Promise<void>;
  markLocationFailed(id: string, error: string, description: string): Promise<void>;
  /** Returns null if the disaster is gone, already RESOLVED, or its description changed meanwhile. */
  resolveLocation(id: string, text: string, lat: number, lng: number, description: string): Promise<Disaster | null>;
}

// location is a GEOGRAPHY column; expose it to Node as {lat,lng} computed inside PostGIS.
const COLS = `id, title, description, location_text,
  CASE WHEN location IS NULL THEN NULL
       ELSE json_build_object('lat', ST_Y(location::geometry), 'lng', ST_X(location::geometry)) END AS location,
  location_status, location_attempts, location_error, tags, status, created_by, created_at, updated_at`;

const UPDATABLE = ['title', 'description', 'tags', 'status'] as const;

export class PgDisasterRepository implements DisasterRepository {
  constructor(private pool: Pool) {}

  create(input: { title: string; description: string; tags: string[]; status: DisasterStatus; createdBy: string }) {
    return withTx(this.pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO disasters (title, description, tags, status, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
        [input.title, input.description, input.tags, input.status, input.createdBy],
      );
      const disaster: Disaster = rows[0];
      await insertOutbox(client, 'disaster.created', disaster.id, disaster);
      return disaster;
    });
  }

  async findById(id: string) {
    const { rows } = await this.pool.query(`SELECT ${COLS} FROM disasters WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async list({ tag, status, limit, offset }: ListDisastersQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (tag) {
      params.push([tag]);
      where.push(`tags @> $${params.length}::text[]`); // uses the GIN index
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT ${COLS} FROM disasters ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  }

  update(id: string, patch: UpdateDisasterInput) {
    return withTx(this.pool, async (client) => {
      // Lock the row so "did the description change?" can't race with a concurrent edit.
      const current = await client.query('SELECT description FROM disasters WHERE id = $1 FOR UPDATE', [id]);
      if (!current.rows[0]) return null;
      const descriptionChanged = patch.description !== undefined && patch.description !== current.rows[0].description;

      // Column names come from a fixed allowlist; values are always bound parameters.
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const key of UPDATABLE) {
        if (patch[key] !== undefined) {
          params.push(patch[key]);
          sets.push(`${key} = $${params.length}`);
        }
      }
      // A different description may name a different place (or fix a typo): drop the old
      // location and send the incident back through the resolution pipeline.
      if (descriptionChanged) {
        sets.push(
          'location = NULL',
          'location_text = NULL',
          "location_status = 'PENDING'",
          'location_attempts = 0',
          'location_error = NULL',
        );
      }
      const { rows } = await client.query(
        `UPDATE disasters SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
        params,
      );
      const disaster: Disaster = rows[0];
      await insertOutbox(client, 'disaster.updated', id, disaster);
      if (descriptionChanged) await insertOutbox(client, 'disaster.location_requested', id, disaster);
      return disaster;
    });
  }

  delete(id: string) {
    // community_reports rows go with it via ON DELETE CASCADE (they only make sense per disaster).
    return withTx(this.pool, async (client) => {
      const { rowCount } = await client.query('DELETE FROM disasters WHERE id = $1', [id]);
      if (!rowCount) return false;
      await insertOutbox(client, 'disaster.deleted', id, { id });
      return true;
    });
  }

  async recordLocationAttempt(id: string, attempts: number, error: string, description: string) {
    await this.pool.query(
      'UPDATE disasters SET location_attempts = $2, location_error = $3 WHERE id = $1 AND description = $4',
      [id, attempts, error, description],
    );
  }

  async markLocationFailed(id: string, error: string, description: string) {
    await this.pool.query(
      `UPDATE disasters SET location_status = 'FAILED', location_error = $2, updated_at = now()
       WHERE id = $1 AND location_status = 'PENDING' AND description = $3`,
      [id, error, description],
    );
  }

  resolveLocation(id: string, text: string, lat: number, lng: number, description: string) {
    return withTx(this.pool, async (client) => {
      // ST_MakePoint takes (x=lng, y=lat). The status guard makes duplicate deliveries a no-op.
      const { rows } = await client.query(
        `UPDATE disasters
            SET location_text = $2,
                location = ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
                location_status = 'RESOLVED', location_error = NULL, updated_at = now()
          WHERE id = $1 AND location_status <> 'RESOLVED' AND description = $5
          RETURNING ${COLS}`,
        [id, text, lat, lng, description],
      );
      const disaster: Disaster | undefined = rows[0];
      if (!disaster) return null;
      await insertOutbox(client, 'disaster.location_resolved', id, disaster);
      return disaster;
    });
  }
}
