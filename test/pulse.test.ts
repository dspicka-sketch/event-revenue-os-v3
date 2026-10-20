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
    reportComparison: null, targets: [], ...over,
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
