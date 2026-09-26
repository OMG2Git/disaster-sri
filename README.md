# Disaster Response Coordination Platform

Backend-first platform for recording disasters, enriching them with locations, finding nearby emergency resources, and pulling community reports from an external service, plus a React console for trying it out.

**Repository:** https://github.com/OMG2Git/disaster-sri

> **Core principle: the core system records reality; external services enrich it.**
> `POST /disasters` is one PostgreSQL transaction (disaster + outbox event). Gemini, Nominatim, Redis and the community API can all be down and the disaster is still saved.

## Architecture

```
                 CLIENTS
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
    Express API (:3000)   Realtime/SSE (:3001)
     │        │                 ▲
     │        │                 │ consumer group: realtime-service
     │        ▼                 │
     │      Redis  ◄── cache, locks
     ▼
PostgreSQL + PostGIS  ← source of truth
     │  (disasters, users, resources, community_reports, outbox_events)
     ▼
Outbox Publisher ──XADD──► Redis Stream "disaster-events"
                                   │ consumer group: location-workers
                                   ▼
                            Location Worker ──► Gemini (place NAME)
                                   │        └─► Nominatim (lat/lng)
                                   ▼
                          PostGIS UPDATE + outbox event disaster.location_resolved
                          (→ outbox → stream → SSE clients)

API ──► Mock Community API (:4000)   (separate process, simulated failures)
```

Modular monolith: one codebase, five processes (`api`, `outbox-publisher`, `location-worker`, `realtime`, `mock-community-api`).
Each module is `routes → service → repository`; external systems sit behind interfaces (`LocationExtractor`, `Geocoder`, `CommunityReportsProvider`, `Cache`, `*Repository`) so services are testable with fakes.

**Who does what — Gemini ≠ Geocoder ≠ PostGIS**

| | Responsibility |
|---|---|
| Gemini 2.5 Flash | Extracts the place **name** from free text. Never coordinates (LLMs hallucinate them). Returns `null` when unsure. |
| Nominatim (OSM) | Converts that name to lat/lng. Behind a `Geocoder` interface so Google/Mapbox can replace it. |
| PostGIS | Stores `GEOGRAPHY(POINT,4326)` and answers distance queries inside the database. |

**PostgreSQL = source of truth. Redis = cache + event stream** (never authoritative). **Redis Streams ≠ Pub/Sub**: streams persist, have consumer groups, ACKs, a pending list and reclaim; Pub/Sub drops messages for absent subscribers. **The transactional outbox** protects the DB → event-bus hop.

## Tech stack

TypeScript · Node 22 · Express 5 · PostgreSQL 16 + PostGIS 3.4 · Redis 7 (cache + Streams) · `pg` (plain SQL) · Zod · JWT + bcrypt · Vitest + Supertest · Swagger UI · Gemini (`@google/genai`) · Nominatim · SSE · Docker Compose.

## Deliverables

| Requested item | Where it is |
|---|---|
| GitHub repository | https://github.com/OMG2Git/disaster-sri |
| README | This file: architecture, decisions, trade-offs, AI usage. A longer write-up with flows and the full test inventory is in [REPORT.md](REPORT.md) |
| `.env.example` | [.env.example](.env.example) (backend) and [frontend/.env.example](frontend/.env.example) |
| API documentation / Postman collection | Swagger UI at http://localhost:3000/docs while running; OpenAPI 3 spec in [docs/openapi.json](docs/openapi.json) (regenerate with `npm run docs:openapi`); Postman collection in [docs/postman_collection.json](docs/postman_collection.json) (import it into Postman; it stores tokens and ids automatically; it was run with Newman: 18 requests, 15 assertions, 0 failures) |
| Mock data / setup scripts | Seed data: `npm run seed` ([src/db/seed.ts](src/db/seed.ts)); migrations: [migrations/](migrations/) via `npm run migrate`; one-shot setup: `npm run setup`; mock external community service: [mock-community-api/](mock-community-api/); containers: [docker-compose.yml](docker-compose.yml) |

## Quick start

Needs **Node 20+** and **Docker Desktop** (for PostgreSQL + PostGIS and Redis). A **Gemini API key** is only needed for automatic location resolution; everything else works without it.

```bash
git clone https://github.com/OMG2Git/disaster-sri.git
cd disaster-sri
cp .env.example .env     # then set GEMINI_API_KEY (and optionally NOMINATIM_USER_AGENT)
npm install
npm run setup            # installs frontend deps, starts Postgres+Redis in Docker, runs migrations, seeds data
npm run dev              # API, outbox publisher, location worker, realtime, mock community API, frontend
```

Then open:

