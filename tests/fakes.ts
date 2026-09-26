import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import type { AppDeps } from '../src/app.js';
import type { Cache } from '../src/infra/cache.js';
import type { UserRepository } from '../src/modules/auth/auth.repository.js';
import type { DisasterRepository } from '../src/modules/disasters/disaster.repository.js';
import type { ReportRepository } from '../src/modules/reports/report.repository.js';
import type { CommunityReportsProvider, ExternalReport } from '../src/providers/types.js';
import type { CommunityReport, Disaster, UserWithHash } from '../src/types.js';

export const testConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused',
  JWT_SECRET: 'test-secret-test-secret-test-secret',
  EXTERNAL_API_TIMEOUT_MS: '500',
});

export class MemoryCache implements Cache {
  store = new Map<string, unknown>();
  locks = new Set<string>();
  gets = 0;
  async getJson<T>(key: string) {
    this.gets++;
    return (this.store.get(key) as T) ?? null;
  }
  async setJson(key: string, value: unknown) {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }
  async del(...keys: string[]) {
    keys.forEach((k) => this.store.delete(k));
  }
  async delByPrefix(prefix: string) {
    for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
  }
  async acquireLock(key: string) {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }
  async releaseLock(key: string) {
    this.locks.delete(key);
  }
}

export class FakeUserRepo implements UserRepository {
  users: UserWithHash[] = [];
  async create(i: { name: string; email: string; passwordHash: string; role: 'ADMIN' | 'CONTRIBUTOR' }) {
    if (this.users.some((u) => u.email === i.email)) return null;
    const now = new Date();
    const u: UserWithHash = { id: randomUUID(), name: i.name, email: i.email, password_hash: i.passwordHash, role: i.role, created_at: now, updated_at: now };
    this.users.push(u);
    const { password_hash: _omit, ...pub } = u;
    return pub;
  }
  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
}

/** In-memory stand-in that mimics the real repo contract, including "outbox event per write". */
export class FakeDisasterRepo implements DisasterRepository {
  rows = new Map<string, Disaster>();
  outbox: { event_type: string; aggregate_id: string; payload: unknown }[] = [];
  listCalls = 0;
  findCalls = 0;

  async create(i: { title: string; description: string; tags: string[]; status: Disaster['status']; createdBy: string }) {
    const now = new Date();
    const d: Disaster = {
      id: randomUUID(), title: i.title, description: i.description, tags: i.tags, status: i.status,
      created_by: i.createdBy, location_text: null, location: null, location_status: 'PENDING',
      location_attempts: 0, location_error: null, created_at: now, updated_at: now,
    };
    this.rows.set(d.id, d);
    this.outbox.push({ event_type: 'disaster.created', aggregate_id: d.id, payload: d });
    return d;
  }
  async findById(id: string) {
    this.findCalls++;
    const d = this.rows.get(id);
    return d ? { ...d } : null; // a copy, like a real DB read: later edits must not mutate what the caller holds
  }
  async list(q: { tag?: string; status?: string }) {
    this.listCalls++;
    return [...this.rows.values()].filter((d) => (!q.tag || d.tags.includes(q.tag)) && (!q.status || d.status === q.status));
  }
  async update(id: string, patch: Partial<Disaster>) {
    const d = this.rows.get(id);
    if (!d) return null;
    const descriptionChanged = patch.description !== undefined && patch.description !== d.description;
    Object.assign(d, patch, { updated_at: new Date() });
    if (descriptionChanged)
      Object.assign(d, { location: null, location_text: null, location_status: 'PENDING', location_attempts: 0, location_error: null });
    this.outbox.push({ event_type: 'disaster.updated', aggregate_id: id, payload: d });
    if (descriptionChanged) this.outbox.push({ event_type: 'disaster.location_requested', aggregate_id: id, payload: d });
    return d;
  }
  async delete(id: string) {
    if (!this.rows.delete(id)) return false;
    this.outbox.push({ event_type: 'disaster.deleted', aggregate_id: id, payload: { id } });
    return true;
  }
  async recordLocationAttempt(id: string, attempts: number, error: string, description: string) {
    const d = this.rows.get(id);
    if (d?.description === description) Object.assign(d, { location_attempts: attempts, location_error: error });
  }
  async markLocationFailed(id: string, error: string, description: string) {
    const d = this.rows.get(id);
    if (d?.location_status === 'PENDING' && d.description === description) Object.assign(d, { location_status: 'FAILED', location_error: error });
  }
  async resolveLocation(id: string, text: string, lat: number, lng: number, description: string) {
    const d = this.rows.get(id);
    if (!d || d.location_status === 'RESOLVED' || d.description !== description) return null;
    Object.assign(d, { location_text: text, location: { lat, lng }, location_status: 'RESOLVED', location_error: null });
    this.outbox.push({ event_type: 'disaster.location_resolved', aggregate_id: id, payload: d });
    return d;
  }
}

export class FakeReportRepo implements ReportRepository {
  byKey = new Map<string, CommunityReport & { disaster_id: string }>();
  async upsertMany(disasterId: string, reports: CommunityReport[]) {
    for (const r of reports) {
      const k = `${r.source}:${r.external_id}`;
      if (!this.byKey.has(k)) this.byKey.set(k, { ...r, disaster_id: disasterId });
    }
  }
}

export class FakeCommunityProvider implements CommunityReportsProvider {
  calls = 0;
  mode: 'ok' | 'fail' = 'ok';
  delayMs = 0;
  reports: ExternalReport[] = [
    { id: 'ext-1', source: 'mock-social', author: 'user1', content: 'Flooding near downtown.', reported_at: '2026-01-01T10:00:00Z' },
    { id: 'ext-2', source: 'mock-social', author: null, content: 'Roads closed.', reported_at: '2026-01-01T10:05:00+00:00' },
  ];
  async fetchReports() {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.mode === 'fail') throw new Error('upstream down');
    return this.reports;
  }
}

export function buildDeps(overrides: Partial<AppDeps> = {}) {
  const fakes = {
    users: new FakeUserRepo(),
    disasters: new FakeDisasterRepo(),
    reports: new FakeReportRepo(),
    cache: new MemoryCache(),
    community: new FakeCommunityProvider(),
  };
  const deps: AppDeps = {
    config: testConfig,
    resources: { findNearby: async () => [] },
    authRateLimitMax: 1000,
    reportsPollMs: 10,
    ...fakes,
    ...overrides,
  };
  return { deps, fakes };
}
