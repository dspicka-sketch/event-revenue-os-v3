// Data access. Every query that touches tenant data is scoped by
// organization_id; there are deliberately no unscoped read helpers.

import type pg from "pg";
import type { EventRevenue, SourceReportFigures, ReconciliationRow } from "../domain/revenue.js";
import { currencyScale } from "../domain/money.js";
import type { NormalizedEvent, NormalizedLine, NormalizedOrder, ProceedsPolicy } from "../domain/types.js";
import type { Db } from "./pool.js";

type Queryable = Db | pg.PoolClient;

export type ConnectionStatus = "not_configured" | "verifying" | "verified" | "stale" | "error" | "fixture";

export interface OrganizationRow {
  id: string;
  name: string;
  timezone: string;
  is_fixture: boolean;
}

export interface ConnectionRow {
  id: string;
  organization_id: string;
  provider: string;
  provider_account_id: string;
  mode: "live" | "fixture";
  secret_ref: string | null;
  status: ConnectionStatus;
  status_kind: string | null;
  status_detail: string | null;
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  proceeds_policy: ProceedsPolicy;
}

export interface MappingRow {
  id: string;
  organization_id: string;
  connection_id: string;
  provider: string;
  provider_account_id: string;
  source_event_id: string;
  canonical_event_id: string;
  venue_timezone: string;
}

// ---------------------------------------------------------------- setup

export async function createOrganization(db: Queryable, o: { name: string; timezone?: string; isFixture: boolean }): Promise<OrganizationRow> {
  const r = await db.query<OrganizationRow>(
    "INSERT INTO organizations (name, timezone, is_fixture) VALUES ($1, $2, $3) RETURNING id, name, timezone, is_fixture",
    [o.name, o.timezone ?? "America/Los_Angeles", o.isFixture],
  );
  return r.rows[0]!;
}

export async function listOrganizations(db: Queryable): Promise<OrganizationRow[]> {
  return (await db.query<OrganizationRow>("SELECT id, name, timezone, is_fixture FROM organizations ORDER BY is_fixture, name")).rows;
}

export async function getOrganization(db: Queryable, orgId: string): Promise<OrganizationRow | null> {
  return (await db.query<OrganizationRow>("SELECT id, name, timezone, is_fixture FROM organizations WHERE id = $1", [orgId])).rows[0] ?? null;
}

