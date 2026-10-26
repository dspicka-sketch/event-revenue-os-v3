import { afterAll, beforeEach, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { createConnection, createMappedEvent, createOrganization, getEventSummary, loadEventRecords } from "../src/db/repo.js";
import { EventbriteAdapter } from "../src/providers/eventbrite/adapter.js";
import { createFixtureTransport, FIXTURE_ACCOUNT_ID, pilotFixture, type FixtureEventData, type FixtureFailure } from "../src/providers/eventbrite/fixtures.js";
import { syncEvent, type AdapterFactory } from "../src/sync/syncEvent.js";
import { attendees, costs, order } from "./helpers/build.js";
import { describeDb, freshDb } from "./helpers/db.js";

describeDb("sync (database)", () => {
  let db: Db;
  let data: FixtureEventData[];
  let failure: FixtureFailure | undefined;
  const factory: AdapterFactory = (c) => {
    const t = createFixtureTransport({ events: data, pageSize: 20, failFor: () => failure });
    return new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {}, maxRetries: 1 });
  };

  async function setup(accountId = FIXTURE_ACCOUNT_ID, name = "[FIXTURE] Test") {
    const org = await createOrganization(db, { name, isFixture: true });
    const conn = await createConnection(db, { organizationId: org.id, provider: "eventbrite", providerAccountId: accountId, mode: "fixture", secretRef: null, proceedsPolicy: "gross_minus_fees_and_tax" });
    const e1 = await createMappedEvent(db, { organizationId: org.id, connectionId: conn.id, sourceEventId: "fx-1001", name: "Night 1" });
    const e2 = await createMappedEvent(db, { organizationId: org.id, connectionId: conn.id, sourceEventId: "fx-1002", name: "Night 2" });
    return { org, conn, e1: e1.canonicalEventId, e2: e2.canonicalEventId };
  }

  const count = async (table: string) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

  beforeEach(async () => {
    db ??= await freshDb();
    await db.query("TRUNCATE organizations, users CASCADE");
    data = pilotFixture();
    failure = undefined;
  });
  afterAll(async () => { await db?.end(); });

  it("syncing the same source twice creates no duplicate orders, lines or money", async () => {
    const { org, e1 } = await setup();
    const a = await syncEvent(db, org.id, e1, factory);
    const ordersAfter1 = await count("orders");
    const linesAfter1 = await count("order_lines");
    const b = await syncEvent(db, org.id, e1, factory);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await count("orders")).toBe(ordersAfter1);
    expect(await count("order_lines")).toBe(linesAfter1);
    expect(ordersAfter1).toBe(data[0]!.orders.length);
    expect(b.counts).toMatchObject({ inserted: 0, updated: ordersAfter1, missing: 0 });
    expect(b.revenue.currencies[0]!.measures.grossSales).toEqual(a.revenue.currencies[0]!.measures.grossSales);
  });

  it("updates changed orders in place (refunds after the first sync)", async () => {
    const { org, e1 } = await setup();
    const a = await syncEvent(db, org.id, e1, factory);
    data = pilotFixture(1); // one full refund, one partial refund, one new order
    const b = await syncEvent(db, org.id, e1, factory);
    if (!a.ok || !b.ok) throw new Error("sync failed");
    expect(b.counts.inserted).toBe(1);
    const ua = a.revenue.currencies[0]!;
    const ub = b.revenue.currencies[0]!;
    expect(ua.measures.refunds.minor).toBe(0);
    expect(ub.measures.refunds.minor).toBeGreaterThan(0);
    expect(ub.tickets.refunded).toBeGreaterThan(0);
    expect(ub.orders.refunded).toBe(1);
    expect(b.revenue.exceptions.filter((e) => e.code === "partial_refund_line_level")).toHaveLength(1);
  });

  it("flags orders that disappear from a later full read instead of counting them", async () => {
    const { org, e1 } = await setup();
    await syncEvent(db, org.id, e1, factory);
    const removed = data[0]!.orders.shift()!;
    data[0]!.attendees = data[0]!.attendees.filter((a) => a.order_id !== removed.id);
    const b = await syncEvent(db, org.id, e1, factory);
    if (!b.ok) throw new Error("sync failed");
    expect(b.counts.missing).toBe(1);
    expect(b.revenue.exceptions.find((e) => e.code === "missing_from_source")?.orderSourceId).toBe(removed.id);
    const stored = await loadEventRecords(db, org.id, e1);
    expect(stored.orders.find((o) => o.sourceId === removed.id)).toBeUndefined();
  });

  it("retains last good totals after a failed sync and marks them stale", async () => {
    const { org, e1 } = await setup();
    const ok = await syncEvent(db, org.id, e1, factory);
    failure = { status: 503 };
    const bad = await syncEvent(db, org.id, e1, factory);
    expect(bad).toMatchObject({ ok: false, kind: "server" });
    const s = await getEventSummary(db, org.id, e1);
    expect(s!.connection_status).toBe("stale");
    expect(s!.latest_run!.status).toBe("failed");
    if (!ok.ok) throw new Error();
    expect(s!.latest_result!.currencies[0]!.measures.grossSales).toEqual(ok.revenue.currencies[0]!.measures.grossSales);
    expect(s!.last_success_at).not.toBeNull();
  });

  it("reports a specific error state when the first sync fails with 401", async () => {
    const { org, e1 } = await setup();
    failure = { status: 401, body: { error: "INVALID_AUTH" } };
    const out = await syncEvent(db, org.id, e1, factory);
    expect(out).toMatchObject({ ok: false, kind: "auth" });
    const s = await getEventSummary(db, org.id, e1);
    expect(s!.connection_status).toBe("error");
    expect(s!.connection_status_kind).toBe("auth");
    expect(s!.latest_result).toBeNull();
  });

  it("never marks a fixture connection as verified", async () => {
    const { org, e1 } = await setup();
    await syncEvent(db, org.id, e1, factory);
    expect((await getEventSummary(db, org.id, e1))!.connection_status).toBe("fixture");
    await expect(db.query("UPDATE source_connections SET status = 'verified'")).rejects.toThrow();
  });

  it("keeps multiple performances of the same show separate", async () => {
    const { org, e1, e2 } = await setup();
    const a = await syncEvent(db, org.id, e1, factory);
    const b = await syncEvent(db, org.id, e2, factory);
    if (!a.ok || !b.ok) throw new Error();
    const r1 = await loadEventRecords(db, org.id, e1);
    const r2 = await loadEventRecords(db, org.id, e2);
    expect(r1.orders.every((o) => o.sourceEventId === "fx-1001")).toBe(true);
    expect(r2.orders.every((o) => o.sourceEventId === "fx-1002")).toBe(true);
    expect(r1.orders.length).toBe(data[0]!.orders.length);
    expect(r2.orders.length).toBe(data[1]!.orders.length);
  });

  it("keeps identical source IDs in different organizations apart", async () => {
    const x = await setup(FIXTURE_ACCOUNT_ID, "[FIXTURE] A");
    const y = await setup(FIXTURE_ACCOUNT_ID, "[FIXTURE] B");
    await syncEvent(db, x.org.id, x.e1, factory);
    await syncEvent(db, y.org.id, y.e1, factory);
    expect(await count("orders")).toBe(2 * data[0]!.orders.length);
    // Organization scoping: org A cannot read org B's event.
    expect(await getEventSummary(db, x.org.id, y.e1)).toBeNull();
    expect((await loadEventRecords(db, x.org.id, y.e1)).orders).toHaveLength(0);
    expect(await syncEvent(db, x.org.id, y.e1, factory)).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("keeps two accounts in one organization apart even when source IDs collide", async () => {
    const org = await createOrganization(db, { name: "[FIXTURE] Two accounts", isFixture: true });
    const ids: string[] = [];
    for (const acct of ["acct-A", "acct-B"]) {
      const conn = await createConnection(db, { organizationId: org.id, provider: "eventbrite", providerAccountId: acct, mode: "fixture", secretRef: null });
      ids.push((await createMappedEvent(db, { organizationId: org.id, connectionId: conn.id, sourceEventId: "fx-1001", name: acct })).canonicalEventId);
    }
    // Same event and order IDs served under each account's organization_id.
    const perAccount: AdapterFactory = (c) => {
      const events = pilotFixture();
      events[0]!.event.organization_id = c.provider_account_id;
      const t = createFixtureTransport({ events });
      return new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {} });
    };
    for (const id of ids) expect(await syncEvent(db, org.id, id, perAccount)).toMatchObject({ ok: true });
    const n = data[0]!.orders.length;
    expect(await count("orders")).toBe(2 * n);
    for (const id of ids) expect((await loadEventRecords(db, org.id, id)).orders).toHaveLength(n);
  });

  it("refuses to mix fixture and live connections in one organization", async () => {
    const live = await createOrganization(db, { name: "Live", isFixture: false });
    await expect(createConnection(db, { organizationId: live.id, provider: "eventbrite", providerAccountId: "x", mode: "fixture", secretRef: null })).rejects.toThrow();
  });

  it("reports not_configured for a live connection without its secret", async () => {
    const org = await createOrganization(db, { name: "Live", isFixture: false });
    const conn = await createConnection(db, { organizationId: org.id, provider: "eventbrite", providerAccountId: "123", mode: "live", secretRef: "REVOS_TEST_UNSET_SECRET" });
    const { canonicalEventId } = await createMappedEvent(db, { organizationId: org.id, connectionId: conn.id, sourceEventId: "999", name: "Live" });
    const out = await syncEvent(db, org.id, canonicalEventId);
    expect(out).toMatchObject({ ok: false, kind: "not_configured" });
    expect((await getEventSummary(db, org.id, canonicalEventId))!.connection_status).toBe("not_configured");
  });

  it("lets only one of two concurrent syncs of the same event run", async () => {
    const { org, e1 } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: AdapterFactory = (c, ctx) => {
      const inner = factory(c, ctx);
      return { validate: () => inner.validate(), fetchEventSnapshot: async (id) => { await gate; return inner.fetchEventSnapshot(id); } };
    };
    const first = syncEvent(db, org.id, e1, slow);
    await new Promise((r) => setTimeout(r, 100)); // first has claimed the run and is waiting on the vendor
    const second = await syncEvent(db, org.id, e1, slow);
    release();
    expect(second).toMatchObject({ ok: false, kind: "busy" });
    expect(await first).toMatchObject({ ok: true });
    const runs = await db.query("SELECT status FROM sync_runs WHERE canonical_event_id = $1", [e1]);
    expect(runs.rows.map((r) => r.status)).toEqual(["succeeded"]);
  });

  it("recovers a run abandoned by a crash and lets the next sync proceed", async () => {
    const { org, conn, e1 } = await setup();
    await db.query(
      "INSERT INTO sync_runs (organization_id, connection_id, canonical_event_id, status, started_at) VALUES ($1, $2, $3, 'running', now() - interval '11 minutes')",
      [org.id, conn.id, e1],
    );
    expect(await syncEvent(db, org.id, e1, factory)).toMatchObject({ ok: true });
    const runs = await db.query("SELECT status, error_kind FROM sync_runs WHERE canonical_event_id = $1 ORDER BY started_at", [e1]);
    expect(runs.rows).toEqual([{ status: "failed", error_kind: "abandoned" }, { status: "succeeded", error_kind: null }]);
  });

  it("enforces a cooldown between refreshes of one event", async () => {
    const { org, e1, e2 } = await setup();
    expect(await syncEvent(db, org.id, e1, factory, undefined, 60)).toMatchObject({ ok: true });
    const again = await syncEvent(db, org.id, e1, factory, undefined, 60);
    expect(again).toMatchObject({ ok: false, kind: "cooldown" });
    expect((again as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(50);
    // Other events are unaffected.
    expect(await syncEvent(db, org.id, e2, factory, undefined, 60)).toMatchObject({ ok: true });
  });

  it("persists multi-currency events without merging currencies", async () => {
    const { org, e1 } = await setup();
    const usd = [costs(2500, 271, 80, 0)];
    const cad = [costs(3000, 300, 90, 0, "CAD")];
    data[0]!.orders = [order("u1", "fx-1001", usd), order("c1", "fx-1001", cad)];
    data[0]!.attendees = [...attendees("u1", "fx-1001", usd), ...attendees("c1", "fx-1001", cad)];
    const out = await syncEvent(db, org.id, e1, factory);
    if (!out.ok) throw new Error(out.message);
    expect(out.revenue.currencies.map((c) => [c.currency, c.measures.grossSales.minor])).toEqual([["CAD", 3390], ["USD", 2851]]);
  });
});
