import { unprocessable } from '../../utils/errors.js';
import type { DisasterService } from '../disasters/disaster.service.js';
import type { ResourceRepository } from './resource.repository.js';
import type { NearbyQuery } from './resource.schema.js';

export class ResourceService {
  constructor(
    private repo: ResourceRepository,
    private disasters: DisasterService,
  ) {}

  async findNearby(disasterId: string, q: NearbyQuery) {
    const disaster = await this.disasters.get(disasterId); // 404 if unknown

    // Explicit center wins; otherwise fall back to the disaster's resolved location.
    const center = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : disaster.location;
    if (!center) {
      throw unprocessable(
        `Disaster location is ${disaster.location_status}; pass ?lat=&lng= to search around a specific point`,
      );
    }
    return this.repo.findNearby({
      ...center,
      radiusMeters: q.radius * 1000,
      type: q.type,
      limit: q.limit,
    });
  }
}
