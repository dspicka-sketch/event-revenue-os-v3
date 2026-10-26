-- Human names for tracking-link codes ("ig-bio" -> "Instagram bio link").
CREATE TABLE tracking_link_labels (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (code ~ '^[A-Za-z0-9._~-]{1,100}$'),
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, code)
);
