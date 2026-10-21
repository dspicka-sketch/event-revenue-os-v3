import { describe, expect, it } from "vitest";
import { buildOrgPulse, buildShowCard, type ShowInput } from "../src/domain/pulse.js";
import { computeEventRevenue } from "../src/domain/revenue.js";
import { normalizeAttendee, normalizeOrder } from "../src/providers/eventbrite/normalize.js";
import { attendees, costs, order } from "./helpers/build.js";

const NOW = new Date("2026-10-20T19:00:00Z"); // Oct 20, 12:00 PDT
const TZ = "America/Los_Angeles";

function revenueWithSales(sales: { created: string; qty: number }[]) {
  const orders = [];
  const atts = [];
  for (const [i, s] of sales.entries()) {
    const lc = Array.from({ length: s.qty }, () => costs(2500, 271, 80, 0));
    orders.push(order(`o${i}`, "e1", lc, { created: s.created }));
    atts.push(...attendees(`o${i}`, "e1", lc));
  }
  return computeEventRevenue(orders.map((o) => normalizeOrder(o, "USD")), atts.map((a) => normalizeAttendee(a, "USD")), { proceedsPolicy: "unverified", asOf: NOW, timeZone: TZ });
}

function input(over: Partial<ShowInput> = {}): ShowInput {
  return {
    id: "e1", name: "Show", performanceStartUtc: "2026-10-31T03:00:00Z", venueTimezone: TZ, provider: "eventbrite", mode: "fixture",
    connectionStatus: "fixture", connectionStatusKind: null, connectionAction: null, stale: false, dataAsOf: "2026-10-20T18:00:00Z",
    revenue: revenueWithSales([{ created: "2026-10-19T20:00:00Z", qty: 7 }, { created: "2026-10-01T20:00:00Z", qty: 3 }]),
    reportComparison: null, targets: [], marketing: null, ...over,
  };
}

describe("daily sales", () => {
  it("buckets by venue-local sale date, not UTC date", () => {
    // 2026-10-20T05:00Z is Oct 19 22:00 in Los Angeles.
    const r = revenueWithSales([{ created: "2026-10-20T05:00:00Z", qty: 2 }]);
    expect(r.currencies[0]!.dailySales).toEqual([{ date: "2026-10-19", paidTickets: 2, grossAfterRefundsMinor: 2 * 2851 }]);
  });
});

describe("buildShowCard", () => {
  it("derives phase and days until in venue time", () => {
    const c = buildShowCard(input(), NOW);
    expect(c).toMatchObject({ phase: "upcoming", daysUntil: 10 });
    expect(buildShowCard(input({ performanceStartUtc: "2026-10-21T03:00:00Z" }), NOW)).toMatchObject({ phase: "today", daysUntil: 0 });
    expect(buildShowCard(input({ performanceStartUtc: "2026-10-01T03:00:00Z" }), NOW).phase).toBe("past");
  });

  it("builds a zero-filled 14-day pace window", () => {
    const c = buildShowCard(input(), NOW);
    expect(c.pace!.days).toHaveLength(14);
    expect(c.pace!.days.at(-1)!.date).toBe("2026-10-20");
    expect(c.pace!.last7DaysPaidTickets).toBe(7);
    expect(c.pace!.previous7DaysPaidTickets).toBe(0);
  });

  it("flags a show behind its ticket target using a run-rate comparison", () => {
    // 10 sold, target 100, 10 days left => needs 9/day; last 7 days averaged 1/day.
    const c = buildShowCard(input({ targets: [{ measure: "paidTickets", value: 100, currency: null, source: "manual", updatedAt: null }] }), NOW);
    expect(c.targets[0]).toMatchObject({ actual: 10, percent: 10, status: "behind", requiredPerDay: 9, recentPerDay: 1 });
    expect(c.attention.map((a) => a.code)).toContain("behind_target");
  });

  it("marks targets met and on track", () => {
    const met = buildShowCard(input({ targets: [{ measure: "paidTickets", value: 10, currency: null, source: "manual", updatedAt: null }] }), NOW);
    expect(met.targets[0]!.status).toBe("met");
    const ok = buildShowCard(input({ targets: [{ measure: "paidTickets", value: 15, currency: null, source: "manual", updatedAt: null }] }), NOW);
    expect(ok.targets[0]!.status).toBe("on_track");
  });

  it("does not judge a proceeds target when proceeds are unavailable", () => {
    const c = buildShowCard(input({ targets: [{ measure: "organizerProceeds", value: 100000, currency: "USD", source: "manual", updatedAt: null }] }), NOW);
    expect(c.targets[0]).toMatchObject({ actual: null, status: "unknown", actualStatus: "unavailable" });
    expect(c.attention.map((a) => a.code)).not.toContain("behind_target");
  });

  it("raises stale, not-configured and old-data attention items", () => {
    expect(buildShowCard(input({ stale: true, connectionStatus: "stale", connectionAction: "Wait." }), NOW).attention[0]).toMatchObject({ code: "stale", severity: "warning" });
    expect(buildShowCard(input({ revenue: null, connectionStatus: "not_configured" }), NOW).attention[0]).toMatchObject({ code: "not_configured", severity: "error" });
    expect(buildShowCard(input({ dataAsOf: "2026-10-17T18:00:00Z" }), NOW).attention.map((a) => a.code)).toContain("not_refreshed_recently");
    expect(buildShowCard(input({ revenue: null }), NOW).attention.map((a) => a.code)).toContain("never_synced");
  });
});

