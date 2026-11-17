-- AutoRev underplay discovery (D19): a per-organization watchlist and the
-- candidate pipeline the daily discovery job maintains.

CREATE TABLE watch_artists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Normalized identity (src/domain/discovery.ts artistKey): one act, one row.
  artist_key       text NOT NULL,
  name             text NOT NULL,
  genre            text,
  -- Where this entry came from and how far it can be trusted.
  source_note      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, artist_key)
);

CREATE TABLE discovery_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  artist_key       text NOT NULL,
  artist           text NOT NULL,
  origin           text NOT NULL CHECK (origin IN ('watchlist', 'small_room')),
  -- Relationship stage, set by a person. The discovery job never changes it.
  stage            text NOT NULL DEFAULT 'research' CHECK (stage IN (
    'research', 'representation_identified', 'initial_outreach', 'conversation_started', 'routing_discussion',
    'offer_submitted', 'negotiation', 'booked', 'repeat_artist', 'long_term_relationship')),
  -- Set when a person decides not to pursue the act. Dismissed acts stay dismissed.
  dismissed_at     timestamptz,
  score            integer NOT NULL,
  reasons          jsonb NOT NULL,
  -- The act's soonest qualifying area show at last_seen_at (act, venue, date, status, ticket link).
  anchor           jsonb NOT NULL,
  -- Scoring method version, so a later change of weights is visible in the data.
  method           text NOT NULL,
  first_seen_at    timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL,
  stage_changed_at timestamptz,
  notes            text,
  UNIQUE (organization_id, artist_key)
);
CREATE INDEX discovery_candidates_org_seen_idx ON discovery_candidates (organization_id, first_seen_at DESC);
