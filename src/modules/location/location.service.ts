import type { DisasterService } from '../disasters/disaster.service.js';
import type { DisasterRepository } from '../disasters/disaster.repository.js';
import type { Geocoder, LocationExtractor } from '../../providers/types.js';
import type { Disaster, EventEnvelope } from '../../types.js';
import { errMsg, logger } from '../../utils/logger.js';

interface Options {
  maxRetries: number;
  retryBaseMs: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * disaster.created / disaster.location_requested (description edited) -> Gemini (place name) -> geocoder (coordinates) -> PostGIS.
 * Retry policy:
 *  - provider error (timeout/5xx/bad response): retry with exponential backoff, up to maxRetries
 *  - "no location in text" / "geocoder found nothing": deterministic, so FAILED immediately (no retry)
 * The disaster row itself is never touched beyond its location fields.
 */
export class LocationService {
  private sleep: (ms: number) => Promise<void>;

  constructor(
    private repo: DisasterRepository,
    private disasters: DisasterService,
    private extractor: LocationExtractor,
    private geocoder: Geocoder,
    private opts: Options,
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Throwing leaves the stream message pending (redelivered later); returning ACKs it. */
  async handle(event: EventEnvelope): Promise<void> {
    if (event.event_type !== 'disaster.created' && event.event_type !== 'disaster.location_requested') return;

    const disaster = await this.repo.findById(event.aggregate_id);
    // Idempotency: deleted, already RESOLVED/FAILED (e.g. duplicate delivery) => nothing to do.
    if (!disaster || disaster.location_status !== 'PENDING') return;

    // Attempts survive worker restarts because they live in the DB row.
    for (let attempt = disaster.location_attempts + 1; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const text = await this.extractor.extractLocation(disaster.description);
        if (!text) return this.fail(disaster, 'No reliable location found in description');

        const geo = await this.geocoder.geocode(text);
        if (!geo) return this.fail(disaster, `Geocoder found no match for "${text}"`);

        const resolved = await this.repo.resolveLocation(disaster.id, text, geo.lat, geo.lng, disaster.description);
        if (resolved) await this.disasters.invalidate(disaster.id);
        return;
      } catch (e) {
        const message = errMsg(e);
        logger.warn('location resolution attempt failed', { disaster_id: disaster.id, attempt, error: message });
        await this.repo.recordLocationAttempt(disaster.id, attempt, message, disaster.description);
        if (attempt >= this.opts.maxRetries) return this.fail(disaster, message);
        await this.sleep(this.opts.retryBaseMs * 2 ** (attempt - 1)); // 1s, 2s, 4s...
      }
    }
    // Only reached if a previous run already used every attempt before crashing.
    return this.fail(disaster, disaster.location_error ?? 'Retries exhausted');
  }

  private async fail(disaster: Disaster, reason: string) {
    logger.error('location resolution failed permanently', { disaster_id: disaster.id, reason });
    await this.repo.markLocationFailed(disaster.id, reason, disaster.description);
    await this.disasters.invalidate(disaster.id);
  }
}
