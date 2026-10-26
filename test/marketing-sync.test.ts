import { afterAll, beforeEach, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { campaignRefsForEvent, createConnection, createMappedEvent, createOrganization, getConnection, loadEventRecords } from "../src/db/repo.js";
import { computeMarketing } from "../src/domain/marketing.js";
import { FIXTURE_ACCOUNT_ID } from "../src/providers/eventbrite/fixtures.js";
import { MailchimpAdapter } from "../src/providers/mailchimp/adapter.js";
import { createMailchimpFixtureTransport, FIXTURE_MC_ACCOUNT_ID } from "../src/providers/mailchimp/fixtures.js";
import { syncEvent } from "../src/sync/syncEvent.js";
import { syncMarketingConnection, type MarketingAdapterFactory } from "../src/sync/syncMarketing.js";
import { describeDb, freshDb } from "./helpers/db.js";

describeDb("marketing sync (database)", () => {
  let db: Db;
  let fail: number | undefined;
  const factory: MarketingAdapterFactory = (c) => {
    const t = createMailchimpFixtureTransport(undefined, { failFor: () => (fail ? { status: fail } : undefined) });
    return new MailchimpAdapter({ apiKey: "k-us1", baseUrl: "https://us1.api.mailchimp.com/3.0/", accountId: c.provider_account_id, fetchImpl: t.fetch, sleep: async () => {}, maxRetries: 0 }, () => new Date("2026-10-20T19:00:00Z"));
  };

  async function setup() {
    const org = await createOrganization(db, { name: "[FIXTURE] Marketing", isFixture: true });
    const eb = await createConnection(db, { organizationId: org.id, provider: "eventbrite", providerAccountId: FIXTURE_ACCOUNT_ID, mode: "fixture", secretRef: null });
    const mc = await createConnection(db, { organizationId: org.id, provider: "mailchimp", providerAccountId: FIXTURE_MC_ACCOUNT_ID, mode: "fixture", secretRef: null });
    const { canonicalEventId } = await createMappedEvent(db, { organizationId: org.id, connectionId: eb.id, sourceEventId: "fx-1001", name: "Night 1" });
    return { org, mc, eventId: canonicalEventId };
  }

  beforeEach(async () => {
    db ??= await freshDb();
    await db.query("TRUNCATE organizations, users CASCADE");
    fail = undefined;
  });
  afterAll(async () => { await db?.end(); });

  it("stores campaigns once and links them to the right show", async () => {
    const { org, mc } = await setup();
    expect(await syncMarketingConnection(db, org.id, mc.id, factory)).toMatchObject({ ok: true, campaigns: 4 });
    expect(await syncMarketingConnection(db, org.id, mc.id, factory)).toMatchObject({ ok: true });
    expect((await db.query("SELECT count(*)::int AS n FROM marketing_campaigns")).rows[0].n).toBe(4);
    const refs = await campaignRefsForEvent(db, org.id, "eventbrite", "fx-1001");
    expect(refs.map((r) => [r.title, r.trackingCodes, r.eventLinkClicks])).toEqual([
      ["On sale now: The Night Owls", ["mc-announce"], 310],
      ["Support acts announced", ["mc-lineup"], 190],
      ["Last call: limited tickets left", ["mc-lastcall"], 260],
    ]);
    expect((await getConnection(db, org.id, mc.id))!.status).toBe("fixture");
  });

  it("joins stored tickets and campaigns into a marketing summary", async () => {
    const { org, mc, eventId } = await setup();
    await syncEvent(db, org.id, eventId);
    await syncMarketingConnection(db, org.id, mc.id, factory);
    const rec = await loadEventRecords(db, org.id, eventId);
    const m = computeMarketing(rec.orders, rec.lines, await campaignRefsForEvent(db, org.id, "eventbrite", "fx-1001"));
    expect(m.drivers.length).toBeGreaterThan(3);
    expect(m.drivers.some((d) => d.kind === "campaign")).toBe(true);
    expect(m.drivers.some((d) => d.code === "ig-bio")).toBe(true);
    expect(m.attributedTickets + m.unattributed.paidTickets).toBe(m.paidTickets);
    expect(m.trackedShare).toBeGreaterThan(0);
    expect(m.trackedShare).toBeLessThan(100);
  });

  it("keeps last good campaigns and marks the connection stale on failure", async () => {
    const { org, mc } = await setup();
    await syncMarketingConnection(db, org.id, mc.id, factory);
    fail = 503;
    expect(await syncMarketingConnection(db, org.id, mc.id, factory)).toMatchObject({ ok: false, kind: "server" });
    expect((await getConnection(db, org.id, mc.id))!.status).toBe("stale");
    expect((await campaignRefsForEvent(db, org.id, "eventbrite", "fx-1001")).length).toBe(3);
  });

  it("enforces one running sync and a cooldown per connection", async () => {
    const { org, mc } = await setup();
    expect(await syncMarketingConnection(db, org.id, mc.id, factory, 60)).toMatchObject({ ok: true });
    expect(await syncMarketingConnection(db, org.id, mc.id, factory, 60)).toMatchObject({ ok: false, kind: "cooldown" });
  });
});
