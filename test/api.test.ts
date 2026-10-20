import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db/pool.js";
import { createConnection, createMappedEvent, createOrganization } from "../src/db/repo.js";
import { buildApp } from "../src/server/app.js";
import { EventbriteAdapter } from "../src/providers/eventbrite/adapter.js";
import { createFixtureTransport, pilotFixture, type FixtureFailure } from "../src/providers/eventbrite/fixtures.js";
import { describeDb, freshDb } from "./helpers/db.js";

describeDb("HTTP API", () => {
  let db: Db;
  let app: FastifyInstance;
  let orgId: string;
  let liveOrgId: string;
  let eventId: string;
  let liveEventId: string;
  const auth = { authorization: "Bearer test-access-token" };
  let failure: FixtureFailure | undefined;

  beforeAll(async () => {
    db = await freshDb();
    const org = await createOrganization(db, { name: "[FIXTURE] API", isFixture: true });
    const conn = await createConnection(db, { organizationId: org.id, provider: "eventbrite", providerAccountId: "fixture-eb-org-1", mode: "fixture", secretRef: null });
    eventId = (await createMappedEvent(db, { organizationId: org.id, connectionId: conn.id, sourceEventId: "fx-1001", name: "Night 1" })).canonicalEventId;
    orgId = org.id;
    const live = await createOrganization(db, { name: "Live", isFixture: false });
    const lc = await createConnection(db, { organizationId: live.id, provider: "eventbrite", providerAccountId: "1", mode: "live", secretRef: "REVOS_TEST_SECRET" });
    liveEventId = (await createMappedEvent(db, { organizationId: live.id, connectionId: lc.id, sourceEventId: "2", name: "Live" })).canonicalEventId;
    liveOrgId = live.id;
    process.env.REVOS_TEST_SECRET = "super-secret-value-should-never-leak";
    app = await buildApp({
      db,
      accessToken: "test-access-token",
      adapterFactory: (c) => {
        const t = createFixtureTransport({ events: pilotFixture(), failFor: () => failure });
        return new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {}, maxRetries: 0 });
      },
    });
  });
  afterAll(async () => { await app?.close(); await db?.end(); delete process.env.REVOS_TEST_SECRET; });

  it("requires the access token", async () => {
    expect((await app.inject({ url: "/api/orgs" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/orgs", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
  });

  it("refreshes a fixture event and returns the detail", async () => {
    const r = await app.inject({ method: "POST", url: `/api/orgs/${orgId}/events/${eventId}/refresh`, headers: auth });
    expect(r.statusCode).toBe(200);
    const d = await app.inject({ url: `/api/orgs/${orgId}/events/${eventId}`, headers: auth });
    const body = d.json();
    expect(body.organization.is_fixture).toBe(true);
    expect(body.event.connection.mode).toBe("fixture");
    expect(body.event.revenue.currencies[0].tickets.paid).toBeGreaterThan(0);
    expect(body.syncRuns[0].status).toBe("succeeded");
  });

  it("labels retained data stale with an actionable message after a failed refresh", async () => {
    failure = { status: 429 };
    const r = await app.inject({ method: "POST", url: `/api/orgs/${orgId}/events/${eventId}/refresh`, headers: auth });
    failure = undefined;
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ kind: "rate_limited" });
    expect(r.json().action).toMatch(/rate limit/i);
    const e = (await app.inject({ url: `/api/orgs/${orgId}/events/${eventId}`, headers: auth })).json().event;
    expect(e.freshness).toMatchObject({ hasData: true, stale: true });
    expect(e.connection.status).toBe("stale");
    expect(e.revenue.currencies[0].tickets.paid).toBeGreaterThan(0);
  });

  it("scopes event reads to the organization in the path", async () => {
    expect((await app.inject({ url: `/api/orgs/${liveOrgId}/events/${eventId}`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/orgs/${liveOrgId}/events/${eventId}/refresh`, headers: auth })).statusCode).toBe(404);
  });

  it("never returns provider secrets", async () => {
    // The secret is set in the server environment; it must never appear in API output.
    const r = await app.inject({ url: `/api/orgs/${liveOrgId}/events`, headers: auth });
    expect(r.body).not.toContain("super-secret-value-should-never-leak");
    expect(r.json().events[0].connection.status).toBe("not_configured");
  });

  it("returns 404 for malformed IDs", async () => {
    expect((await app.inject({ url: `/api/orgs/nope/events`, headers: auth })).statusCode).toBe(404);
  });
});
