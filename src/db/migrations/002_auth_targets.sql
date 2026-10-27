-- Shared authentication for desktop web and mobile clients, plus manually
-- entered show targets (plan values, never actual sales).

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  display_name   text,
  -- scrypt$N$r$p$salt$hash (see src/auth/password.ts). Never a plain password.
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  disabled_at    timestamptz
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE organization_members (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- admin: manage targets and integrations. viewer: read and refresh.
  role             text NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the bearer token. The token itself is never stored.
  token_hash    bytea NOT NULL UNIQUE,
  client        text NOT NULL CHECK (client IN ('web', 'mobile', 'cli')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- One target per (event, measure). Source 'manual' until a planning connector
-- (Airtable, M5) supplies plan values.
CREATE TABLE event_targets (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canonical_event_id  uuid NOT NULL,
  measure             text NOT NULL CHECK (measure IN ('paidTickets', 'grossAfterRefunds', 'organizerProceeds')),
  -- Ticket count for paidTickets; minor units of `currency` for money measures.
  target_value        bigint NOT NULL CHECK (target_value >= 0),
  currency            char(3),
  source              text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, canonical_event_id, measure),
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE,
  CHECK ((measure = 'paidTickets') = (currency IS NULL))
);
