-- Marketing linkage (DECISIONS D13): the tracking-link code Eventbrite stores
-- against a purchase (`?aff=CODE`). A marketing tag, not personal data.
ALTER TABLE order_lines ADD COLUMN tracking_code text;
CREATE INDEX order_lines_tracking_idx ON order_lines (organization_id, tracking_code) WHERE tracking_code IS NOT NULL;
