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
    await db.query("TRUNCATE organizations CASCADE");
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
