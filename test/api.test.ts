import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db/pool.js";
import { createUser, setMembership } from "../src/auth/accounts.js";
import { createConnection, createMappedEvent, createOrganization } from "../src/db/repo.js";
import { buildApp } from "../src/server/app.js";
import { EventbriteAdapter } from "../src/providers/eventbrite/adapter.js";
import { createFixtureTransport, pilotFixture, type FixtureFailure } from "../src/providers/eventbrite/fixtures.js";
import type { EventDetailResponse, PulseResponse } from "../src/shared/apiTypes.js";
import { describeDb, freshDb } from "./helpers/db.js";

describeDb("HTTP API", () => {
  let db: Db;
  let app: FastifyInstance;
  let orgId: string;
  let liveOrgId: string;
  let eventId: string;
  let connId: string;
  let mcConnId: string;
  let failure: FixtureFailure | undefined;
  const PW = "correct horse battery staple";
  let admin: Record<string, string>;
  let viewer: Record<string, string>;

  async function signIn(email: string, password = PW, client = "web") {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password, client } });
  }

  beforeAll(async () => {
    db = await freshDb();
    const org = await createOrganization(db, { name: "[FIXTURE] API", isFixture: true });
    const conn = await createConnection(db, { organizationId: org.id, provider: "eventbrite", providerAccountId: "fixture-eb-org-1", mode: "fixture", secretRef: null });
    connId = conn.id;
    eventId = (await createMappedEvent(db, { organizationId: org.id, connectionId: conn.id, sourceEventId: "fx-1001", name: "Night 1", startUtc: "2026-11-14T04:00:00Z" })).canonicalEventId;
    mcConnId = (await createConnection(db, { organizationId: org.id, provider: "mailchimp", providerAccountId: "fixture-mc-1", mode: "fixture", secretRef: null })).id;
    orgId = org.id;
    const live = await createOrganization(db, { name: "Live", isFixture: false });
    const lc = await createConnection(db, { organizationId: live.id, provider: "eventbrite", providerAccountId: "1", mode: "live", secretRef: "REVOS_TEST_SECRET" });
    await createMappedEvent(db, { organizationId: live.id, connectionId: lc.id, sourceEventId: "2", name: "Live" });
    liveOrgId = live.id;
    process.env.REVOS_TEST_SECRET = "super-secret-value-should-never-leak";

    const a = await createUser(db, { email: "admin@example.com", password: PW });
    const v = await createUser(db, { email: "viewer@example.com", password: PW });
    await setMembership(db, orgId, a, "admin");
    await setMembership(db, liveOrgId, a, "admin");
    await setMembership(db, orgId, v, "viewer");

    app = await buildApp({
      db,
      refreshCooldownSeconds: 0,
      now: () => new Date("2026-10-20T19:00:00Z"),
      adapterFactory: (c) => {
        const t = createFixtureTransport({ events: pilotFixture(), failFor: () => failure });
        return new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {}, maxRetries: 0 });
      },
    });
    admin = { authorization: `Bearer ${(await signIn("admin@example.com")).json().token}` };
    viewer = { authorization: `Bearer ${(await signIn("viewer@example.com", PW, "mobile")).json().token}` };
  });
  afterAll(async () => { await app?.close(); await db?.end(); delete process.env.REVOS_TEST_SECRET; });

  it("requires a valid session", async () => {
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/me", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
  });

  it("rejects wrong passwords and unknown users identically", async () => {
    const a = await signIn("admin@example.com", "wrong password here");
    const b = await signIn("nobody@example.com", "wrong password here");
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it("lists only the caller's organizations with roles", async () => {
    const me = (await app.inject({ url: "/api/me", headers: viewer })).json();
    expect(me.organizations.map((o: { id: string; role: string }) => [o.id, o.role])).toEqual([[orgId, "viewer"]]);
  });

  it("hides organizations the caller is not a member of", async () => {
    expect((await app.inject({ url: `/api/orgs/${liveOrgId}/events`, headers: viewer })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/orgs/${liveOrgId}/pulse`, headers: viewer })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/orgs/${liveOrgId}/events/${eventId}`, headers: admin })).statusCode).toBe(404);
  });

  it("lets a viewer refresh and read the show detail with its card", async () => {
    const r = await app.inject({ method: "POST", url: `/api/orgs/${orgId}/events/${eventId}/refresh`, headers: viewer });
    expect(r.statusCode).toBe(200);
    const body = (await app.inject({ url: `/api/orgs/${orgId}/events/${eventId}`, headers: viewer })).json() as EventDetailResponse;
    expect(body.organization.is_fixture).toBe(true);
    expect(body.event.connection.mode).toBe("fixture");
    expect(body.card.tickets!.paid).toBe(body.event.revenue!.currencies[0]!.tickets.paid);
    expect(body.card.phase).toBe("upcoming");
    expect(body.syncRuns[0]!.status).toBe("succeeded");
  });

  it("refreshes marketing sources with the show and returns what's driving sales", async () => {
    const r = await app.inject({ method: "POST", url: `/api/orgs/${orgId}/events/${eventId}/refresh`, headers: viewer });
    expect(r.json().marketing).toEqual([{ provider: "mailchimp", ok: true }]);
    const d = (await app.inject({ url: `/api/orgs/${orgId}/events/${eventId}`, headers: viewer })).json() as EventDetailResponse;
    const m = d.event.marketing!;
    expect(m.drivers.find((x) => x.kind === "campaign")?.campaign?.source).toBe("mailchimp");
    expect(m.attributedTickets + m.unattributed.paidTickets).toBe(m.paidTickets);
    expect(d.card.marketing!.topDrivers.length).toBeGreaterThan(0);
    const pulse = (await app.inject({ url: `/api/orgs/${orgId}/pulse`, headers: viewer })).json() as PulseResponse;
    expect(pulse.shows[0]!.marketing!.trackedShare).toBe(d.card.marketing!.trackedShare);
    const conns = (await app.inject({ url: `/api/orgs/${orgId}/connections`, headers: admin })).json();
    expect(conns.connections.find((c: { provider: string }) => c.provider === "mailchimp").campaigns).toBe(4);
    const test = await app.inject({ method: "POST", url: `/api/orgs/${orgId}/connections/${mcConnId}/test`, headers: admin });
    expect(test.json()).toMatchObject({ ok: true });
  });

  it("lets admins name tracking links, used in place of the raw code", async () => {
    const url = `/api/orgs/${orgId}/tracking-links/ig-bio`;
    expect((await app.inject({ method: "PUT", url, headers: viewer, payload: { label: "Instagram bio link" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { label: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: `/api/orgs/${orgId}/tracking-links/bad%20code`, headers: admin, payload: { label: "x" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { label: "Instagram bio link" } })).statusCode).toBe(200);
    const d = (await app.inject({ url: `/api/orgs/${orgId}/events/${eventId}`, headers: viewer })).json() as EventDetailResponse;
    const ig = d.event.marketing!.drivers.find((x) => x.code === "ig-bio");
    expect(ig?.label).toBe("Instagram bio link");
  });

  it("lets only admins set targets, and validates them", async () => {
    const url = `/api/orgs/${orgId}/events/${eventId}/targets`;
    expect((await app.inject({ method: "PUT", url, headers: viewer, payload: { measure: "paidTickets", value: 400, currency: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { measure: "paidTickets", value: 1.5, currency: null } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { measure: "grossAfterRefunds", value: 100 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { measure: "paidTickets", value: 400, currency: null } })).statusCode).toBe(200);
    const pulse = (await app.inject({ url: `/api/orgs/${orgId}/pulse`, headers: viewer })).json() as PulseResponse;
    const t = pulse.shows[0]!.targets[0]!;
    expect(t).toMatchObject({ measure: "paidTickets", target: 400, source: "manual" });
    expect(t.actual).toBe(pulse.shows[0]!.tickets!.paid);
  });

  it("returns a pulse that matches the desktop event figures", async () => {
    const pulse = (await app.inject({ url: `/api/orgs/${orgId}/pulse`, headers: viewer })).json() as PulseResponse;
    const events = (await app.inject({ url: `/api/orgs/${orgId}/events`, headers: admin })).json();
    const desktop = events.events[0].revenue.currencies[0];
    expect(pulse.shows[0]!.revenue!.grossAfterRefunds).toEqual(desktop.measures.grossAfterRefunds);
    expect(pulse.summary.upcomingShows).toBe(1);
  });

  it("labels retained data stale with an actionable message after a failed refresh", async () => {
    failure = { status: 429 };
    const r = await app.inject({ method: "POST", url: `/api/orgs/${orgId}/events/${eventId}/refresh`, headers: admin });
    failure = undefined;
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ kind: "rate_limited" });
    expect(r.json().action).toMatch(/rate limit/i);
    const d = (await app.inject({ url: `/api/orgs/${orgId}/events/${eventId}`, headers: admin })).json() as EventDetailResponse;
    expect(d.event.freshness).toMatchObject({ hasData: true, stale: true });
    expect(d.event.connection.status).toBe("stale");
    expect(d.card.attention.map((a) => a.code)).toContain("stale");
    expect(d.event.revenue!.currencies[0]!.tickets.paid).toBeGreaterThan(0);
  });

  it("lists integrations without exposing secret values", async () => {
    const r = await app.inject({ url: `/api/orgs/${liveOrgId}/connections`, headers: admin });
    expect(r.body).not.toContain("super-secret-value-should-never-leak");
    expect(r.json().connections[0]).toMatchObject({ secretPresent: true, secretRef: "REVOS_TEST_SECRET", mode: "live" });
    expect(r.json().planned.map((p: { milestone: string }) => p.milestone)).toEqual(["M2", "M3", "M4", "M5", "M6"]);
    const ev = await app.inject({ url: `/api/orgs/${liveOrgId}/events`, headers: admin });
    expect(ev.body).not.toContain("super-secret-value-should-never-leak");
  });

  it("tests a connection (admin only) without changing its stored status", async () => {
    const url = `/api/orgs/${orgId}/connections/${connId}/test`;
    expect((await app.inject({ method: "POST", url, headers: viewer })).statusCode).toBe(403);
    const r = await app.inject({ method: "POST", url, headers: admin });
    expect(r.json()).toMatchObject({ ok: true });
    expect(r.json().message).toMatch(/not a live credential check/);
  });

  it("revokes the session on logout", async () => {
    const tok = (await signIn("viewer@example.com")).json().token;
    const h = { authorization: `Bearer ${tok}` };
    expect((await app.inject({ url: "/api/me", headers: h })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: h });
    expect((await app.inject({ url: "/api/me", headers: h })).statusCode).toBe(401);
  });

  it("throttles repeated failed sign-ins", async () => {
    for (let i = 0; i < 10; i++) await signIn("viewer@example.com", "definitely wrong pw");
    expect((await signIn("viewer@example.com")).statusCode).toBe(429);
  });

  it("allows only configured cross-origin callers", async () => {
    const cors = await buildApp({ db, corsOrigins: ["http://localhost:8081"] });
    const ok = await cors.inject({ method: "OPTIONS", url: "/api/me", headers: { origin: "http://localhost:8081", "access-control-request-method": "GET", "access-control-request-headers": "authorization" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
    const bad = await cors.inject({ method: "OPTIONS", url: "/api/me", headers: { origin: "https://evil.example.com", "access-control-request-method": "GET" } });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const none = await app.inject({ url: "/api/health", headers: { origin: "http://localhost:8081" } });
    expect(none.headers["access-control-allow-origin"]).toBeUndefined();
    await cors.close();
  });

  it("rate-limits repeated refreshes of one show with 429 and Retry-After", async () => {
    const limited = await buildApp({ db, refreshCooldownSeconds: 60, adapterFactory: (c) => {
      const t = createFixtureTransport({ events: pilotFixture() });
      return new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {} });
    } });
    const url = `/api/orgs/${orgId}/events/${eventId}/refresh`;
    await limited.inject({ method: "POST", url, headers: admin }); // succeeds, or is already cooling down
    const r = await limited.inject({ method: "POST", url, headers: admin });
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(r.json()).toMatchObject({ kind: "cooldown" });
    await limited.close();
  });

  it("sends security headers and forbids caching API data", async () => {
    const r = await app.inject({ url: "/api/me", headers: viewer });
    expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("no-store");
    const unauth = await app.inject({ url: "/api/me" });
    expect(unauth.headers["cache-control"]).toBe("no-store");
  });

  it("returns 404 for malformed IDs", async () => {
    expect((await app.inject({ url: `/api/orgs/nope/events`, headers: admin })).statusCode).toBe(404);
  });
});
