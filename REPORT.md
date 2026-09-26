---
title: "Disaster Response Coordination Platform: Implementation and Test Report"
subtitle: "Backend (Node/TypeScript, PostgreSQL + PostGIS, Redis Streams) and React test console"
date: "2026-09-26"
---

# 1. Executive summary

**Repository:** <https://github.com/OMG2Git/disaster-sri>

This project is a backend-focused **Disaster Response Coordination Platform**, plus a small React frontend for manual testing. It was built for the "Founding Engineer" take-home assignment, whose guiding rule is *"Build less. Think deeply. Explain your decisions."*

The central design principle is:

> **The core system records reality; external services enrich that reality.**

Creating a disaster is one PostgreSQL transaction (disaster row + outbox event). It never waits on Gemini, Nominatim, Redis or the community API. Location extraction, geocoding and realtime notification happen asynchronously afterwards, through a **transactional outbox** feeding **Redis Streams**.

**Status**

| Area | Status |
|---|---|
| All required backend features | Implemented |
| Automated backend tests | 51 tests, all passing, fully offline |
| Real-infrastructure end-to-end run (Docker Compose, PostGIS, Redis, Gemini, Nominatim) | Executed and verified (details in section 9) |
| Web console (React) | Implemented; type-checks and builds; rendered and exercised in a real headless browser (see sections 6.13 and 9); no automated frontend tests |
| API documentation | Swagger UI at `/docs`, OpenAPI export in `docs/openapi.json`, Postman collection in `docs/postman_collection.json` (run with Newman: 18 requests, 15 assertions, 0 failures) |
| Clone-and-run | `npm install`, `npm run setup`, `npm run dev` (section 10) |
| Optional bonus (LLM priority classification) | Deliberately not built |

# 2. Technology stack

| Concern | Choice |
|---|---|
| Language / runtime | TypeScript, Node.js 22 |
| HTTP framework | Express 5 |
| Database | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4` image) |
| DB access | `pg` (plain parameterised SQL) + hand-written SQL migrations |
| Cache, locks, event stream | Redis 7 (cache-aside, `SET NX EX` locks, Redis Streams) |
| Auth | JWT (HS256) + bcrypt (`bcryptjs`) |
| Validation | Zod |
| LLM (location text extraction) | Gemini `gemini-2.5-flash` via `@google/genai` (structured JSON output) |
| Geocoder | Nominatim (OpenStreetMap) |
| Realtime | Server-Sent Events (SSE) |
| Tests | Vitest + Supertest |
| API docs | OpenAPI 3 served by Swagger UI at `/docs` |
| Containers | Docker + Docker Compose |
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, native `EventSource`, React Leaflet, Zod |

## 2.1 Deliberate deviations from the brief

1. **`pg` + SQL migrations instead of Prisma.** The key columns are PostGIS `geography`, which Prisma models only as `Unsupported`, and every spatial query is raw SQL anyway. Dropping Prisma removes a generator and engine and keeps migrations reviewable. (The brief allowed this: "do not sacrifice correctness just to avoid raw SQL".)
2. **Two extra columns on `disasters`:** `location_attempts` and `location_error`. They store the retry counter and last failure reason so retries survive worker restarts and a `FAILED` state is explainable.
3. **SSE served by the realtime process (port 3001)**, not the API process (port 3000).
4. **Gemini model:** the brief was internally inconsistent (Flash-Lite vs Flash). The model is configurable via `GEMINI_MODEL`; the project runs on `gemini-2.5-flash` because Flash-Lite was reported as unavailable in AI Studio.

# 3. Architecture

## 3.1 Processes

The system is a **modular monolith with background workers**: one codebase, five backend processes, two infrastructure services.

| Process | Command | Port | Responsibility |
|---|---|---|---|
| API | `npm run start:api` | 3000 | HTTP, validation, auth, CRUD, cache reads, writing outbox rows, Swagger docs |
| Outbox publisher | `npm run start:outbox` | none | Polls unpublished outbox rows, `XADD`s to Redis Stream |
| Location worker | `npm run start:location-worker` | none | Consumes `disaster.created`, calls Gemini then Nominatim, writes PostGIS |
| Realtime service | `npm run start:realtime` | 3001 | Consumes stream, fans events out to SSE clients |
| Mock community API | `npm run start:mock-community` | 4000 | Simulated external social/community service |
| PostgreSQL + PostGIS | compose service | 5432 | Source of truth |
| Redis | compose service | 6379 | Cache, locks, event stream (never authoritative) |

## 3.2 Component diagram

```text
                     CLIENTS (browser / curl)
                        |               ^
                        v               | SSE
              +------------------+   +-----------------------+
              |  Express API     |   |  Realtime service     |
              |  :3000           |   |  :3001                |
              +---+---------+----+   +----------^------------+
                  |         |                   | group: realtime-service
                  |         v                   |
                  |      +-------+       +------+-------------------+
                  |      | Redis | <---> | Redis Stream             |
                  |      | cache |       | "disaster-events"        |
                  |      +-------+       +------+-------------------+
                  v                             ^          |
     +-------------------------+   XADD         |          | group: location-workers
     | PostgreSQL + PostGIS    |                |          v
     | users, disasters,       |        +-------+-----+  +-----------------+
     | resources,              | <----- | Outbox      |  | Location worker |
     | community_reports,      |  poll  | publisher   |  +---+---------+---+
     | outbox_events           |        +-------------+      |         |
     +------------^------------+                             v         v
                  |                                       Gemini   Nominatim
                  +---------- UPDATE location (PostGIS) <------------+

     API ---HTTP (3s timeout, 1 attempt)---> Mock Community API :4000