| URL | What |
|---|---|
| http://localhost:5173 | Web console (sign in with a seeded account below) |
| http://localhost:3000/docs | Swagger UI |
| http://localhost:3000/health | Health |
| http://localhost:3001/events/disasters | Server-Sent Events stream |
| http://localhost:4000/external/community-reports?query=Manhattan | Mock external service |

Seeded accounts: `admin@example.com / Admin1234!` (ADMIN) and `contributor@example.com / Contributor1234!` (CONTRIBUTOR).

Notes:
- `npm run dev` runs six processes with colour-coded log prefixes; Ctrl+C stops them all. Without `GEMINI_API_KEY` only the location worker exits (with a clear message); new incidents then stay `PENDING`.
- Nominatim rejects generic User-Agents (HTTP 403). Set `NOMINATIM_USER_AGENT` in `.env` to something that identifies your app.
- Ports 3000, 3001, 4000, 5173, 5432 and 6379 must be free. If you previously ran the full Docker stack, stop it first with `docker compose down`.
- `npm run setup` and `npm run seed` are safe to re-run.

**Alternative: run the whole backend in Docker**

```bash
cp .env.example .env
docker compose up --build                 # postgres+postgis, redis, migrate (one-shot), api, workers, realtime, mock API
docker compose exec api npm run seed
cd frontend && npm install && npm run dev # console on http://localhost:5173
```

Tests need **no** Docker, database, Redis or API keys: `npm test` (and `npm run typecheck`).

