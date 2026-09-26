CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('ADMIN', 'CONTRIBUTOR');
CREATE TYPE disaster_status AS ENUM ('ACTIVE', 'RESOLVED', 'CLOSED');
CREATE TYPE location_status AS ENUM ('PENDING', 'RESOLVED', 'FAILED');
CREATE TYPE resource_type AS ENUM ('SHELTER', 'HOSPITAL', 'FOOD', 'WATER', 'RESCUE');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  email         VARCHAR(320) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role NOT NULL DEFAULT 'CONTRIBUTOR',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disasters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             VARCHAR(200) NOT NULL,
  description       TEXT NOT NULL,
  location_text     VARCHAR(500),
  location          GEOGRAPHY(POINT, 4326),
  location_status   location_status NOT NULL DEFAULT 'PENDING',
  -- bookkeeping for the async location pipeline (attempt count + last failure reason)
  location_attempts INTEGER NOT NULL DEFAULT 0,
  location_error    TEXT,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  status            disaster_status NOT NULL DEFAULT 'ACTIVE',
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX disasters_created_at_idx ON disasters (created_at DESC);
CREATE INDEX disasters_status_idx ON disasters (status);
CREATE INDEX disasters_tags_gin_idx ON disasters USING GIN (tags);
CREATE INDEX disasters_location_gist_idx ON disasters USING GIST (location);

CREATE TABLE resources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200) NOT NULL,
  type       resource_type NOT NULL,
  location   GEOGRAPHY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resources_location_gist_idx ON resources USING GIST (location);
CREATE INDEX resources_type_idx ON resources (type);

CREATE TABLE community_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_id UUID NOT NULL REFERENCES disasters(id) ON DELETE CASCADE,
  external_id VARCHAR(200) NOT NULL,
  source      VARCHAR(100) NOT NULL,
  author      VARCHAR(200),
  content     TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT community_reports_source_external_id_key UNIQUE (source, external_id)
);
CREATE INDEX community_reports_disaster_idx ON community_reports (disaster_id);
CREATE INDEX community_reports_reported_at_idx ON community_reports (reported_at DESC);

CREATE TABLE outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id   UUID NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
-- Partial index: the publisher only ever scans the (small) unpublished tail.
CREATE INDEX outbox_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;
