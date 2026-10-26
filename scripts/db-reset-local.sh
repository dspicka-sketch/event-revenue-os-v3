#!/usr/bin/env bash
# Recreate a local test database and apply the shim + migrations + seed.
set -euo pipefail
DB=${1:-p104test}
export PGPASSWORD=${PGPASSWORD:-postgres}
H="-h ${PGHOST:-localhost} -U ${PGUSER:-postgres}"
dropdb $H --if-exists "$DB"
createdb $H "$DB"
psql $H -d "$DB" -v ON_ERROR_STOP=1 -q -f tests/db/supabase-shim.sql
for f in supabase/migrations/*.sql; do psql $H -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"; done
