-- At most one running sync per event, enforced by the database rather than a
-- check-then-insert in application code (which races across processes).

-- Close out any duplicate 'running' rows so the unique index can be built.
UPDATE sync_runs SET status = 'failed', finished_at = now(), error_kind = 'abandoned',
       error_message = 'Superseded by a newer running sync (migration 003).'
WHERE status = 'running'
  AND id NOT IN (
    SELECT DISTINCT ON (organization_id, canonical_event_id) id
    FROM sync_runs WHERE status = 'running'
    ORDER BY organization_id, canonical_event_id, started_at DESC
  );

CREATE UNIQUE INDEX sync_runs_one_running_per_event
  ON sync_runs (organization_id, canonical_event_id) WHERE status = 'running';
