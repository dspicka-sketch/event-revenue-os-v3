import { afterAll, beforeEach, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { createConnection, createMappedEvent, createOrganization, listSyncableEvents } from "../src/db/repo.js";
import { EventbriteAdapter } from "../src/providers/eventbrite/adapter.js";
import { createFixtureTransport, FIXTURE_ACCOUNT_ID, pilotFixture } from "../src/providers/eventbrite/fixtures.js";
import { ProviderError } from "../src/providers/errors.js";
import { syncAllEvents } from "../src/sync/syncAll.js";
import type { AdapterFactory } from "../src/sync/syncEvent.js";
import { describeDb, freshDb } from "./helpers/db.js";

const NOW = new Date("2026-10-20T19:00:00Z");

describeDb("sync sweep (database)", () => {
  let db: Db;
  let failEvent: string | null;
  const factory: AdapterFactory = (c) => {
    const t = createFixtureTransport({ events: pilotFixture(), pageSize: 20 });
    const real = new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {}, maxRetries: 0 });
    return {
      validate: () => real.validate(),
      fetchEventSnapshot: async (id) => {
        if (id === failEvent) throw new ProviderError("auth", "The access token was rejected.", 401);
        return real.fetchEventSnapshot(id);
      },
    };
  };

  async function org(name: string, mode: "live" | "fixture") {
    const o = await createOrganization(db, { name, isFixture: mode === "fixture" });
    const conn = await createConnection(db, { organizationId: o.id, provider: "eventbrite", providerAccountId: FIXTURE_ACCOUNT_ID, mode, secretRef: mode === "live" ? "REVOS_TEST_SECRET" : null });
    return { orgId: o.id, connId: conn.id };
  }
  const event = (o: { orgId: string; connId: string }, sourceEventId: string, name: string, startUtc: string | null) =>
    createMappedEvent(db, { organizationId: o.orgId, connectionId: o.connId, sourceEventId, name, startUtc });

  beforeEach(async () => {
    db ??= await freshDb();
    await db.query("TRUNCATE organizations, users CASCADE");
    failEvent = null;
  });
  afterAll(async () => { await db?.end(); });

  it("sweeps live upcoming events and skips fixture organizations", async () => {
    const live = await org("Wax Poetic", "live");
    const fx = await org("[FIXTURE] Demo", "fixture");
    await event(live, "fx-1001", "Night 1", "2026-11-14T04:00:00Z");
    await event(fx, "fx-1001", "Fixture night", "2026-11-14T04:00:00Z");
    const out = await syncAllEvents(db, { now: NOW, adapterFactory: factory });
    expect(out).toMatchObject({ attempted: 1, succeeded: 1, failures: [] });
    expect(Date.parse(out.finishedAt)).toBeGreaterThanOrEqual(Date.parse(out.startedAt));
  });

  it("includes an event with no performance date", async () => {
    const live = await org("Wax Poetic", "live");
    await event(live, "fx-1001", "Undated", null);
    expect((await listSyncableEvents(db, NOW)).map((e) => [e.name, e.performanceStartUtc])).toEqual([["Undated", null]]);
    expect(await syncAllEvents(db, { now: NOW, adapterFactory: factory })).toMatchObject({ attempted: 1, succeeded: 1 });
  });

  it("keeps an event from 6 days ago and skips one that ended more than 7 days ago", async () => {
    const live = await org("Wax Poetic", "live");
    await event(live, "fx-1001", "Recent", "2026-10-14T19:00:00Z");
    await event(live, "fx-1002", "Old", "2026-10-12T19:00:00Z");
    expect((await listSyncableEvents(db, NOW)).map((e) => e.name)).toEqual(["Recent"]);
  });

  it("carries on after one show fails and names the failure", async () => {
    const live = await org("Wax Poetic", "live");
    await event(live, "fx-1001", "Night 1", "2026-11-14T04:00:00Z");
    await event(live, "fx-1002", "Night 2", "2026-11-15T04:00:00Z");
    failEvent = "fx-1001";
    const out = await syncAllEvents(db, { now: NOW, adapterFactory: factory });
    expect(out).toMatchObject({ attempted: 2, succeeded: 1 });
    expect(out.failures).toEqual([expect.objectContaining({ organizationId: live.orgId, name: "Night 1", kind: "auth", message: "The access token was rejected." })]);
  });

  it("records a thrown error as unexpected and still finishes", async () => {
    const live = await org("Wax Poetic", "live");
    await event(live, "fx-1001", "Night 1", "2026-11-14T04:00:00Z");
    const out = await syncAllEvents(db, { now: NOW, adapterFactory: () => { throw new Error("factory blew up"); } });
    expect(out).toMatchObject({ attempted: 1, succeeded: 0 });
    expect(out.failures[0]!.name).toBe("Night 1");
  });
});
