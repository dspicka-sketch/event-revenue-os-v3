import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "../src/db/pool.js";
import { createUser, setMembership } from "../src/auth/accounts.js";
import { createConnection, createMappedEvent, createOrganization, lastFinishedRun, lastSucceededRun, upsertCandidates } from "../src/db/repo.js";
import { EmailError, type EmailMessage, type EmailSender } from "../src/notify/email.js";
import { EventbriteAdapter } from "../src/providers/eventbrite/adapter.js";
import { createFixtureTransport, FIXTURE_ACCOUNT_ID, pilotFixture } from "../src/providers/eventbrite/fixtures.js";
import { ProviderError } from "../src/providers/errors.js";
import { buildApp } from "../src/server/app.js";
import { autoRevOptionsFromEnv } from "../src/server/autorevEnv.js";
import type { AdapterFactory } from "../src/sync/syncEvent.js";
import { describeDb, freshDb } from "./helpers/db.js";

const NOW = new Date("2026-10-20T19:00:00Z");
const CRON = { authorization: "Bearer s3cret-cron-value" };
const PW = "correct horse battery staple";

describeDb("AutoRev scheduled jobs", () => {
  let db: Db;
  let app: FastifyInstance;
  let orgId: string;
  let emptyOrgId: string;
  let failEvent: string | null = null;
  let sendError: Error | null = null;
  let sent: EmailMessage[] = [];
  const sender: EmailSender = { send: async (m) => { if (sendError) throw sendError; sent.push(m); return { id: `em_${sent.length}` }; } };
  const adapterFactory: AdapterFactory = (c) => {
    const real = new EventbriteAdapter({ token: "t", organizationId: c.provider_account_id, fetchImpl: createFixtureTransport({ events: pilotFixture(), pageSize: 20 }).fetch, sleep: async () => {}, maxRetries: 0 });
    return {
      validate: () => real.validate(),
      fetchEventSnapshot: async (id) => { if (id === failEvent) throw new ProviderError("auth", "The access token was rejected.", 401); return real.fetchEventSnapshot(id); },
    };
  };

  beforeAll(async () => {
    db = await freshDb();
    await db.query("TRUNCATE automation_runs");
    const live = await createOrganization(db, { name: "Wax Poetic", isFixture: false });
    orgId = live.id;
    const conn = await createConnection(db, { organizationId: orgId, provider: "eventbrite", providerAccountId: FIXTURE_ACCOUNT_ID, mode: "live", secretRef: "REVOS_TEST_SECRET" });
    await createMappedEvent(db, { organizationId: orgId, connectionId: conn.id, sourceEventId: "fx-1001", name: "Night 1", startUtc: "2026-11-14T04:00:00Z" });
    emptyOrgId = (await createOrganization(db, { name: "No Admins Room", isFixture: false })).id;
    const fx = await createOrganization(db, { name: "[FIXTURE] Demo", isFixture: true });
    const a = await createUser(db, { email: "admin@example.com", password: PW });
    const v = await createUser(db, { email: "viewer@example.com", password: PW });
    const f = await createUser(db, { email: "fixture-admin@example.com", password: PW });
    await setMembership(db, orgId, a, "admin");
    await setMembership(db, orgId, v, "viewer");
    await setMembership(db, fx.id, f, "admin");
    app = await buildApp({ db, now: () => NOW, cronSecret: "s3cret-cron-value", adapterFactory, emailSender: sender });
  });
  beforeEach(() => { sent = []; failEvent = null; sendError = null; });
  afterAll(async () => { await app.close(); await db.end(); });

  it("warns in the digest that sync has never run, before any sweep", async () => {
    const r = await app.inject({ url: "/api/cron/digest", headers: CRON });
    expect(r.statusCode).toBe(200);
    expect(sent[0]!.text.split("\n")[0]).toBe("WARNING: automatic sync has never run.");
  });

  it("runs the sweep and records a succeeded run", async () => {
    const r = await app.inject({ url: "/api/cron/sync", headers: CRON });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ attempted: 1, succeeded: 1, failures: [] });
    expect(await lastSucceededRun(db, "sync_sweep")).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it("emails the organization's admins an alert naming a show that could not be refreshed", async () => {
    failEvent = "fx-1001";
    const r = await app.inject({ url: "/api/cron/sync", headers: CRON });
    expect(r.statusCode).toBe(200);
    expect(r.json().failures).toEqual([expect.objectContaining({ name: "Night 1", kind: "auth" })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["admin@example.com"]);
    expect(sent[0]!.subject).toBe("Wax Poetic: 1 show could not be refreshed");
    expect(sent[0]!.text).toContain("Night 1 (auth): The access token was rejected.");
    expect((await lastFinishedRun(db, "sync_sweep"))!.detail).toMatchObject({ attempted: 1, succeeded: 0 });
  });

  it("still answers 200 for the sweep when the alert email cannot be sent", async () => {
    failEvent = "fx-1001";
    sendError = new EmailError("The email service answered HTTP 500.", 500);
    const r = await app.inject({ url: "/api/cron/sync", headers: CRON });
    expect(r.statusCode).toBe(200);
    expect(r.json().alertsFailed).toBe(1);
  });

  it("sends the digest to live organizations' admins only and reports who was skipped", async () => {
    await upsertCandidates(db, orgId, [{ artistKey: "small act", artist: "Small Act", origin: "small_room", score: 2, reasons: ["plays rooms of 250"],
      anchorShow: { sourceEventId: "a", headliner: "Small Act", support: [], venueName: "The Chapel", city: "San Francisco", venueCapacity: 250, startsAt: "2026-12-01T04:00:00Z", genre: null, priceMin: null, status: "onsale", ticketUrl: null } }], new Date("2026-10-19T12:00:00Z"));
    const r = await app.inject({ url: "/api/cron/digest", headers: CRON });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ sent: 1, failed: [], skipped: [{ organizationId: emptyOrgId, reason: "no_admin_email" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["admin@example.com"]);
    expect(sent[0]!.subject).toMatch(/^Wax Poetic weekly digest: /);
    expect(sent[0]!.text).toContain("WARNING: the last sync could not refresh 1 show:\n  - Night 1 (auth)");
    expect(sent[0]!.text).toContain("\n  Fri, Nov 13, 2026 · in 24 days\n");
    expect(sent[0]!.text).toContain("New underplay candidates this week (1):\n  - Small Act: The Chapel");
    expect(await lastSucceededRun(db, "weekly_digest")).not.toBeNull();
  });

  it("answers 502 and records a failed run when the digest cannot be sent", async () => {
    sendError = new EmailError("The email service answered HTTP 422: The from address is not verified.", 422);
    const r = await app.inject({ url: "/api/cron/digest", headers: CRON });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ sent: 0, failed: [{ organizationId: orgId, reason: expect.stringContaining("not verified") }] });
    expect(await lastFinishedRun(db, "weekly_digest")).toMatchObject({ status: "failed" });
  });

  it("answers 503 for the digest when no email sender is configured", async () => {
    const noMail = await buildApp({ db, now: () => NOW, cronSecret: "s3cret-cron-value", adapterFactory });
    const r = await noMail.inject({ url: "/api/cron/digest", headers: CRON });
    expect([r.statusCode, r.json().error]).toEqual([503, "not_configured"]);
    await noMail.close();
  });

  it("builds options from the environment only when each pair is complete", () => {
    expect(autoRevOptionsFromEnv({})).toEqual({ cronSecret: undefined, discoveryOrgId: undefined, areaShowsSource: undefined, emailSender: undefined });
    const half = autoRevOptionsFromEnv({ CRON_SECRET: "x", RESEND_API_KEY: "k", BAYSHOWS_SUPABASE_URL: "https://bay.example.co" });
    expect(half.cronSecret).toBe("x");
    expect(half.emailSender).toBeUndefined();
    expect(half.areaShowsSource).toBeUndefined();
    const full = autoRevOptionsFromEnv({ CRON_SECRET: " x ", REVOS_DISCOVERY_ORG_ID: "org", RESEND_API_KEY: "k", REVOS_DIGEST_FROM: "a@example.com", BAYSHOWS_SUPABASE_URL: "https://bay.example.co", BAYSHOWS_SUPABASE_KEY: "pk" });
    expect(full.cronSecret).toBe("x");
    expect(full.discoveryOrgId).toBe("org");
    expect(typeof full.emailSender?.send).toBe("function");
    expect(typeof full.areaShowsSource).toBe("function");
  });
});
