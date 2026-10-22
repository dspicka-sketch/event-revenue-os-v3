-- Marketing sources (D13). Campaigns are marketing touchpoints, never sales.

-- Connection-level syncs (e.g. Mailchimp) have no canonical event.
ALTER TABLE sync_runs ALTER COLUMN canonical_event_id DROP NOT NULL;
ALTER TABLE sync_runs ADD COLUMN campaigns_seen integer;
CREATE UNIQUE INDEX sync_runs_one_running_per_connection
  ON sync_runs (organization_id, connection_id) WHERE status = 'running' AND canonical_event_id IS NULL;

CREATE TABLE marketing_campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id        uuid NOT NULL,
  provider             text NOT NULL,
  provider_account_id  text NOT NULL,
  source_id            text NOT NULL,
  title                text NOT NULL,
  sent_at              timestamptz,
  emails_sent          integer,
  unique_opens         integer,
  ingested_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_sync_id    uuid NOT NULL,
  FOREIGN KEY (connection_id, organization_id) REFERENCES source_connections(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, provider, provider_account_id, source_id),
  UNIQUE (id, organization_id)
);

-- Which ticketing event (and tracking code) each campaign linked to, with clicks.
CREATE TABLE campaign_event_links (
  organization_id   uuid NOT NULL,
  campaign_id       uuid NOT NULL,
  event_provider    text NOT NULL,
  source_event_id   text NOT NULL,
  tracking_code     text,
  unique_clicks     integer,
  total_clicks      integer,
  FOREIGN KEY (campaign_id, organization_id) REFERENCES marketing_campaigns(id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX campaign_event_links_key
  ON campaign_event_links (campaign_id, event_provider, source_event_id, coalesce(tracking_code, ''));
CREATE INDEX campaign_event_links_event_idx ON campaign_event_links (organization_id, event_provider, source_event_id);
