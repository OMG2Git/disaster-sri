import type { Cache } from '../../infra/cache.js';
import type { AuthUser, Disaster } from '../../types.js';
import { forbidden, notFound } from '../../utils/errors.js';
import type { DisasterRepository } from './disaster.repository.js';
import type {
  CreateDisasterInput,
  ListDisastersQuery,
  UpdateDisasterInput,
} from './disaster.schema.js';

const detailKey = (id: string) => `disaster:${id}`;
export const LIST_PREFIX = 'disasters:list:';

/** Deterministic: params are sorted, so ?a=1&b=2 and ?b=2&a=1 share one cache entry. */
export function listCacheKey(q: ListDisastersQuery): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return `${LIST_PREFIX}${parts.join('&')}`;
}

export class DisasterService {
  constructor(
    private repo: DisasterRepository,
    private cache: Cache,
    private ttlSeconds: number,
  ) {}

  async create(input: CreateDisasterInput, user: AuthUser): Promise<Disaster> {
    // One transaction (disaster + outbox event) inside the repository. No external calls here.
    const disaster = await this.repo.create({ ...input, createdBy: user.id });
    await this.cache.delByPrefix(LIST_PREFIX);
    return disaster;
  }

  async list(query: ListDisastersQuery): Promise<Disaster[]> {
    const key = listCacheKey(query);
    const cached = await this.cache.getJson<Disaster[]>(key);
    if (cached) return cached;
    const rows = await this.repo.list(query);
    await this.cache.setJson(key, rows, this.ttlSeconds);
    return rows;
  }

  async get(id: string): Promise<Disaster> {
    const cached = await this.cache.getJson<Disaster>(detailKey(id));
    if (cached) return cached;
    const disaster = await this.repo.findById(id);
    if (!disaster) throw notFound('Disaster');
    await this.cache.setJson(detailKey(id), disaster, this.ttlSeconds);
    return disaster;
  }

  async update(id: string, patch: UpdateDisasterInput, user: AuthUser): Promise<Disaster> {
    // Read from the DB (not the cache) for the ownership decision.
    const existing = await this.repo.findById(id);
    if (!existing) throw notFound('Disaster');
    if (user.role !== 'ADMIN' && existing.created_by !== user.id) {
      throw forbidden('Contributors can only modify disasters they created');
    }
    const updated = await this.repo.update(id, patch);
    if (!updated) throw notFound('Disaster');
    await this.invalidate(id);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id))) throw notFound('Disaster');
    await this.invalidate(id);
  }

  /** Called by writers (API + location worker) after any change. Explicit and simple. */
  async invalidate(id: string): Promise<void> {
    await this.cache.del(detailKey(id));
    await this.cache.delByPrefix(LIST_PREFIX);
  }
}