```

## 3.3 Who does what: Gemini is not the geocoder, and neither is PostGIS

| Component | Responsibility | Explicitly does **not** |
|---|---|---|
| Gemini | Extract the place **name** from free text (`"Manhattan, NYC"`), or `null` | Produce coordinates (LLMs hallucinate them) |
| Nominatim | Turn the place name into latitude/longitude | Store anything |
| PostGIS | Store `GEOGRAPHY(POINT,4326)` and run distance queries | Geocode |

Other key statements:

* **PostgreSQL is the source of truth.** Redis is a cache and event transport only.
* **Redis Streams are not Redis Pub/Sub.** Streams persist messages, support consumer groups, acknowledgements, a pending list and reclaim; Pub/Sub loses messages for absent subscribers.
* **The transactional outbox** guarantees that a committed database change always yields exactly one pending event (and no event exists without its change).

## 3.4 Layering inside the code

Each module follows `routes (thin controller) -> service (business rules) -> repository (SQL)`. External systems are hidden behind interfaces so tests can swap them for fakes:

* `LocationExtractor` (Gemini), `Geocoder` (Nominatim), `CommunityReportsProvider` (community API)
* `Cache` (Redis), `UserRepository`, `DisasterRepository`, `ResourceRepository`, `ReportRepository`

`createApp(deps)` in `src/app.ts` receives all dependencies as arguments. Production wiring is in `src/server.ts`; tests pass in-memory fakes.

# 4. Folder structure

```text
disaster-sri/
|-- package.json, tsconfig.json, vitest.config.ts   Backend tooling + root scripts (setup, dev, migrate, seed, test)
|-- .gitignore, .gitattributes                       Repo hygiene (.env and node_modules are never committed)
|-- Dockerfile, .dockerignore, docker-compose.yml    Containerisation
|-- .env.example                                     Config template (copy to .env, which is git-ignored)
|-- README.md                                        Architecture/decisions doc for reviewers
|-- REPORT.md                                        This report
|
|-- migrations/
|   `-- 001_init.sql                 Enums, 5 tables, PostGIS extension, all indexes
|
|-- docs/
|   |-- openapi.json                 OpenAPI 3 export (npm run docs:openapi)
|   `-- postman_collection.json      Postman collection (tokens/ids stored automatically)
|
|-- src/                             ---- BACKEND ----
|   |-- app.ts                       createApp(deps): middleware, routes, /health, /docs
|   |-- server.ts                    API process entrypoint (real wiring)
|   |-- openapi.ts                   Hand-written OpenAPI 3 spec (incl. SSE description)
|   |-- docs/export-openapi.ts       Writes docs/openapi.json from the spec
|   |-- types.ts                     Shared domain types + EventEnvelope
|   |-- config/env.ts                Zod-validated environment (fails fast on bad config)
|   |-- db/
|   |   |-- migrate.ts               Forward-only SQL migration runner (advisory-locked)
|   |   `-- seed.ts                  Idempotent seed: users, disasters, resources, reports
|   |-- infra/
|   |   |-- db.ts                    Pool, withTx(), insertOutbox()
|   |   |-- cache.ts                 Cache interface, RedisCache, TTL jitter, locks
|   |   `-- event-bus.ts             Stream constants, XADD, consumer-group loop
|   |-- middleware/
|   |   |-- auth.ts                  JWT authentication + role authorization
|   |   `-- error-handler.ts         Uniform error shape, 404, DB-down => 503
|   |-- modules/
|   |   |-- auth/                    register/login (routes, service, repository, schema)
|   |   |-- disasters/               CRUD + cache-aside + ownership rules
|   |   |-- resources/               PostGIS nearby search
|   |   |-- reports/                 Cache-aside + coalescing + stale fallback + persistence
|   |   |-- location/location.service.ts   Extraction -> geocode -> resolve, retry policy
|   |   `-- realtime/sse-hub.ts      SSE client set, heartbeat, broadcast
|   |-- providers/                   External integrations behind interfaces
|   |   |-- types.ts                 LocationExtractor, Geocoder, CommunityReportsProvider
|   |   |-- gemini.ts, nominatim.ts, community.ts
|   |-- workers/
|   |   |-- outbox-publisher.ts      publishOutboxBatch() + polling loop
|   |   |-- location-worker.ts       Stream consumer -> LocationService
|   |   `-- realtime-worker.ts       Stream consumer -> SSE + HTTP server on :3001
|   `-- utils/                       logger.ts (structured JSON), errors.ts (AppError helpers)
|
|-- mock-community-api/              Separate "external" service (:4000)
|   |-- app.ts                       Scenarios: success | error | slow | empty
|   `-- server.ts
|
|-- tests/                           51 automated tests (Vitest + Supertest)
|   |-- fakes.ts, helpers.ts         In-memory repos/cache/provider, login helpers
|   |-- auth.test.ts, disasters.test.ts, resources.test.ts
|   |-- reports.test.ts, location.test.ts, outbox.test.ts
|
`-- frontend/                        ---- REACT TEST CONSOLE ----
    |-- package.json, vite.config.ts, tsconfig.json, index.html, .env.example
    `-- src/
        |-- main.tsx                 Providers: Query, Auth, Live(SSE), Router
        |-- App.tsx                  Header (health badge, role, sign out), routes
        |-- api.ts                   fetch wrapper: token, typed ApiError, 401 handling
        |-- auth.tsx                 Session context (JWT claims for display only)
        |-- live.tsx                 Single EventSource; feed; query invalidation
        |-- types.ts, index.css
        |-- components/              ui.tsx, MapView.tsx (Leaflet), DisasterForm.tsx (Zod)
        `-- pages/                   LoginPage, DisastersPage, DisasterDetailPage