describe("marketing on the show card", () => {
  const base = { windowDays: 7, salesOrders: 30, paidTickets: 60, attributedOrders: 5, attributedTickets: 12, trackedShare: 20, outsideWindow: [], conflictingOrders: 0, unattributed: { orders: 25, paidTickets: 48 } };
  const driver = (code: string, t: number) => ({ code, label: code, kind: "tracking_link" as const, campaign: null, orders: 1, paidTickets: t, grossAfterRefunds: [], ticketShare: 0, ordersPer100Clicks: null });

  it("summarizes the top drivers and flags mostly untracked sales", () => {
    const c = buildShowCard(input({ marketing: { ...base, drivers: [driver("a", 6), driver("b", 4), driver("c", 1), driver("d", 1)], campaignsWithoutOrders: [] } }), NOW);
    expect(c.marketing).toMatchObject({ trackedShare: 20, driverCount: 4, unattributedTickets: 48 });
    expect(c.marketing!.topDrivers.map((d) => d.code)).toEqual(["a", "b", "c"]);
    expect(c.attention.map((a) => a.code)).toContain("untracked_sales");
  });

  it("flags a recent campaign with no linked orders, but not an old one", () => {
    const recent = { id: "c1", title: "Last call", sentAt: "2026-10-18T17:00:00Z", eventLinkClicks: 90 };
    const old = { id: "c2", title: "Announce", sentAt: "2026-09-02T17:00:00Z", eventLinkClicks: 300 };
    const c = buildShowCard(input({ marketing: { ...base, trackedShare: 80, drivers: [], campaignsWithoutOrders: [recent, old] } }), NOW);
    const items = c.attention.filter((a) => a.code === "campaign_no_orders");
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain("Last call");
    expect(items[0]!.detail).toContain("90 unique clicks");
  });
});

describe("org-level what's working", () => {
  const show = (drivers: { code: string; campaign?: string; t: number; g: number }[], paid: number) => ({
    windowDays: 7, salesOrders: 10, paidTickets: paid, attributedOrders: drivers.length, attributedTickets: drivers.reduce((a, d) => a + d.t, 0),
    trackedShare: 0, outsideWindow: [], conflictingOrders: 0, campaignsWithoutOrders: [],
    unattributed: { orders: 1, paidTickets: paid - drivers.reduce((a, d) => a + d.t, 0) },
    drivers: drivers.map((d) => ({
      code: d.code, label: d.campaign ?? d.code, kind: d.campaign ? ("campaign" as const) : ("tracking_link" as const),
      campaign: d.campaign ? { id: d.campaign, source: "mailchimp" as const, title: d.campaign, sentAt: "2026-10-13T17:00:00Z", emailsSent: 1, uniqueOpens: 1, eventLinkClicks: 1 } : null,
      orders: 1, paidTickets: d.t, grossAfterRefunds: [{ currency: "USD", minor: d.g }], ticketShare: 0, ordersPer100Clicks: null,
    })),
  });

  it("sums each source across upcoming shows only, within currency", () => {
    const p = buildOrgPulse([
      input({ id: "a", marketing: show([{ code: "ig-bio", t: 10, g: 1000 }, { code: "mc-x", campaign: "Last call", t: 5, g: 500 }], 20) }),
      input({ id: "b", performanceStartUtc: "2026-11-02T03:00:00Z", marketing: show([{ code: "ig-bio", t: 6, g: 600 }], 10) }),
      input({ id: "past", performanceStartUtc: "2026-09-01T03:00:00Z", marketing: show([{ code: "ig-bio", t: 99, g: 9900 }], 99) }),
    ], NOW);
    const m = p.marketing!;
    expect(m).toMatchObject({ showCount: 2, paidTickets: 30, attributedTickets: 21, unattributedTickets: 9, trackedShare: 70 });
    expect(m.drivers[0]).toMatchObject({ code: "ig-bio", shows: 2, paidTickets: 16, ticketShare: 53, grossAfterRefunds: [{ currency: "USD", minor: 1600 }] });
    expect(m.drivers[1]).toMatchObject({ label: "Last call", kind: "campaign", shows: 1, paidTickets: 5 });
  });

  it("is null without any marketing data", () => {
    expect(buildOrgPulse([input()], NOW).marketing).toBeNull();
  });
});

describe("buildOrgPulse", () => {
  it("orders shows soonest first and sums gross only within a currency", () => {
    const p = buildOrgPulse(
      [
        input({ id: "later", performanceStartUtc: "2026-12-01T03:00:00Z" }),
        input({ id: "past", performanceStartUtc: "2026-09-01T03:00:00Z" }),
        input({ id: "soon" }),
      ],
      NOW,
    );
    expect(p.shows.map((s) => s.id)).toEqual(["soon", "later", "past"]);
    expect(p.summary.upcomingShows).toBe(2);
    expect(p.summary.upcomingGrossByCurrency).toEqual([{ currency: "USD", minor: 2 * 10 * 2851, status: "complete" }]);
    expect(p.summary.paidTicketsLast7Days).toBe(21);
  });
});
