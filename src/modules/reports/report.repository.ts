import type { Pool } from '../../infra/db.js';
import type { CommunityReport } from '../../types.js';

export interface ReportRepository {
  /** Idempotent: UNIQUE(source, external_id) makes re-fetching the same reports a no-op. */
  upsertMany(disasterId: string, reports: CommunityReport[]): Promise<void>;
}

export class PgReportRepository implements ReportRepository {
  constructor(private pool: Pool) {}

  async upsertMany(disasterId: string, reports: CommunityReport[]) {
    if (!reports.length) return;
    await this.pool.query(
      `INSERT INTO community_reports (disaster_id, external_id, source, author, content, reported_at)
       SELECT $1::uuid, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])
       ON CONFLICT (source, external_id) DO NOTHING`,
      [
        disasterId,
        reports.map((r) => r.external_id),
        reports.map((r) => r.source),
        reports.map((r) => r.author),
        reports.map((r) => r.content),
        reports.map((r) => r.reported_at),
      ],
    );
  }
}