export async function createConnection(
  db: Queryable,
  c: { organizationId: string; provider: string; providerAccountId: string; mode: "live" | "fixture"; secretRef: string | null; proceedsPolicy?: ProceedsPolicy },
): Promise<ConnectionRow> {
  const org = await getOrganization(db, c.organizationId);
  if (!org) throw new Error("Organization not found");
  // Fixture and live data never share an organization.
  if (org.is_fixture !== (c.mode === "fixture")) {
    throw new Error(`Cannot attach a ${c.mode} connection to a ${org.is_fixture ? "fixture" : "live"} organization.`);
  }
  const r = await db.query<ConnectionRow>(
    `INSERT INTO source_connections (organization_id, provider, provider_account_id, mode, secret_ref, proceeds_policy)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [c.organizationId, c.provider, c.providerAccountId, c.mode, c.secretRef, c.proceedsPolicy ?? "unverified"],
  );
  return r.rows[0]!;
}

export async function createMappedEvent(
  db: Queryable,
  m: { organizationId: string; connectionId: string; sourceEventId: string; name: string; startUtc?: string | null; timezone?: string },
): Promise<{ canonicalEventId: string; mappingId: string }> {
  const conn = await getConnection(db, m.organizationId, m.connectionId);
  if (!conn) throw new Error("Connection not found in organization");
  const ev = await db.query<{ id: string }>(
    "INSERT INTO canonical_events (organization_id, name, performance_start_utc, venue_timezone) VALUES ($1, $2, $3, $4) RETURNING id",
    [m.organizationId, m.name, m.startUtc ?? null, m.timezone ?? "America/Los_Angeles"],
  );
  const map = await db.query<{ id: string }>(
    `INSERT INTO source_event_mappings (organization_id, connection_id, provider, provider_account_id, source_event_id, canonical_event_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [m.organizationId, conn.id, conn.provider, conn.provider_account_id, m.sourceEventId, ev.rows[0]!.id],
  );
  return { canonicalEventId: ev.rows[0]!.id, mappingId: map.rows[0]!.id };
}

export async function getConnection(db: Queryable, orgId: string, connectionId: string): Promise<ConnectionRow | null> {
  return (await db.query<ConnectionRow>("SELECT * FROM source_connections WHERE organization_id = $1 AND id = $2", [orgId, connectionId])).rows[0] ?? null;
}

export async function getEventMapping(db: Queryable, orgId: string, canonicalEventId: string): Promise<{ mapping: MappingRow; connection: ConnectionRow } | null> {
  const m = (
    await db.query<MappingRow>(
      "SELECT m.id, m.organization_id, m.connection_id, m.provider, m.provider_account_id, m.source_event_id, m.canonical_event_id, e.venue_timezone FROM source_event_mappings m JOIN canonical_events e ON e.id = m.canonical_event_id AND e.organization_id = m.organization_id WHERE m.organization_id = $1 AND m.canonical_event_id = $2 ORDER BY m.ingested_at LIMIT 1",
      [orgId, canonicalEventId],
    )
  ).rows[0];
  if (!m) return null;
  const connection = await getConnection(db, orgId, m.connection_id);
  return connection ? { mapping: m, connection } : null;
}

// ---------------------------------------------------------------- sync bookkeeping

export async function hasRunningSync(db: Queryable, orgId: string, eventId: string): Promise<boolean> {
  const r = await db.query(
    "SELECT 1 FROM sync_runs WHERE organization_id = $1 AND canonical_event_id = $2 AND status = 'running' AND started_at > now() - interval '10 minutes'",
    [orgId, eventId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function startSyncRun(db: Queryable, orgId: string, connectionId: string, eventId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    "INSERT INTO sync_runs (organization_id, connection_id, canonical_event_id, status) VALUES ($1, $2, $3, 'running') RETURNING id",
    [orgId, connectionId, eventId],
  );
  await db.query(
    `UPDATE source_connections SET last_attempt_at = now(),
       status = CASE WHEN last_success_at IS NULL THEN 'verifying' ELSE status END
     WHERE organization_id = $1 AND id = $2`,
    [orgId, connectionId],
  );
  return r.rows[0]!.id;
}

export async function countSucceededSyncs(db: Queryable, orgId: string, eventId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM sync_runs WHERE organization_id = $1 AND canonical_event_id = $2 AND status = 'succeeded'",
    [orgId, eventId],
  );
  return r.rows[0]!.n;
}

export async function failSyncRun(db: Queryable, orgId: string, connectionId: string, runId: string, kind: string, message: string): Promise<void> {
  await db.query(
    "UPDATE sync_runs SET status = 'failed', finished_at = now(), error_kind = $3, error_message = $4 WHERE organization_id = $1 AND id = $2",
    [orgId, runId, kind, message],
  );
  // Last good data is retained; the connection is marked stale if it ever succeeded.
  await db.query(
    `UPDATE source_connections SET
       status = CASE WHEN $3 = 'not_configured' THEN 'not_configured' WHEN last_success_at IS NULL THEN 'error' ELSE 'stale' END,
       status_kind = $3, status_detail = $4
     WHERE organization_id = $1 AND id = $2`,
    [orgId, connectionId, kind, message],
  );
}

export interface UpsertCounts {
  inserted: number;
  updated: number;
  missing: number;
}

/**
 * Persist a full snapshot of one event. Upserts on the unique key
 * (organization, provider, account, source ID) so repeated syncs update in
 * place. Records not returned by this full read are flagged missing_from_source
 * (excluded from totals, surfaced for review) rather than deleted.
 */
export async function persistSnapshot(
  client: pg.PoolClient,
  ctx: { orgId: string; connection: ConnectionRow; mapping: MappingRow; runId: string },
  snap: { event: NormalizedEvent; orders: NormalizedOrder[]; lines: NormalizedLine[] },
): Promise<UpsertCounts> {
  const { orgId, connection: c, mapping: m, runId } = ctx;
  await client.query(
    `UPDATE source_event_mappings SET source_name = $3, source_start_utc = $4, source_currency = $5, source_series_id = $6,
       source_updated_at = $7, ingested_at = now()
     WHERE organization_id = $1 AND id = $2`,
    [orgId, m.id, snap.event.name, snap.event.startUtc, snap.event.currency, snap.event.seriesId, snap.event.sourceUpdatedAt],
  );
  let inserted = 0;
  let updated = 0;
  for (const o of snap.orders) {
    const r = await client.query<{ inserted: boolean }>(
      `INSERT INTO orders (organization_id, connection_id, provider, provider_account_id, source_id, source_event_id, canonical_event_id,
         source_status, status, currency, currency_scale, gross_minor, base_price_minor, provider_fee_minor, payment_fee_minor, tax_minor,
         transaction_at, source_updated_at, first_seen_sync_id, last_seen_sync_id, missing_from_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,false)
       ON CONFLICT (organization_id, provider, provider_account_id, source_id) DO UPDATE SET
         source_event_id = EXCLUDED.source_event_id, canonical_event_id = EXCLUDED.canonical_event_id,
         source_status = EXCLUDED.source_status, status = EXCLUDED.status, currency = EXCLUDED.currency,
         currency_scale = EXCLUDED.currency_scale, gross_minor = EXCLUDED.gross_minor, base_price_minor = EXCLUDED.base_price_minor,
         provider_fee_minor = EXCLUDED.provider_fee_minor, payment_fee_minor = EXCLUDED.payment_fee_minor, tax_minor = EXCLUDED.tax_minor,
         transaction_at = EXCLUDED.transaction_at, source_updated_at = EXCLUDED.source_updated_at, ingested_at = now(),
         last_seen_sync_id = EXCLUDED.last_seen_sync_id, missing_from_source = false
       RETURNING (xmax = 0) AS inserted`,
      [orgId, c.id, c.provider, c.provider_account_id, o.sourceId, o.sourceEventId, m.canonical_event_id, o.sourceStatus, o.status,
        o.currency, currencyScale(o.currency), o.grossMinor, o.basePriceMinor, o.providerFeeMinor, o.paymentFeeMinor, o.taxMinor,
        o.createdAt, o.sourceUpdatedAt, runId],
    );
    if (r.rows[0]!.inserted) inserted++;
    else updated++;
  }
  for (const l of snap.lines) {
    await client.query(
      `INSERT INTO order_lines (organization_id, connection_id, provider, provider_account_id, source_id, order_source_id, source_event_id,
         canonical_event_id, ticket_class_source_id, ticket_class_name, source_status, status, quantity, currency, gross_minor,
         base_price_minor, provider_fee_minor, payment_fee_minor, tax_minor, source_updated_at, last_seen_sync_id, missing_from_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,false)
       ON CONFLICT (organization_id, provider, provider_account_id, source_id) DO UPDATE SET
         order_source_id = EXCLUDED.order_source_id, source_event_id = EXCLUDED.source_event_id, canonical_event_id = EXCLUDED.canonical_event_id,
         ticket_class_source_id = EXCLUDED.ticket_class_source_id, ticket_class_name = EXCLUDED.ticket_class_name,
         source_status = EXCLUDED.source_status, status = EXCLUDED.status, quantity = EXCLUDED.quantity, currency = EXCLUDED.currency,
         gross_minor = EXCLUDED.gross_minor, base_price_minor = EXCLUDED.base_price_minor, provider_fee_minor = EXCLUDED.provider_fee_minor,
         payment_fee_minor = EXCLUDED.payment_fee_minor, tax_minor = EXCLUDED.tax_minor, source_updated_at = EXCLUDED.source_updated_at,
         ingested_at = now(), last_seen_sync_id = EXCLUDED.last_seen_sync_id, missing_from_source = false`,
      [orgId, c.id, c.provider, c.provider_account_id, l.sourceId, l.orderSourceId, l.sourceEventId, m.canonical_event_id,
        l.ticketClassSourceId, l.ticketClassName, l.sourceStatus, l.status, l.quantity, l.currency, l.grossMinor, l.basePriceMinor,
        l.providerFeeMinor, l.paymentFeeMinor, l.taxMinor, l.sourceUpdatedAt, runId],
    );
  }
  const missing = await client.query(
    `UPDATE orders SET missing_from_source = true
     WHERE organization_id = $1 AND connection_id = $2 AND source_event_id = $3 AND last_seen_sync_id <> $4 AND NOT missing_from_source`,
    [orgId, c.id, m.source_event_id, runId],
  );
  await client.query(
    `UPDATE order_lines SET missing_from_source = true
     WHERE organization_id = $1 AND connection_id = $2 AND source_event_id = $3 AND last_seen_sync_id <> $4`,
    [orgId, c.id, m.source_event_id, runId],
  );
  return { inserted, updated, missing: missing.rowCount ?? 0 };
}

interface OrderDbRow {
  source_id: string; source_event_id: string; source_status: string; status: NormalizedOrder["status"]; currency: string;
  gross_minor: number | null; base_price_minor: number | null; provider_fee_minor: number | null; payment_fee_minor: number | null;
  tax_minor: number | null; transaction_at: Date | null; source_updated_at: Date | null;
}
interface LineDbRow {
  source_id: string; order_source_id: string; source_event_id: string; ticket_class_source_id: string | null; ticket_class_name: string | null;
  source_status: string; status: NormalizedLine["status"]; quantity: number; currency: string; gross_minor: number | null;
  base_price_minor: number | null; provider_fee_minor: number | null; payment_fee_minor: number | null; tax_minor: number | null;
  source_updated_at: Date | null;
}

/** Load the stored (non-missing) records for an event, as normalized records. */
export async function loadEventRecords(db: Queryable, orgId: string, eventId: string) {
  const orders = (
    await db.query<OrderDbRow>("SELECT * FROM orders WHERE organization_id = $1 AND canonical_event_id = $2 AND NOT missing_from_source ORDER BY source_id", [orgId, eventId])
  ).rows.map(
    (r): NormalizedOrder => ({
      sourceId: r.source_id, sourceEventId: r.source_event_id, sourceStatus: r.source_status, status: r.status, currency: r.currency.trim(),
      grossMinor: r.gross_minor, basePriceMinor: r.base_price_minor, providerFeeMinor: r.provider_fee_minor, paymentFeeMinor: r.payment_fee_minor,
      taxMinor: r.tax_minor, createdAt: r.transaction_at?.toISOString() ?? null, sourceUpdatedAt: r.source_updated_at?.toISOString() ?? null,
    }),
  );
  const lines = (
    await db.query<LineDbRow>("SELECT * FROM order_lines WHERE organization_id = $1 AND canonical_event_id = $2 AND NOT missing_from_source ORDER BY source_id", [orgId, eventId])
  ).rows.map(
    (r): NormalizedLine => ({
      sourceId: r.source_id, orderSourceId: r.order_source_id, sourceEventId: r.source_event_id, ticketClassSourceId: r.ticket_class_source_id,
      ticketClassName: r.ticket_class_name, sourceStatus: r.source_status, status: r.status, quantity: r.quantity, currency: r.currency.trim(),
      grossMinor: r.gross_minor, basePriceMinor: r.base_price_minor, providerFeeMinor: r.provider_fee_minor, paymentFeeMinor: r.payment_fee_minor,
      taxMinor: r.tax_minor, sourceUpdatedAt: r.source_updated_at?.toISOString() ?? null,
    }),
  );
  const missing = (
    await db.query<{ source_id: string }>("SELECT source_id FROM orders WHERE organization_id = $1 AND canonical_event_id = $2 AND missing_from_source ORDER BY source_id", [orgId, eventId])
  ).rows.map((r) => r.source_id);
  return { orders, lines, missing };
}

export async function completeSyncRun(
  client: pg.PoolClient,
  ctx: { orgId: string; connection: ConnectionRow; runId: string; eventId: string },
  stats: { pagesFetched: number; requestsMade: number; ordersSeen: number; linesSeen: number } & UpsertCounts,
  revenue: EventRevenue,
): Promise<void> {
  await client.query(
    `UPDATE sync_runs SET status = 'succeeded', finished_at = now(), pages_fetched = $3, requests_made = $4, orders_seen = $5,
       lines_seen = $6, orders_inserted = $7, orders_updated = $8, orders_missing = $9
     WHERE organization_id = $1 AND id = $2`,
    [ctx.orgId, ctx.runId, stats.pagesFetched, stats.requestsMade, stats.ordersSeen, stats.linesSeen, stats.inserted, stats.updated, stats.missing],
  );
  await client.query(
    "INSERT INTO reconciliation_results (organization_id, canonical_event_id, sync_run_id, result) VALUES ($1, $2, $3, $4)",
    [ctx.orgId, ctx.eventId, ctx.runId, JSON.stringify(revenue)],
  );
  await client.query(
    `UPDATE source_connections SET status = $3, status_kind = NULL, status_detail = NULL, last_success_at = now()
     WHERE organization_id = $1 AND id = $2`,
    [ctx.orgId, ctx.connection.id, ctx.connection.mode === "live" ? "verified" : "fixture"],
  );
}

export async function attachSourceReport(
  db: Queryable,
  orgId: string,
  eventId: string,
  report: SourceReportFigures,
  comparison: ReconciliationRow[],
): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `UPDATE reconciliation_results SET source_report = $3, report_comparison = $4
     WHERE id = (SELECT id FROM reconciliation_results WHERE organization_id = $1 AND canonical_event_id = $2 ORDER BY computed_at DESC LIMIT 1)
       AND organization_id = $1
     RETURNING id`,
    [orgId, eventId, JSON.stringify(report), JSON.stringify(comparison)],
  );
  return r.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------- dashboard reads

export interface SyncRunRow {
  id: string; started_at: Date; finished_at: Date | null; status: string; error_kind: string | null; error_message: string | null;
  pages_fetched: number | null; requests_made: number | null; orders_seen: number | null; lines_seen: number | null;
  orders_inserted: number | null; orders_updated: number | null; orders_missing: number | null;
}

export interface EventSummaryRow {
  id: string; name: string; performance_start_utc: Date | null; venue_timezone: string;
  provider: string; provider_account_id: string; source_event_id: string; source_name: string | null; source_start_utc: Date | null;
  source_updated_at: Date | null; connection_id: string; connection_mode: "live" | "fixture"; connection_status: ConnectionStatus;
  connection_status_kind: string | null; connection_status_detail: string | null; last_attempt_at: Date | null; last_success_at: Date | null;
  proceeds_policy: ProceedsPolicy;
  latest_result: EventRevenue | null; latest_result_at: Date | null; latest_result_sync_id: string | null;
  source_report: SourceReportFigures | null; report_comparison: ReconciliationRow[] | null;
  latest_run: SyncRunRow | null;
}

const EVENT_SUMMARY_SQL = `
  SELECT e.id, e.name, e.performance_start_utc, e.venue_timezone,
         m.provider, m.provider_account_id, m.source_event_id, m.source_name, m.source_start_utc, m.source_updated_at,
         c.id AS connection_id, c.mode AS connection_mode, c.status AS connection_status, c.status_kind AS connection_status_kind,
         c.status_detail AS connection_status_detail, c.last_attempt_at, c.last_success_at, c.proceeds_policy,
         rr.result AS latest_result, rr.computed_at AS latest_result_at, rr.sync_run_id AS latest_result_sync_id,
         rr.source_report, rr.report_comparison,
         to_jsonb(sr) AS latest_run
  FROM canonical_events e
  JOIN source_event_mappings m ON m.canonical_event_id = e.id AND m.organization_id = e.organization_id
  JOIN source_connections c ON c.id = m.connection_id AND c.organization_id = e.organization_id
  LEFT JOIN LATERAL (
    SELECT * FROM reconciliation_results r WHERE r.organization_id = e.organization_id AND r.canonical_event_id = e.id
    ORDER BY r.computed_at DESC LIMIT 1) rr ON true
  LEFT JOIN LATERAL (
    SELECT s.id, s.started_at, s.finished_at, s.status, s.error_kind, s.error_message, s.pages_fetched, s.requests_made,
           s.orders_seen, s.lines_seen, s.orders_inserted, s.orders_updated, s.orders_missing
    FROM sync_runs s WHERE s.organization_id = e.organization_id AND s.canonical_event_id = e.id
    ORDER BY s.started_at DESC LIMIT 1) sr ON true
  WHERE e.organization_id = $1`;

export async function listEventSummaries(db: Queryable, orgId: string): Promise<EventSummaryRow[]> {
  return (await db.query<EventSummaryRow>(`${EVENT_SUMMARY_SQL} ORDER BY e.performance_start_utc NULLS LAST, e.name`, [orgId])).rows;
}

export async function getEventSummary(db: Queryable, orgId: string, eventId: string): Promise<EventSummaryRow | null> {
  return (await db.query<EventSummaryRow>(`${EVENT_SUMMARY_SQL} AND e.id = $2`, [orgId, eventId])).rows[0] ?? null;
}

export async function listSyncRuns(db: Queryable, orgId: string, eventId: string, limit = 10): Promise<SyncRunRow[]> {
  return (
    await db.query<SyncRunRow>(
      `SELECT id, started_at, finished_at, status, error_kind, error_message, pages_fetched, requests_made, orders_seen, lines_seen,
              orders_inserted, orders_updated, orders_missing
       FROM sync_runs WHERE organization_id = $1 AND canonical_event_id = $2 ORDER BY started_at DESC LIMIT $3`,
      [orgId, eventId, limit],
    )
  ).rows;
}

export async function ticketClassBreakdown(db: Queryable, orgId: string, eventId: string) {
  return (
    await db.query<{ ticket_class_name: string | null; currency: string; status: string; quantity: number; gross_minor: number | null; unknown_gross: number }>(
      `SELECT l.ticket_class_name, l.currency, l.status, sum(l.quantity)::int AS quantity,
              sum(l.gross_minor)::bigint AS gross_minor, count(*) FILTER (WHERE l.gross_minor IS NULL)::int AS unknown_gross
       FROM order_lines l
       JOIN orders o ON o.organization_id = l.organization_id AND o.provider = l.provider
                    AND o.provider_account_id = l.provider_account_id AND o.source_id = l.order_source_id
       WHERE l.organization_id = $1 AND l.canonical_event_id = $2 AND NOT l.missing_from_source
         AND o.status IN ('completed', 'refunded')
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
      [orgId, eventId],
    )
  ).rows;
}

// ---------------------------------------------------------------- targets

export interface TargetRow {
  canonical_event_id: string;
  measure: "paidTickets" | "grossAfterRefunds" | "organizerProceeds";
  target_value: number;
  currency: string | null;
  source: "manual";
  updated_at: Date;
}

export async function listTargets(db: Queryable, orgId: string): Promise<TargetRow[]> {
  return (
    await db.query<TargetRow>(
      "SELECT canonical_event_id, measure, target_value, trim(currency) AS currency, source, updated_at FROM event_targets WHERE organization_id = $1 ORDER BY measure",
      [orgId],
    )
  ).rows;
}

export async function upsertTarget(
  db: Queryable,
  orgId: string,
  eventId: string,
  t: { measure: TargetRow["measure"]; value: number; currency: string | null },
  userId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO event_targets (organization_id, canonical_event_id, measure, target_value, currency, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, canonical_event_id, measure) DO UPDATE SET
       target_value = EXCLUDED.target_value, currency = EXCLUDED.currency, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [orgId, eventId, t.measure, t.value, t.currency, userId],
  );
}

export async function deleteTarget(db: Queryable, orgId: string, eventId: string, measure: string): Promise<void> {
  await db.query("DELETE FROM event_targets WHERE organization_id = $1 AND canonical_event_id = $2 AND measure = $3", [orgId, eventId, measure]);
}

// ---------------------------------------------------------------- integrations

export interface ConnectionSummaryRow extends ConnectionRow {
  mapped_events: number;
  last_run_status: string | null;
  last_run_at: Date | null;
}

export async function listConnections(db: Queryable, orgId: string): Promise<ConnectionSummaryRow[]> {
  return (
    await db.query<ConnectionSummaryRow>(
      `SELECT c.*,
              (SELECT count(*)::int FROM source_event_mappings m WHERE m.organization_id = c.organization_id AND m.connection_id = c.id) AS mapped_events,
              sr.status AS last_run_status, sr.started_at AS last_run_at
       FROM source_connections c
       LEFT JOIN LATERAL (SELECT status, started_at FROM sync_runs s WHERE s.organization_id = c.organization_id AND s.connection_id = c.id
                          ORDER BY started_at DESC LIMIT 1) sr ON true
       WHERE c.organization_id = $1 ORDER BY c.provider, c.provider_account_id`,
      [orgId],
    )
  ).rows;
}
