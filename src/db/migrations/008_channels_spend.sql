-- Channels for tracking links, and marketing spend entered per show (D16).

ALTER TABLE tracking_link_labels ALTER COLUMN label DROP NOT NULL;
ALTER TABLE tracking_link_labels DROP CONSTRAINT tracking_link_labels_label_check;
ALTER TABLE tracking_link_labels
  ADD COLUMN channel text CHECK (channel IN ('email', 'social', 'paid_ads', 'website', 'partner', 'other')),
  ADD CONSTRAINT tracking_link_labels_label_len CHECK (label IS NULL OR length(label) BETWEEN 1 AND 80),
  ADD CONSTRAINT tracking_link_labels_something CHECK (label IS NOT NULL OR channel IS NOT NULL);

-- What a source cost for one show. Entered by an admin; an expense, never revenue.
CREATE TABLE marketing_spend (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  canonical_event_id  uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^[A-Za-z0-9._~-]{1,100}$'),
  currency            char(3) NOT NULL,
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  updated_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, canonical_event_id, code, currency),
  FOREIGN KEY (canonical_event_id, organization_id) REFERENCES canonical_events(id, organization_id) ON DELETE CASCADE
);