**Try the whole loop from the command line:**

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"contributor@example.com","password":"Contributor1234!"}' | jq -r .access_token)
curl -N localhost:3001/events/disasters &        # watch events
curl -s localhost:3000/disasters -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Flooding","description":"Heavy flooding in Manhattan, NYC.","tags":["flood"]}'
# → 201 with location_status PENDING; seconds later an SSE disaster.location_resolved arrives
```

### Environment variables
See [.env.example](.env.example). Required: `DATABASE_URL`, `JWT_SECRET` (≥16 chars; validated at startup). The location worker also needs `GEMINI_API_KEY`. TTLs: `CACHE_DISASTER_TTL_SECONDS`, `CACHE_REPORTS_TTL_SECONDS`; timeouts/retries: `EXTERNAL_API_TIMEOUT_MS`, `LOCATION_MAX_RETRIES`, `LOCATION_RETRY_BASE_MS`. `COMMUNITY_API_SCENARIO=error|slow|empty` forces a mock failure mode.

### Database
Plain SQL in [migrations/](migrations/), applied by `npm run migrate` (tracked in `_migrations`, advisory-locked). Indexes: `unique(users.email)`, GiST on `disasters.location` and `resources.location`, GIN on `disasters.tags`, btree on `status`/`created_at`/`resources.type`/report `disaster_id`+`reported_at`, `unique(source, external_id)` on reports, and a **partial** index on unpublished outbox rows.
Two columns beyond the spec, `disasters.location_attempts` and `location_error`, hold the retry count and failure reason.

## API

Full contract with schemas and error cases: **/docs** (OpenAPI, also `/openapi.json`).

| Endpoint | Access |
|---|---|
| `POST /auth/register`, `POST /auth/login` | public, rate-limited |
| `GET /disasters`, `GET /disasters/:id` | public (Redis cache-aside) |
| `POST /disasters` | ADMIN, CONTRIBUTOR |
| `PATCH /disasters/:id` | ADMIN any; CONTRIBUTOR only own |
| `DELETE /disasters/:id` | ADMIN |
| `GET /disasters/:id/resources?lat&lng&radius` | public |
| `GET /disasters/:id/reports` | public |
| `GET /events/disasters` (SSE, realtime service :3001) | public |
| `GET /health` | public |

Errors always look like `{"error":{"code","message","details?"}}` (400 validation, 401, 403, 404, 409, 422, 429, 503, 500). No stack traces, SQL or secrets in responses.

**Auth.** bcrypt-hashed passwords; JWT (HS256) with only `sub` and `role`. Registration always yields `CONTRIBUTOR` (unknown body keys are stripped; there is no way to self-register as admin). Authentication (`middleware/auth.ts`) and authorization are separate: coarse role checks are middleware, the "contributor may only touch their own" rule is in `DisasterService.update` and reads ownership from PostgreSQL, not from cache. Also: Helmet, CORS, 100kb body limit, Zod on every input, parameterised SQL only.

## PostGIS & nearby resources
`GET /disasters/:id/resources` converts km → meters and runs `ST_DWithin(location, point, meters)` on `GEOGRAPHY` (uses the GiST index), returning `ST_Distance` sorted nearest-first. Nothing is computed in Node. **Explicit behavior:** if `lat`+`lng` are given they are the center (must be given together); otherwise the disaster's resolved location is used; if it isn't resolved yet the API returns **422**.

## Location extraction flow
1. `POST /disasters` → row (`location_status=PENDING`) + `disaster.created` outbox row, one transaction, 201. **Editing the description** (`PATCH`) does the same again: in one transaction the old location is cleared, the status goes back to `PENDING`, and a `disaster.location_requested` event is written, so a mistyped or changed place is re-resolved. Other edits leave the location alone.
2. Outbox publisher → stream → **Location Worker** (group `location-workers`).
3. Worker loads the disaster; if it isn't `PENDING` it stops (idempotent).
4. Gemini (structured JSON, temperature 0, prompt forbids inventing places/coordinates) → `"Manhattan, NYC"` or `null`.
5. Nominatim → lat/lng (validated to be in range). Then `location`, `location_text`, `RESOLVED` and a `disaster.location_resolved` outbox event are written in one transaction, and Redis entries for the disaster are invalidated.

**Stale results are discarded.** Every location write is conditional on the description the worker actually processed (`WHERE description = $n`), so if the text is edited while an earlier resolution is still running, that older answer can't overwrite the newer edit.

**Retries.** Provider errors (timeout, 5xx, malformed response) retry with exponential backoff (`base·2^n`: 1s, 2s, …) up to `LOCATION_MAX_RETRIES`, then `FAILED` with `location_error`. The attempt count is stored in the DB so it survives worker restarts. "No location in text" and "geocoder found nothing" are deterministic, so they go straight to `FAILED` without retrying. If the worker crashes mid-message, the stream message stays pending and is reclaimed (`XAUTOCLAIM`) by another consumer.

## Redis
- **Cache-aside** for disaster list (key `disasters:list:<sorted params>`, so query order doesn't matter), detail (`disaster:<id>`) and community reports (`community_reports:disaster:<id>`). Every entry has a TTL.
- **TTL jitter:** actual TTL = base + random 0–10%, so keys written together don't expire together.
- **Invalidation:** explicit and simple. Create/PATCH/DELETE and location resolution delete the detail key and the list prefix.
- **Request coalescing:** on a reports miss one request takes `SET lock:community_reports:disaster:<id> NX EX` and calls the API; the rest poll the cache briefly. Tested: 10 concurrent misses → 1 upstream call.
- **Redis is optional for reads:** cache calls swallow errors and use a fail-fast client (no offline queue, 500ms command timeout), so a dead Redis falls back to PostgreSQL / the external API instead of hanging. `/health` reports `degraded`.

## Community reports & failure handling
`GET /disasters/:id/reports`: cache → (lock) → external API (3s timeout, **one** attempt, response validated with Zod) → normalize → `INSERT … ON CONFLICT (source, external_id) DO NOTHING` → cache → respond. Besides the normal TTL entry, a long-lived "stale" copy is kept. If the upstream fails: serve the stale copy (`meta.stale: true`), else **503** with a plain message. The mock service ([mock-community-api/](mock-community-api/)) supports `?scenario=success|error|slow|empty`.

## Transactional outbox, streams, SSE
- Every disaster write inserts an `outbox_events` row in the same transaction. If Redis is down, rows simply wait.
- The publisher polls unpublished rows (`FOR UPDATE SKIP LOCKED`, so several publishers are safe), `XADD`s to `disaster-events`, and sets `published_at`. On failure it increments `attempts`, records `last_error`, stops the batch (keeps order), and retries next tick. Delivery is **at-least-once**; `event_id` (the outbox id) is the idempotency key.
- Envelope: `{event_id, event_type, aggregate_type, aggregate_id, occurred_at, payload}`. Types: `disaster.created|updated|deleted|location_requested|location_resolved`.
- Consumer groups: `location-workers` (ACK after success) and `realtime-service`. Failed handlers leave messages pending → redelivered after an idle timeout.
- **SSE** (`realtime` process): proper headers, `retry:`, `id:`/`event:`/`data:` frames, 15s `: ping` heartbeat, cleanup on client disconnect. SSE over WebSockets because traffic is server → client only, and browsers reconnect automatically.

## Idempotency
Location worker: only acts on `PENDING`, and the resolving `UPDATE` is guarded by `location_status <> 'RESOLVED'`, so duplicate `disaster.created` events don't re-run Gemini or emit twice. Reports: `UNIQUE(source, external_id)`. Outbox: unique event id. I did not build a generic dedup framework.

## Frontend (web console)

The dark-first React console in [frontend/](frontend/) exercises every backend feature (started by `npm run dev`, or on its own with `npm run dev:frontend`): Vite + React + TypeScript, Tailwind CSS 4, React Router, TanStack Query, native `EventSource`, React Leaflet, Zod, Lucide icons and Inter (bundled locally, no external font requests).

```bash
cd frontend
cp .env.example .env    # optional; defaults are http://localhost:3000 (API) and :3001 (SSE)
npm install
npm run dev             # http://localhost:5173  (backend must be running: docker compose up)
```

- **Design:** navy/slate glass surfaces with a cyan accent, a dark/light toggle persisted in `localStorage` (applied before first paint, no flash), skeleton loaders, empty/error states, and `prefers-reduced-motion` support. Responsive down to phone width.
- **Dashboard (`/`):** stat strip, map of located incidents, tag/status filters, recent-activity feed, "Report incident" modal.
- **Incident page (`/disasters/:id`):** location-resolution state (`PENDING` progress bar, `FAILED` reason), map with a nearby-resource radius ring, tabs for **Resources** (type chips, radius slider, click the map to search around any point) and **Reports** (Live / Cached / Stale badge, 503 handling), edit and delete.
- **Realtime:** one `EventSource` for the app; a Live / Reconnecting / Offline indicator, quiet toasts, rows flash when they change, and queries refresh automatically.
- **Permissions:** the UI shows actions by role (owner or admin can edit, only admin can delete, everyone else sees "Read-only"), but authorization is enforced by the API, not the UI.
- **Map tiles:** standard OpenStreetMap tiles (no API key); the dark theme is a CSS filter over them. Fine for development; use a hosted tile provider for production traffic.

## Testing
`npm test` → 51 tests, all offline (in-memory repositories/cache/providers injected into the real Express app; Gemini/Nominatim/community API are fakes or mocked `fetch`):
- **API + business rules:** contributor creates disaster → 201, row + outbox event; contributor A → B's disaster is 403, admin 200; only admin deletes; role escalation at registration ignored.
- **Validation/errors:** empty title, unknown PATCH fields, bad lat/lng/radius, malformed ids, consistent error shape.
- **External integration:** the real HTTP provider against the real mock service (success/empty/500/slow-timeout), stale-cache fallback, 503 without cache, coalescing, dedup.
- **Workers:** location success, backoff schedule, FAILED after max retries, no retry on "no location", duplicate delivery, outbox failure handling.

**Verified end to end with `docker compose up`** (real PostGIS, Redis, Gemini `gemini-2.5-flash`, Nominatim): migrations + seed; create → `PENDING` → outbox → stream → worker → Gemini → Nominatim → `RESOLVED` in ~4s with a `disaster.location_resolved` SSE event; PostGIS nearby search (distances sorted nearest-first, `type` filter); reports cache miss → external → cache hit; 403 on contributor PATCH/DELETE of others' disasters; retry/backoff → `FAILED` with `location_error` (observed when Nominatim rejected a placeholder User-Agent).
**Not exercised live:** Redis-down and Postgres-down behaviour beyond the earlier local boot check, worker-crash reclaim (`XAUTOCLAIM`), multiple concurrent outbox publishers, and the mock's `slow`/`error` scenarios through the compose stack (covered by the offline tests instead).

> Nominatim blocks generic/placeholder User-Agents (HTTP 403). Set `NOMINATIM_USER_AGENT` to something that identifies your app.

## Tradeoffs & decisions
- **Redis Streams, not Kafka:** Redis is already required for caching; streams give persistence, groups, ACK and reclaim without another cluster in a 48h take-home. Kafka would make sense at high volume, long retention and many consumers.
- **`pg` + SQL migrations, not Prisma:** the interesting columns are `geography` (Prisma treats them as `Unsupported`) and every spatial query is raw SQL anyway; this removes a generator/engine and keeps migrations reviewable.
- **Realtime as its own process:** a single consumer group (`realtime-service`) means one realtime instance; to scale out, give each instance its own group (or fan out via Pub/Sub after the stream read).
- **Retries block the location consumer** while backing off (concurrency 1) — simple, and Nominatim's ~1 req/s policy makes serial processing appropriate. A poison message that keeps throwing unexpected (non-provider) errors would be redelivered indefinitely; a dead-letter stream after N deliveries is the next step.
- **Editing `description` doesn't re-run location resolution;** location is resolved once per disaster.
- **Reports are unique on `(source, external_id)` globally,** as specified, so the same external report can be stored against only one disaster.
- **`tsx` in containers** instead of a compiled build, for speed of development.
- Not built (by design): OAuth/MFA/refresh tokens, dead-letter stream, bonus priority classification.

## AI usage
AI assistance (Claude) was used for architecture brainstorming, reviewing design decisions, identifying edge cases (outbox at-least-once, stale-cache fallback, retry vs. deterministic failure) and generating much of the code and tests. I reviewed the design and decisions myself; as noted above, not everything has been exercised against real infrastructure yet.

