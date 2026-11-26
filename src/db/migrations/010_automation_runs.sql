-- AutoRev run log (D19): one row per scheduled job run, so a missed or failed
-- run is visible and can be reported in the next digest.

CREATE TABLE automation_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Insertion order, so "the latest run" is well defined even when two runs share a timestamp.
  seq              bigserial NOT NULL,
  job              text NOT NULL CHECK (job IN ('sync_sweep', 'weekly_digest', 'discovery')),
  -- Null for jobs that cover every organization.
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL,
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  -- Counts and named failures. Never secrets or patron data.
  detail           jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX automation_runs_job_idx ON automation_runs (job, started_at DESC);