```

# 5. Database design

Defined in `migrations/001_init.sql`. PostGIS is an **extension inside PostgreSQL**, not a separate database.

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, name, email (unique), password_hash, role (`ADMIN`/`CONTRIBUTOR`) | bcrypt hashes only |
| `disasters` | id, title, description, `location_text`, `location GEOGRAPHY(POINT,4326)` (nullable), `location_status` (`PENDING`/`RESOLVED`/`FAILED`), `location_attempts`, `location_error`, `tags TEXT[]`, `status` (`ACTIVE`/`RESOLVED`/`CLOSED`), created_by -> users | Location starts NULL/PENDING |
| `resources` | id, name, type (`SHELTER`/`HOSPITAL`/`FOOD`/`WATER`/`RESCUE`), `location GEOGRAPHY(POINT,4326)` NOT NULL | |
| `community_reports` | id, disaster_id -> disasters (`ON DELETE CASCADE`), external_id, source, author, content, reported_at, **UNIQUE(source, external_id)** | Normalised copy of external data |
| `outbox_events` | id, event_type, aggregate_type, aggregate_id, payload JSONB, created_at, published_at, attempts, last_error | Transactional outbox |

**Indexes**

* `users`: unique(email)
* `disasters`: created_at (desc), status, **GIN(tags)**, **GiST(location)**
* `resources`: **GiST(location)**, type
* `community_reports`: unique(source, external_id), disaster_id, reported_at
* `outbox_events`: **partial index on `created_at WHERE published_at IS NULL`** (the publisher only scans the unpublished tail)

# 6. Feature-by-feature implementation

## 6.1 Configuration

`src/config/env.ts` validates every environment variable with Zod at process start (for example `JWT_SECRET` must be at least 16 characters) and exits with a readable message if configuration is wrong. Tunables include cache TTLs, external timeout, retry count and backoff base, CORS origin and the Nominatim User-Agent.

## 6.2 Authentication and authorization

* `POST /auth/register`: bcrypt-hashes the password (cost 10). Role is **always** `CONTRIBUTOR`; `role` in the request body is stripped by Zod, so self-registering as ADMIN is impossible. Duplicate email gives 409.
* `POST /auth/login`: returns `{access_token, token_type: "Bearer"}`. The JWT contains only `sub` and `role` (plus `iat`/`exp`). The same 401 message is used for unknown user and wrong password.
* Auth endpoints are rate-limited (`express-rate-limit`).
* **Authentication** (`middleware/auth.ts`) verifies the token (HS256 only) and sets `req.user`. **Authorization** is separate: coarse role checks are middleware; the ownership rule is in `DisasterService.update`.

| Endpoint | Anonymous | Contributor | Admin |
|---|---|---|---|
| GET /disasters, /disasters/:id, resources, reports, SSE | yes | yes | yes |
| POST /disasters | no (401) | yes | yes |
| PATCH /disasters/:id | no (401) | own only (403 otherwise) | any |
| DELETE /disasters/:id | no (401) | no (403) | yes |

## 6.3 Disaster CRUD

* **POST**: validate -> one transaction inserting the disaster (`location_status=PENDING`) and a `disaster.created` outbox row -> 201. No external call.
* **GET list**: filters `tag`, `status`, `limit`, `offset`; Redis cache-aside with deterministic keys.
* **GET one**: Redis cache-aside, falls back to PostgreSQL.
* **PATCH**: only `title`, `description`, `tags`, `status` are accepted (`.strict()`; location fields cannot be set by clients). Ownership is checked against **PostgreSQL**, not the cache. Update and `disaster.updated` outbox row share a transaction; caches are invalidated afterwards.
* **DELETE** (admin): removes the disaster; its community reports go with it via `ON DELETE CASCADE`; emits `disaster.deleted`; invalidates caches.
* Tags are trimmed and lower-cased so filtering is consistent.

## 6.4 Nearby resources (PostGIS)

`GET /disasters/:id/resources?lat=&lng=&radius=&type=&limit=`

The query converts km to metres and runs entirely inside PostGIS: `ST_DWithin(location, point, metres)` (uses the GiST index), `ST_Distance` for the distance, ordered nearest first. Nothing is computed in Node. Coordinates use `ST_MakePoint(lng, lat)` (x = longitude).

Documented behaviour: if `lat` and `lng` are given (they must be given together) they are the search centre; otherwise the disaster's own resolved location is used; if that is not available (still `PENDING` or `FAILED`) the API returns **422** with an explanatory message. Validation: lat in [-90, 90], lng in [-180, 180], radius positive and at most 500 km.

## 6.5 Location resolution (asynchronous pipeline)

Handled by `LocationService`, run by the location worker (consumer group `location-workers`).

1. Load the disaster. If it no longer exists or is not `PENDING`, do nothing (idempotency).
2. **Gemini** (structured JSON schema, temperature 0, system prompt forbids inventing places or emitting coordinates) returns `{"location": "..."}` or `null`.
3. **Nominatim** geocodes the text; the response is validated (numbers, in-range coordinates).
4. In one transaction: write `location_text`, `location` (PostGIS), `location_status=RESOLVED`, and a `disaster.location_resolved` outbox row. The update is guarded by `location_status <> 'RESOLVED'`. Caches are then invalidated.

**Re-location after an edit.** When a `PATCH` changes the description, the same transaction clears `location` and `location_text`, resets `location_status` to `PENDING` and the attempt counter, and writes a `disaster.location_requested` outbox event in addition to `disaster.updated`. The worker handles both `disaster.created` and `disaster.location_requested`. Every location write is conditional on the description the worker processed, so an answer computed from older text can never overwrite a newer edit. Edits that leave the description unchanged do not touch the location.

**Retry policy**

| Situation | Behaviour |
|---|---|
| Provider failure (timeout, 5xx, 403, malformed response) | Retry with exponential backoff (`base * 2^n`, default 1 s, 2 s...), up to `LOCATION_MAX_RETRIES` (default 3); attempt count and error are stored in the DB; then `FAILED` with `location_error` |
| Gemini returns `null` (no location in text) | `FAILED` immediately, no retry (deterministic) |
| Geocoder finds nothing | `FAILED` immediately, no retry |
| Worker crashes mid-message | Message stays pending in the stream; reclaimed with `XAUTOCLAIM`; DB-stored attempt count is honoured |

In every case the disaster row itself is preserved.

## 6.6 Community reports

`GET /disasters/:id/reports`, implemented in `ReportsService`.

```text
GET /disasters/:id/reports
  |
  v
