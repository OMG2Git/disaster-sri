import type { Cache } from '../../infra/cache.js';
import type { CommunityReportsProvider } from '../../providers/types.js';
import type { CommunityReport } from '../../types.js';
import { serviceUnavailable } from '../../utils/errors.js';
import { errMsg, logger } from '../../utils/logger.js';
import type { DisasterService } from '../disasters/disaster.service.js';
import type { ReportRepository } from './report.repository.js';

export interface ReportsResult {
  reports: CommunityReport[];
  meta: { source: 'cache' | 'external' | 'stale-cache'; stale: boolean };
}

interface Options {
  ttlSeconds: number;
  staleTtlSeconds: number;
  externalTimeoutMs: number;
  /** How long a follower waits for the lock holder to fill the cache. */
  lockWaitMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ReportsService {
  constructor(
    private disasters: DisasterService,
    private repo: ReportRepository,
    private cache: Cache,
    private provider: CommunityReportsProvider,
    private opts: Options,
  ) {}

  async getReports(disasterId: string): Promise<ReportsResult> {
    const disaster = await this.disasters.get(disasterId); // 404 if unknown

    const key = `community_reports:disaster:${disasterId}`;
    const staleKey = `community_reports:stale:disaster:${disasterId}`; // long-lived copy for outages
    const lockKey = `lock:community_reports:disaster:${disasterId}`;

    const cached = await this.cache.getJson<CommunityReport[]>(key);
    if (cached) return { reports: cached, meta: { source: 'cache', stale: false } };

    // Request coalescing: one caller refreshes; the rest wait briefly for the cache to fill.
    const lockTtl = Math.ceil(this.opts.externalTimeoutMs / 1000) + 2;
    const gotLock = await this.cache.acquireLock(lockKey, lockTtl);
    try {
      if (!gotLock) {
        const deadline = Date.now() + (this.opts.lockWaitMs ?? this.opts.externalTimeoutMs);
        while (Date.now() < deadline) {
          await sleep(this.opts.pollMs ?? 100);
          const filled = await this.cache.getJson<CommunityReport[]>(key);
          if (filled) return { reports: filled, meta: { source: 'cache', stale: false } };
        }
        // Lock holder failed or is slow: fall through and try ourselves (still one bounded attempt).
      }

      let reports: CommunityReport[];
      try {
        const external = await this.provider.fetchReports({
          query: disaster.location_text ?? disaster.title,
          disasterId,
        });
        reports = external.map((r) => ({
          external_id: r.id,
          source: r.source,
          author: r.author,
          content: r.content,
          reported_at: new Date(r.reported_at).toISOString(),
        }));
      } catch (e) {
        logger.warn('community reports fetch failed', { disasterId, error: errMsg(e) });
        const stale = await this.cache.getJson<CommunityReport[]>(staleKey);
        if (stale) return { reports: stale, meta: { source: 'stale-cache', stale: true } };
        throw serviceUnavailable('Community reports service is currently unavailable. Please try again shortly.');
      }

      await this.repo.upsertMany(disasterId, reports);
      await this.cache.setJson(key, reports, this.opts.ttlSeconds);
      await this.cache.setJson(staleKey, reports, this.opts.staleTtlSeconds);
      return { reports, meta: { source: 'external', stale: false } };
    } finally {
      if (gotLock) await this.cache.releaseLock(lockKey);
    }
  }
}
