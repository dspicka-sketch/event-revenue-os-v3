import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db/pool.js";
import { createUser, setMembership } from "../src/auth/accounts.js";
import { addWatchArtists, createOrganization } from "../src/db/repo.js";
import type { AreaShow } from "../src/domain/discovery.js";
import { ProviderError } from "../src/providers/errors.js";
import { buildApp } from "../src/server/app.js";
import type { DiscoveryResponse } from "../src/shared/apiTypes.js";
import { describeDb, freshDb } from "./helpers/db.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const CRON = { authorization: "Bearer s3cret-cron-value" };
const show = (id: string, headliner: string, cap: number | null, over: Partial<AreaShow> = {}): AreaShow => ({
  sourceEventId: id, headliner, support: [], venueName: "The Chapel", city: "San Francisco", venueCapacity: cap,
  startsAt: "2026-12-01T04:00:00Z", genre: null, priceMin: null, status: "onsale", ticketUrl: null, ...over,
});

describeDb("AutoRev discovery API", () => {
  let db: Db;
  let app: FastifyInstance;
  let orgId: string;
  let otherOrgId: string;
  let admin: Record<string, string>;
  let viewer: Record<string, string>;
  let outsider: Record<string, string>;
  let shows: AreaShow[] = [];
  let sourceError: Error | null = null;
  const PW = "correct horse battery staple";

  async function token(email: string) {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PW, client: "web" } });
    return { authorization: `Bearer ${r.json().token}` };
  }

  beforeAll(async () => {
    db = await freshDb();
    orgId = (await createOrganization(db, { name: "Wax Poetic", isFixture: false })).id;
    otherOrgId = (await createOrganization(db, { name: "Other Room", isFixture: false })).id;
    await addWatchArtists(db, orgId, [{ name: "Mack Keane" }], "test");
    const a = await createUser(db, { email: "admin@example.com", password: PW });
    const v = await createUser(db, { email: "viewer@example.com", password: PW });
    const o = await createUser(db, { email: "outsider@example.com", password: PW });
    await setMembership(db, orgId, a, "admin");
    await setMembership(db, orgId, v, "viewer");
    await setMembership(db, otherOrgId, o, "admin");
    app = await buildApp({
      db, now: () => NOW, cronSecret: "s3cret-cron-value", discoveryOrgId: orgId,
      areaShowsSource: async () => { if (sourceError) throw sourceError; return shows; },
    });
    admin = await token("admin@example.com");
    viewer = await token("viewer@example.com");
    outsider = await token("outsider@example.com");
  });
  afterAll(async () => { await app.close(); await db.end(); });

  it("answers 503 on every cron route when no cron secret is configured", async () => {
    const bare = await buildApp({ db, now: () => NOW });
    for (const path of ["/api/cron/discovery", "/api/cron/sync", "/api/cron/digest"]) {
      const r = await bare.inject({ url: path, headers: CRON });
      expect([path, r.statusCode, r.json().error]).toEqual([path, 503, "not_configured"]);
    }
    await bare.close();
  });

  it("answers 401 for a missing bearer, a wrong bearer and a session token", async () => {
    for (const headers of [{}, { authorization: "Bearer wrong" }, admin]) {
      expect((await app.inject({ url: "/api/cron/discovery", headers })).statusCode).toBe(401);
    }
  });

  it("answers 503 when discovery has no organization or source", async () => {
    const half = await buildApp({ db, now: () => NOW, cronSecret: "s3cret-cron-value" });
    expect((await half.inject({ url: "/api/cron/discovery", headers: CRON })).statusCode).toBe(503);
    await half.close();
  });

  it("adds qualifying acts and reports the counts", async () => {
    shows = [show("a", "Small Act", 250), show("b", "Arena Act", 5000), show("c", "Mack Keane", 1400)];
    const r = await app.inject({ url: "/api/cron/discovery", headers: CRON });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ considered: 3, candidates: 2, added: 2, refreshed: 0 });
  });

  it("adds nothing on a second run with the same shows", async () => {
    expect((await app.inject({ url: "/api/cron/discovery", headers: CRON })).json()).toMatchObject({ added: 0, refreshed: 2 });
  });

  it("answers 502 and changes nothing when the source fails", async () => {
    sourceError = new ProviderError("server", "Bay Shows answered HTTP 500.", 500);
    const r = await app.inject({ url: "/api/cron/discovery", headers: CRON });
    sourceError = null;
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ error: "source_failed", kind: "server" });
    const run = (await db.query("SELECT status, detail FROM automation_runs WHERE job = 'discovery' ORDER BY seq DESC LIMIT 1")).rows[0];
    expect(run).toMatchObject({ status: "failed", detail: { kind: "server" } });
  });

  it("finishes the run as failed and hides database detail when candidates cannot be stored", async () => {
    shows = [show("z", "Bad\u0000Name", 250)];
    const r = await app.inject({ url: "/api/cron/discovery", headers: CRON });
    shows = [show("a", "Small Act", 250), show("b", "Arena Act", 5000), show("c", "Mack Keane", 1400)];
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "discovery_failed", message: "Discovery could not store its candidates." });
    expect((await db.query("SELECT count(*)::int AS n FROM automation_runs WHERE job = 'discovery' AND status = 'running'")).rows[0].n).toBe(0);
  });

  it("lets a viewer list candidates, watchlist first", async () => {
    const r = await app.inject({ url: `/api/orgs/${orgId}/discovery`, headers: viewer });
    expect(r.statusCode).toBe(200);
    const body = r.json() as DiscoveryResponse;
    expect(body.method).toBe("discovery v0.4");
    expect(body.candidates.map((c) => [c.artist, c.origin, c.stage, c.score])).toEqual([["Mack Keane", "watchlist", "research", 5], ["Small Act", "small_room", "research", 2]]);
    expect(body.candidates[0]).toMatchObject({ reasons: ["on your watchlist"], anchor: { venueName: "The Chapel", startsAt: "2026-12-01T04:00:00Z" }, dismissed: false });
  });

  it("refuses a stage change from a viewer and accepts one from an admin", async () => {
    const id = ((await app.inject({ url: `/api/orgs/${orgId}/discovery`, headers: viewer })).json() as DiscoveryResponse).candidates[0]!.id;
    const url = `/api/orgs/${orgId}/discovery/${id}`;
    expect((await app.inject({ method: "PUT", url, headers: viewer, payload: { stage: "initial_outreach" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { stage: "not_a_stage" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url, headers: admin, payload: { stage: "initial_outreach", notes: "emailed agent" } })).statusCode).toBe(200);
    const list = (await app.inject({ url: `/api/orgs/${orgId}/discovery?stage=initial_outreach`, headers: viewer })).json() as DiscoveryResponse;
    expect(list.candidates.map((c) => [c.artist, c.notes])).toEqual([["Mack Keane", "emailed agent"]]);
  });

  it("hides a dismissed act unless asked", async () => {
    const all = ((await app.inject({ url: `/api/orgs/${orgId}/discovery`, headers: admin })).json() as DiscoveryResponse).candidates;
    const small = all.find((c) => c.artist === "Small Act")!;
    expect((await app.inject({ method: "PUT", url: `/api/orgs/${orgId}/discovery/${small.id}`, headers: admin, payload: { dismissed: true } })).statusCode).toBe(200);
    expect(((await app.inject({ url: `/api/orgs/${orgId}/discovery`, headers: admin })).json() as DiscoveryResponse).candidates.map((c) => c.artist)).toEqual(["Mack Keane"]);
    expect(((await app.inject({ url: `/api/orgs/${orgId}/discovery?include=dismissed`, headers: admin })).json() as DiscoveryResponse).candidates).toHaveLength(2);
  });

  it("gives a non-member 404 for the list and for another organization's candidate", async () => {
    const id = ((await app.inject({ url: `/api/orgs/${orgId}/discovery`, headers: admin })).json() as DiscoveryResponse).candidates[0]!.id;
    expect((await app.inject({ url: `/api/orgs/${orgId}/discovery`, headers: outsider })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/api/orgs/${otherOrgId}/discovery/${id}`, headers: outsider, payload: { stage: "booked" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/api/orgs/${orgId}/discovery/not-a-uuid`, headers: admin, payload: { stage: "booked" } })).statusCode).toBe(404);
  });
});