Redis key community_reports:disaster:<id>
  |-- HIT ------------------------------------------> return  (meta.source = "cache")
  |
  `-- MISS
        |
        v
   SET lock:community_reports:disaster:<id> NX EX     (request coalescing)
        |-- lock NOT acquired: poll cache briefly; if it fills -> return it
        |
        `-- lock acquired (or wait timed out):
              call external API (3 s timeout, ONE attempt, response Zod-validated)
                 |-- success: normalise -> INSERT ... ON CONFLICT (source, external_id)
                 |            DO NOTHING -> write fresh cache (TTL+jitter) and a
                 |            long-lived "stale" copy -> return (meta.source = "external")
                 `-- failure: stale copy exists? -> return it (meta.stale = true)
                              otherwise -> 503 SERVICE_UNAVAILABLE (clear message, no stack)
```

## 6.7 Mock community API

A separate process (port 4000) exposing `GET /external/community-reports?query=&scenario=`:

| scenario | Behaviour |
|---|---|
| `success` (default) | 3 deterministic fake reports mentioning the query |
| `empty` | `{"reports": []}` |
| `error` | HTTP 500 |
| `slow` | ~6 s delay (longer than the API's 3 s timeout) |

IDs are derived from a hash of the query, so re-fetching yields identical external IDs, which lets the `(source, external_id)` uniqueness be verified. Set `COMMUNITY_API_SCENARIO` in `.env` to force a scenario from the main API.

## 6.7b Caching strategy

| Cache | Key | TTL |
|---|---|---|
| Disaster detail | `disaster:<id>` | `CACHE_DISASTER_TTL_SECONDS` (60) |
| Disaster list | `disasters:list:<params sorted alphabetically>` | same |
| Community reports (fresh) | `community_reports:disaster:<id>` | `CACHE_REPORTS_TTL_SECONDS` (120) |
| Community reports (stale copy) | `community_reports:stale:disaster:<id>` | `CACHE_STALE_REPORTS_TTL_SECONDS` (86400) |
| Coalescing lock | `lock:community_reports:disaster:<id>` | timeout + 2 s |

* Every entry has a TTL; there are no permanent keys.
* **TTL jitter:** actual TTL = base + random 0 to 10 %, so keys written together do not expire together.
* **Invalidation** is explicit: create, update, delete and location resolution delete the detail key and the list prefix.
* **Redis is never a hard dependency:** all cache calls swallow errors and use a fail-fast client (no offline queue, 500 ms command timeout). A dead Redis falls back to PostgreSQL / the external API, and `/health` reports `degraded`.

## 6.8 Transactional outbox and event streaming

* Every disaster write inserts an `outbox_events` row in the **same transaction** as the change.
* The **outbox publisher** repeatedly selects unpublished rows (`ORDER BY created_at ... FOR UPDATE SKIP LOCKED`, so several publishers may run concurrently), `XADD`s each to the `disaster-events` stream, then sets `published_at`. On failure it increments `attempts`, stores `last_error`, stops the batch (preserving order and not hammering Redis) and retries on the next tick. If Redis is down, events simply wait in PostgreSQL.
* Delivery is **at-least-once**: a crash between `XADD` and `COMMIT` re-publishes. Consumers de-duplicate on `event_id` (the outbox row id).
* Event envelope: `{event_id, event_type, aggregate_type, aggregate_id, occurred_at, payload}`. Types: `disaster.created`, `disaster.updated`, `disaster.deleted`, `disaster.location_requested`, `disaster.location_resolved`.
* Consumer groups: `location-workers` (a brand-new group reads history from `0`) and `realtime-service` (starts at `$`, only new events). A message is `XACK`ed only after its handler succeeds; failures leave it pending for redelivery.

## 6.9 Realtime (SSE)

* `GET http://localhost:3001/events/disasters` (no auth, per the authorization matrix).
* Correct headers (`text/event-stream`, `no-cache`, `keep-alive`, `X-Accel-Buffering: no`), a `retry:` hint, `id:` / `event:` / `data:` frames, a 15 s `: ping` heartbeat, and cleanup on client disconnect.
* Why SSE and not WebSockets: traffic is server-to-client only, SSE is simpler, and browsers reconnect automatically.

## 6.10 Security and error handling

* Passwords hashed with bcrypt; JWT with only `sub` and `role`; HS256 pinned on verification.
* Helmet security headers, CORS configuration, 100 kB body limit, Zod validation on all inputs, parameterised SQL only (dynamic `UPDATE` uses a fixed column allow-list), no secrets in source (`.env` is git-ignored), timeouts on all external calls.
* One error format everywhere: `{"error": {"code", "message", "details?"}}`. Statuses: 400 (validation / malformed JSON), 401, 403, 404, 409, 413, 422, 429, 500, 503. Stack traces, SQL and secrets are never returned. Database-down errors map to 503.
* Structured JSON logs for request failures, external API failures, extraction/geocoding failures, outbox failures, Redis failures and authentication failures; passwords and keys are not logged.
* `GET /health` reports `ok`, `degraded` (Redis down) or `down` (PostgreSQL down, HTTP 503).

## 6.11 API documentation

OpenAPI 3 spec (`src/openapi.ts`) served as Swagger UI at `http://localhost:3000/docs` and JSON at `/openapi.json`; a static copy is committed as `docs/openapi.json` (regenerate with `npm run docs:openapi`). A Postman collection (`docs/postman_collection.json`, 18 requests covering auth, CRUD, resources, reports, the mock service, health and cleanup) stores the token and the created incident id automatically; it was run end to end with Newman against the live stack with 0 failures. The OpenAPI spec documents auth, request bodies, response schemas, query parameters, error responses, authorization requirements and the SSE endpoint (as a description, since OpenAPI has no native SSE type).

## 6.12 Seed data (`npm run seed`, idempotent)

| Entity | Content |
|---|---|
| Users | `admin@example.com / Admin1234!` (ADMIN); `contributor@example.com / Contributor1234!` (CONTRIBUTOR) |
| Disasters (5) | Manhattan flooding (resolved location, flood/urban, ACTIVE); Sacramento wildfire (ACTIVE); San Francisco earthquake (RESOLVED); Brooklyn storm (PENDING, no location); drought advisory (CLOSED, PENDING) |
| Resources (8) | 5 around Manhattan (shelter, hospital, food, water, rescue), plus Brooklyn shelter, SF General Hospital, Sacramento shelter |
| Reports (3) | Sample normalised reports for the Manhattan and Sacramento disasters |

There is no API to create resources (not required by the brief); add more via SQL or `src/db/seed.ts`.

## 6.13 Web console (frontend)

A dark-first React app in `frontend/` for exercising every backend feature manually. It talks to the API on `:3000` and the SSE service on `:3001` (configurable through `VITE_API_URL`, `VITE_SSE_URL`). Stack: Vite, React 18 + TypeScript, Tailwind CSS 4, React Router, TanStack Query, native `EventSource`, React Leaflet, Zod, Lucide icons.

| Area | Features |
|---|---|
| Design system | Navy/slate glass surfaces with a cyan accent; dark and light themes with a persisted toggle (no flash on load); skeleton loaders; empty and error states; page, modal and toast transitions; `prefers-reduced-motion` respected; responsive from desktop to phone |
| Auth pages | Separate `/login` and `/register`; Zod validation, password visibility toggle, loading state, API errors shown inline; one-click seeded ADMIN / CONTRIBUTOR |
| Dashboard `/` | Stat strip (active, resolved, located, awaiting location), map of located incidents with status-coloured pins, tag and status filters, recent-activity feed, "Report incident" modal (tag chips, Zod validation) |
| Incident page `/disasters/:id` | Header with status and location badges; location-resolution banner (progress bar while `PENDING`, reason and attempts when `FAILED`); large map with a dashed radius ring; **Resources** tab (type chips, radius slider, click the map to search around any point, click a result to fly to it); **Reports** tab (Live / Cached / Stale badge, stale warning, 503 state, refresh); edit modal and delete confirmation |
| Map | Custom pins per disaster status and per resource type (Lucide icons), pulsing ring on active incidents, glass popups and controls, animated fit-to-content, theme-aware appearance |
| Realtime | One `EventSource` for the app; Live / Reconnecting / Offline indicator; quiet toasts; rows flash when they change; queries refresh automatically; events de-duplicated by `event_id` |
| Permissions | Owner or admin sees Edit, only admin sees Delete, others see a "Read-only" badge; enforced by the API, not the UI |

Frontend verification (see section 9): type-check and production build pass; the pages were rendered in headless Edge in both themes and at phone width, and a real-browser script confirmed live SSE updates, toasts, the location flip from `PENDING` to `RESOLVED`, and the permission-dependent buttons. There are no automated frontend tests.

# 7. Flows

## 7.1 Create a disaster (the core reliability path)

```text
Client -- POST /disasters --> Express
   authenticate (JWT) -> authorize (ADMIN|CONTRIBUTOR) -> Zod validate
   BEGIN
     INSERT INTO disasters ...                (location_status = PENDING)
     INSERT INTO outbox_events (disaster.created, payload)
   COMMIT
   invalidate list cache
<-- 201 Created (location: null, PENDING)

...asynchronously...
Outbox publisher: SELECT unpublished FOR UPDATE SKIP LOCKED -> XADD -> set published_at
Redis Stream "disaster-events"
   |-> group location-workers: Location worker (section 7.2)
   `-> group realtime-service: SSE hub -> event: disaster.created -> browsers
```

## 7.2 Location resolution

```text
Location worker receives disaster.created
   -> load disaster; not PENDING? stop (idempotent)
   -> Gemini: description -> "Manhattan, NYC" (or null => FAILED, no retry)
   -> Nominatim: "Manhattan, NYC" -> (lat, lng) (none => FAILED, no retry)
   -> BEGIN; UPDATE disasters SET location = ST_MakePoint(lng,lat)::geography,
             location_text, location_status='RESOLVED';
      INSERT outbox disaster.location_resolved; COMMIT
   -> invalidate caches -> XACK
   provider error => record attempt, sleep base*2^n, retry; after max => FAILED + reason
Outbox publisher -> stream -> SSE: event: disaster.location_resolved
```

## 7.3 Update a disaster

```text
PATCH /disasters/:id -> JWT -> Zod (strict allow-list)
   -> read disaster FROM POSTGRES (not cache)
   -> ADMIN? allowed. CONTRIBUTOR and created_by != me? 403.
   -> BEGIN; UPDATE disasters; INSERT outbox disaster.updated; COMMIT
   -> invalidate detail + list caches -> 200
   -> outbox -> stream -> SSE disaster.updated
```

## 7.4 Delete a disaster

```text
DELETE /disasters/:id -> JWT -> role must be ADMIN (else 403)
   -> BEGIN; DELETE disaster (reports cascade); INSERT outbox disaster.deleted; COMMIT
   -> invalidate caches -> 204 -> SSE disaster.deleted
```

## 7.5 Nearby resources

```text
GET /disasters/:id/resources?lat&lng&radius&type
   -> Zod validate -> load disaster (404 if unknown)
   -> centre = (lat,lng) if given, else disaster.location, else 422
   -> PostGIS: ST_DWithin(location, point, radius_km*1000) [GiST]
               ORDER BY ST_Distance LIMIT n
   -> { resources: [{ id, name, type, distance_km, location:{lat,lng} }] }
```

## 7.6 Community reports and failure handling

See the diagram in section 6.6. Summary of outcomes: fresh cache hit; fetched from external and persisted; concurrent requests coalesced into one upstream call; upstream failure with stale copy (200, `stale: true`); upstream failure without any copy (503).

## 7.7 Authentication

```text
POST /auth/register -> Zod -> bcrypt hash -> INSERT (ON CONFLICT DO NOTHING) -> 201 / 409
POST /auth/login    -> find by email -> bcrypt compare -> JWT {sub, role} -> 200 / 401
Authenticated call  -> Authorization: Bearer <jwt> -> verify (HS256, exp) -> req.user
```

## 7.8 Failure scenarios and expected behaviour

| Failure | Behaviour |
|---|---|
| Gemini or Nominatim down / erroring | Disaster still saved and readable; location stays `PENDING`, retries with backoff, then `FAILED` + reason |
| Redis down | Reads fall back to PostgreSQL; writes still work; outbox events wait; `/health` = degraded |
| PostgreSQL down | 503 "Database temporarily unavailable"; `/health` = down |
| Community API down | Stale cached copy if available (`stale: true`), otherwise 503 |
| Redis Stream unavailable | Outbox rows stay in PostgreSQL and are published later |
| Location worker crash | Unacknowledged message is reclaimed and reprocessed |
| Same event delivered twice | Location worker skips non-`PENDING` disasters; resolving `UPDATE` is guarded; report inserts are `ON CONFLICT DO NOTHING` |

# 8. Testing

## 8.1 How to run

```bash
npm test            # 51 backend tests, no Docker / DB / Redis / API keys needed
npm run typecheck   # backend TypeScript check
cd frontend && npm run build   # frontend type-check + production build
```

## 8.2 Test design

The tests run the **real Express app** with dependencies injected as in-memory fakes (`tests/fakes.ts`): fake repositories that also record outbox events, an in-memory cache with locks, and a fake community provider. No test touches a real external API. Gemini and Nominatim are replaced by fakes or a mocked `fetch`; the community provider is also tested against the **real mock service** started on an ephemeral port.

## 8.3 Backend test inventory (51 tests, 6 files, all passing)

| File | Count | What is covered |
|---|---|---|
| `auth.test.ts` | 4 | Register as CONTRIBUTOR without leaking the hash; stored password is hashed; client-supplied `role: ADMIN` ignored; duplicate email 409; weak password 400; login returns Bearer JWT with only `sub`/`role`(+`iat`/`exp`); wrong password 401 |
| `disasters.test.ts` | 15 | **API:** contributor creates disaster -> 201, `PENDING`, row exists, `disaster.created` outbox event. **Validation:** empty title -> 400 `VALIDATION_ERROR`, nothing created; unknown/forbidden PATCH fields 400; bad query params and non-UUID ids 400. **Business rule:** contributor A cannot update B's disaster (403), admin can (200), owner can; only admin can delete (403 / 401 / 204) and delete emits `disaster.deleted`. **Cache:** detail served from cache on second read and invalidated by PATCH; list cache keyed order-independently and invalidated by create; DB fallback when cache is a no-op. **Helpers:** list-key normalisation, TTL jitter bounds (60..66). **Misc:** unknown route 404 error shape; `/health` reports `degraded` when Redis is down |
| `resources.test.ts` | 9 | km to metres conversion and explicit centre; fallback to the disaster's own location; 422 while location is PENDING; six invalid-parameter cases (lat 91, lng 181, negative/zero/huge radius, lat without lng) all 400 |
| `reports.test.ts` | 11 | **Fake provider:** fetch + normalise + persist then serve from cache (single upstream call); idempotent persistence (re-fetch does not duplicate); 503 with a clear message and no internals when upstream fails and nothing is cached; stale-cache fallback when upstream fails after expiry; **coalescing:** 10 concurrent misses cause exactly one upstream call; unknown disaster 404. **Real mock service:** success, empty, HTTP 500 error, slow scenario times out instead of hanging, and end-to-end mock 500 -> API 503 |
| `location.test.ts` | 10 | Extractor -> geocoder -> resolved + `disaster.location_resolved` event, and coordinates come only from the geocoder; retry with exponential backoff (100 ms, 200 ms) then success; `FAILED` with stored reason after max retries and disaster preserved; no retry when Gemini returns `null`; duplicate delivery is idempotent (providers called once, one event); events for deleted disasters / other event types ignored; Nominatim adapter parses string coordinates, sends a User-Agent, returns `null` for no match, throws on HTTP errors and out-of-range coordinates |
| `outbox.test.ts` | 2 | Publishes rows in order with `event_id` = outbox id, uses `FOR UPDATE SKIP LOCKED`, marks published; on Redis failure records `attempts`/`last_error`, leaves the row unpublished, stops the batch and does not throw |

## 8.4 Coverage against the assignment's test requirements

| Requirement | Satisfied by |
|---|---|
| At least one API endpoint | `POST /disasters` and many others |
| At least one validation/error case | empty title, invalid query params, unknown fields |
| At least one business rule | contributor ownership rule, admin override, admin-only delete |
| At least one external integration / mock | community provider vs real mock service; fakes for Gemini and Nominatim |

# 9. Real-infrastructure verification (Docker Compose)

After the offline tests, the stack was run for real with `docker compose up --build` (PostGIS 16-3.4, Redis 7, real Gemini `gemini-2.5-flash`, real Nominatim).

**Verified working**

* Migration applied cleanly against real PostGIS; seed ran; `/health` reported `postgres: up, redis: up`.
* **Full asynchronous pipeline:** create disaster -> 201 `PENDING` -> outbox -> stream -> location worker -> Gemini -> Nominatim -> PostGIS. "Heavy flooding has affected Manhattan, NYC..." resolved to `Manhattan, NYC` at lat 40.758, lng -73.986 within about 4 seconds.
* **SSE:** a connected client received both `disaster.created` and `disaster.location_resolved`.
* **Nearby resources:** a 5 km search from Manhattan returned five resources ordered nearest first (0.56 km ... 3.25 km); the `type=HOSPITAL` filter returned only the hospital (2 km).
* **Community reports:** first call `source: external` (3 reports), second call `source: cache`.
* **Authorization:** a contributor got 403 on PATCH of an admin's disaster and 403 on DELETE. The tag filter worked.
* **Retry and failure path (observed by accident):** while Nominatim returned HTTP 403, the worker retried 3 times with backoff and ended in `FAILED` with `location_error` recorded; the disaster was never lost.
* **CORS:** preflight for PATCH/DELETE from the frontend origin (`localhost:5173`) succeeds on the API, and the SSE endpoint returns the CORS header.

**Bugs found only by the real run, and fixed**

1. **Postgres healthcheck race.** The image runs a temporary Unix-socket-only server during first-time initialisation; the healthcheck passed against it, so `migrate` connected over TCP too early (`ECONNREFUSED`). Fixed by forcing the healthcheck over TCP (`pg_isready -h 127.0.0.1`).
2. **Nominatim HTTP 403.** Nominatim rejects placeholder/generic User-Agents. Fixed by using a unique, identifying `NOMINATIM_USER_AGENT`; `.env.example` now documents this.
3. During review, a real API key had been placed in the committed `.env.example`, and `JWT_SECRET` was shorter than the enforced minimum. Secrets were moved to the git-ignored `.env` and the example restored to placeholders. **The API key was exposed in the conversation, so rotate it.**

**Not exercised live (covered by offline tests or by reasoning only)**

* Redis-down and PostgreSQL-down behaviour inside the compose stack. Both were checked once on a local boot, where the API stayed up, reported `/health` correctly and returned 503 for DB failures.
* Worker crash followed by `XAUTOCLAIM` reclaim.
* Several outbox publishers running concurrently (`SKIP LOCKED` is used, but only one publisher ran).
* The mock's `slow` and `error` scenarios through the compose stack. They are covered by the offline tests.
* Frontend interactions beyond those listed in section 6.13 (for example editing and deleting through the UI, and the register form against the real API) were not scripted; the frontend has no automated tests.

# 10. How to run

Needs Node 20+ and Docker Desktop. A Gemini API key is only needed for automatic location resolution.

```bash
git clone https://github.com/OMG2Git/disaster-sri.git
cd disaster-sri
cp .env.example .env     # set GEMINI_API_KEY (and optionally NOMINATIM_USER_AGENT)
npm install
npm run setup            # frontend deps, Postgres+Redis in Docker, migrations, seed data
npm run dev              # API, outbox publisher, location worker, realtime, mock API, frontend
```

Alternative (whole backend in Docker): `docker compose up --build`, then `docker compose exec api npm run seed`, then `cd frontend && npm install && npm run dev`.

Tests need no Docker, database, Redis or keys: `npm test`.

| URL | Purpose |
|---|---|
| http://localhost:5173 | Web console |
| http://localhost:3000/docs | Swagger UI |
| http://localhost:3000/health | Health |
| http://localhost:3001/events/disasters | SSE stream |
| http://localhost:4000/external/community-reports?query=Manhattan | Mock external service |

Notes: ports 3000, 3001, 4000, 5173, 5432 and 6379 must be free (run `docker compose down` first if the full Docker stack is running). `npm run setup` and `npm run seed` are safe to re-run. On Windows, if `docker` is not found in a terminal, add `$env:LOCALAPPDATA\Programs\DockerDesktopesourcesin` to `PATH` for that session.

## 10.1 Deliverables checklist

| Item | Location |
|---|---|
| GitHub repository | <https://github.com/OMG2Git/disaster-sri> |
| README | `README.md` |
| `.env.example` | `.env.example`, `frontend/.env.example` |
| API documentation / Postman collection | `/docs` (Swagger UI), `docs/openapi.json`, `docs/postman_collection.json` |
| Mock data / setup scripts | `src/db/seed.ts` (`npm run seed`), `migrations/` (`npm run migrate`), `npm run setup`, `mock-community-api/`, `docker-compose.yml` |

# 11. Design decisions and trade-offs

| Decision | Rationale | Trade-off / next step |
|---|---|---|
| Redis Streams, not Kafka | Redis is already required; streams give persistence, groups, ACK and reclaim without a new cluster in a 48 h take-home | Kafka is appropriate at high volume, long retention and many consumers |
| Transactional outbox | Removes the "DB committed but event lost" failure | At-least-once delivery, so consumers must be idempotent |
| `pg` + SQL migrations, not Prisma | Spatial types are raw SQL anyway; fewer moving parts | Less type-generated convenience |
| Realtime as a separate process with one consumer group | Simple and matches the spec | To scale out, give each instance its own group (or fan out via Pub/Sub after the read) |
| Location retries block the consumer while backing off | Simple; Nominatim's ~1 req/s policy suits serial work | A poison message throwing unexpected errors would be redelivered indefinitely; a dead-letter stream is the next step |
| Description edits re-run location resolution (old location is cleared while re-resolving) | A user may have mistyped or changed the place | Resource search falls back to a clicked point while the incident is `PENDING`; results computed from an older description are discarded |
| Reports unique on `(source, external_id)` globally | As specified in the brief | The same external report can be stored against only one disaster |
| `tsx` runs TypeScript in containers | Fast development | Production image would compile with `tsc` |
| Stale report copy kept separately for 24 h | Serves data during upstream outages | Data can be old; the response flags `stale: true` |

Not built by design: OAuth, MFA, refresh tokens, Kubernetes, Kafka, GraphQL, WebSockets, dead-letter stream, resource-management endpoints, and the optional priority-classification bonus.

# 12. AI usage disclosure

AI assistance (Claude) was used for architecture brainstorming, reviewing design decisions, identifying edge cases (outbox at-least-once delivery, stale-cache fallback, retry versus deterministic failure), and generating much of the code and tests. Running the code against real infrastructure surfaced real defects (section 9), which were fixed. The author should review the code and decisions personally before submission and adjust this section to reflect their own involvement accurately.
