-- RevOS M1 schema. Money is stored as integer minor units (bigint) plus an
-- ISO 4217 currency; NULL means "not supplied by source" (unknown), never zero.

CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'America/Los_Angeles',
  is_fixture    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  provider_account_id  text NOT NULL,
  mode                 text NOT NULL CHECK (mode IN ('live', 'fixture')),
  -- Name of the server environment variable / secret holding the credential.
  -- The credential value itself is never stored in the database.
  secret_ref           text,
  -- 'fixture' = last fixture read succeeded. Fixture connections can never be
  -- 'verified': verified means a successful authorized LIVE read.
  status               text NOT NULL DEFAULT 'not_configured'
                       CHECK (status IN ('not_configured', 'verifying', 'verified', 'stale', 'error', 'fixture')),
  status_kind          text,
  status_detail        text,
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  proceeds_policy      text NOT NULL DEFAULT 'unverified'
                       CHECK (proceeds_policy IN ('unverified', 'gross_minus_fees_and_tax')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (mode = 'live' OR status <> 'verified'),
  CHECK (mode = 'fixture' OR status <> 'fixture'),
  UNIQUE (organization_id, provider, provider_account_id),
  UNIQUE (id, organization_id)
);

-- One canonical event = one performance (a specific date/time), not a show title.
CREATE TABLE canonical_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  performance_start_utc timestamptz,
  performance_end_utc   timestamptz,
  venue_timezone        text NOT NULL DEFAULT 'America/Los_Angeles',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE source_event_mappings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id        uuid NOT NULL,
  provider             text NOT NULL,
  provider_account_id  text NOT NULL,
  source_event_id      text NOT NULL,
  canonical_event_id   uuid NOT NULL,
  source_name          text,
  source_start_utc     timestamptz,
  source_currency      text,
  source_series_id     text,
  source_updated_at    timestamptz,
  ingested_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, organization_id) REFERENCES source_connections(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, provider, provider_account_id, source_event_id)
);

CREATE TABLE sync_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id        uuid NOT NULL,
  canonical_event_id   uuid NOT NULL,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  status               text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error_kind           text,
  error_message        text,
  pages_fetched        integer,
  requests_made        integer,
  orders_seen          integer,
  lines_seen           integer,
  orders_inserted      integer,
  orders_updated       integer,
  orders_missing       integer,
  FOREIGN KEY (connection_id, organization_id) REFERENCES source_connections(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, organization_id)
);
CREATE INDEX sync_runs_event_idx ON sync_runs (organization_id, canonical_event_id, started_at DESC);

CREATE TABLE orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id        uuid NOT NULL,
  provider             text NOT NULL,
  provider_account_id  text NOT NULL,
  source_id            text NOT NULL,
  source_event_id      text NOT NULL,
  canonical_event_id   uuid NOT NULL,
  source_status        text NOT NULL,
  status               text NOT NULL CHECK (status IN ('completed', 'refunded', 'cancelled', 'unpaid', 'other')),
  currency             char(3) NOT NULL,
  currency_scale       smallint NOT NULL,
  gross_minor          bigint,
  base_price_minor     bigint,
  provider_fee_minor   bigint,
  payment_fee_minor    bigint,
  tax_minor            bigint,
  transaction_at       timestamptz,
  source_updated_at    timestamptz,
  ingested_at          timestamptz NOT NULL DEFAULT now(),
  first_seen_sync_id   uuid NOT NULL,
  last_seen_sync_id    uuid NOT NULL,
  missing_from_source  boolean NOT NULL DEFAULT false,
  FOREIGN KEY (connection_id, organization_id) REFERENCES source_connections(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, provider, provider_account_id, source_id),
  UNIQUE (id, organization_id)
);
CREATE INDEX orders_event_idx ON orders (organization_id, canonical_event_id);

CREATE TABLE order_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id           uuid NOT NULL,
  provider                text NOT NULL,
  provider_account_id     text NOT NULL,
  source_id               text NOT NULL,
  order_source_id         text NOT NULL,
  source_event_id         text NOT NULL,
  canonical_event_id      uuid NOT NULL,
  ticket_class_source_id  text,
  ticket_class_name       text,
  source_status           text NOT NULL,
  status                  text NOT NULL CHECK (status IN ('active', 'refunded', 'cancelled', 'unpaid', 'other')),
  quantity                integer NOT NULL CHECK (quantity >= 0),
  currency                char(3) NOT NULL,
  gross_minor             bigint,
  base_price_minor        bigint,
  provider_fee_minor      bigint,
  payment_fee_minor       bigint,
  tax_minor               bigint,
  source_updated_at       timestamptz,
  ingested_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_sync_id       uuid NOT NULL,
  missing_from_source     boolean NOT NULL DEFAULT false,
  FOREIGN KEY (connection_id, organization_id) REFERENCES source_connections(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, provider, provider_account_id, source_id)
);
CREATE INDEX order_lines_event_idx ON order_lines (organization_id, canonical_event_id);

CREATE TABLE reconciliation_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canonical_event_id   uuid NOT NULL,
  sync_run_id          uuid NOT NULL,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  -- Output of computeEventRevenue (per-currency measures + exceptions).
  result               jsonb NOT NULL,
  -- Optional comparison against a manually entered source report.
  source_report        jsonb,
  report_comparison    jsonb,
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (sync_run_id, organization_id) REFERENCES sync_runs(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX reconciliation_event_idx ON reconciliation_results (organization_id, canonical_event_id, computed_at DESC);
