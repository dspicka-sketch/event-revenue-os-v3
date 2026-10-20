// Manual sync of one mapped event: bounded full read → persist → recompute.

import { computeEventRevenue, type EventRevenue } from "../domain/revenue.js";
import type { NormalizedSnapshot } from "../domain/types.js";
import {
  completeSyncRun, countSucceededSyncs, failSyncRun, getEventMapping, hasRunningSync, loadEventRecords, persistSnapshot, startSyncRun,
  type ConnectionRow, type UpsertCounts,
} from "../db/repo.js";
import type { Db } from "../db/pool.js";
import { ProviderError } from "../providers/errors.js";
import { EventbriteAdapter } from "../providers/eventbrite/adapter.js";
import { createFixtureTransport, pilotFixture } from "../providers/eventbrite/fixtures.js";

export interface SnapshotSource {
  fetchEventSnapshot(sourceEventId: string): Promise<NormalizedSnapshot>;
}

export type AdapterFactory = (connection: ConnectionRow, ctx: { priorSuccesses: number }) => SnapshotSource;

/** Default factory: live connections read the secret named by secret_ref from the server environment. */
export const defaultAdapterFactory: AdapterFactory = (connection, ctx) => {
  if (connection.provider !== "eventbrite") throw new ProviderError("not_configured", `No adapter for provider '${connection.provider}'.`);
  if (connection.mode === "fixture") {
    // Fixture revision advances once so a second Refresh demonstrates changed orders.
    const transport = createFixtureTransport({ events: pilotFixture(Math.min(ctx.priorSuccesses, 1)) });
    return new EventbriteAdapter({ token: "fixture-token", organizationId: connection.provider_account_id, fetchImpl: transport.fetch, sleep: async () => {} });
  }
  const token = connection.secret_ref ? process.env[connection.secret_ref] : undefined;
  if (!token) {
    throw new ProviderError("not_configured", `Server secret ${connection.secret_ref ?? "(none)"} is not set.`);
  }
  return new EventbriteAdapter({ token, organizationId: connection.provider_account_id });
};

export type SyncOutcome =
  | { ok: true; runId: string; counts: UpsertCounts; revenue: EventRevenue }
  | { ok: false; runId: string | null; kind: string; message: string };

export async function syncEvent(
  db: Db,
  orgId: string,
  canonicalEventId: string,
  factory: AdapterFactory = defaultAdapterFactory,
  now: () => Date = () => new Date(),
): Promise<SyncOutcome> {
  const found = await getEventMapping(db, orgId, canonicalEventId);
  if (!found) return { ok: false, runId: null, kind: "not_found", message: "Event not found in this organization." };
  const { mapping, connection } = found;
  if (await hasRunningSync(db, orgId, canonicalEventId)) {
    return { ok: false, runId: null, kind: "busy", message: "A sync for this event is already running." };
  }
  const priorSuccesses = await countSucceededSyncs(db, orgId, canonicalEventId);
  const runId = await startSyncRun(db, orgId, connection.id, canonicalEventId);

  let snap: NormalizedSnapshot;
  try {
    snap = await factory(connection, { priorSuccesses }).fetchEventSnapshot(mapping.source_event_id);
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : "internal";
    const message = err instanceof Error ? err.message : String(err);
    await failSyncRun(db, orgId, connection.id, runId, kind, message);
    return { ok: false, runId, kind, message };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const counts = await persistSnapshot(client, { orgId, connection, mapping, runId }, snap);
    // Recompute from what is now stored, so totals always reflect the persisted state.
    const stored = await loadEventRecords(client, orgId, canonicalEventId);
    const revenue = computeEventRevenue(stored.orders, stored.lines, {
      proceedsPolicy: connection.proceeds_policy,
      asOf: now(),
      missingFromSource: stored.missing,
    });
    await completeSyncRun(
      client,
      { orgId, connection, runId, eventId: canonicalEventId },
      { pagesFetched: snap.pagesFetched, requestsMade: snap.requestsMade, ordersSeen: snap.orders.length, linesSeen: snap.lines.length, ...counts },
      revenue,
    );
    await client.query("COMMIT");
    return { ok: true, runId, counts, revenue };
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : String(err);
    await failSyncRun(db, orgId, connection.id, runId, "internal", message);
    return { ok: false, runId, kind: "internal", message };
  } finally {
    client.release();
  }
}
