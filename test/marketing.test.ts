import { describe, expect, it } from "vitest";
import { computeMarketing, type CampaignRef } from "../src/domain/marketing.js";
import { normalizeAttendee, normalizeOrder, type EbAttendee } from "../src/providers/eventbrite/normalize.js";
import { attendees, costs, order } from "./helpers/build.js";

const lc = (n: number) => Array.from({ length: n }, () => costs(2500, 271, 80, 0));
const TICKET = 2851;

function sale(id: string, created: string, qty: number, aff: (string | null)[] | string | null, extra: Partial<EbAttendee>[] = []) {
  const c = lc(qty);
  const codes = Array.isArray(aff) ? aff : Array(qty).fill(aff);
  return {
    order: normalizeOrder(order(id, "e1", c, { created }), "USD"),
    lines: attendees(id, "e1", c, codes.map((a, i) => ({ affiliate: a, ...(extra[i] ?? {}) }))).map((a) => normalizeAttendee(a, "USD")),
  };
}

function run(sales: ReturnType<typeof sale>[], campaigns: CampaignRef[] = []) {
  return computeMarketing(sales.map((s) => s.order), sales.flatMap((s) => s.lines), campaigns);
}

const announce: CampaignRef = {
  id: "c1", source: "mailchimp", title: "On sale now", sentAt: "2026-09-02T17:00:00Z", trackingCodes: ["mc-announce"],
  emailsSent: 5000, uniqueOpens: 2100, eventLinkClicks: 40,
};

describe("computeMarketing", () => {
  it("attributes an order once to the campaign whose link it came through, inside the window", () => {
    const m = run([sale("o1", "2026-09-04T10:00:00Z", 2, "mc-announce"), sale("o2", "2026-09-05T10:00:00Z", 1, null)], [announce]);
    expect(m.drivers).toHaveLength(1);
    expect(m.drivers[0]).toMatchObject({ kind: "campaign", label: "On sale now", orders: 1, paidTickets: 2, ticketShare: 66, ordersPer100Clicks: 2.5 });
    expect(m.drivers[0]!.grossAfterRefunds).toEqual([{ currency: "USD", minor: 2 * TICKET }]);
    expect(m.unattributed).toEqual({ orders: 1, paidTickets: 1 });
    expect(m.trackedShare).toBe(66);
  });

  it("does not attribute a campaign code used outside the 7-day window", () => {
    const m = run([sale("o1", "2026-09-20T10:00:00Z", 1, "mc-announce")], [announce]);
    expect(m.drivers).toHaveLength(0);
    expect(m.outsideWindow).toEqual([{ code: "mc-announce", title: "On sale now", orders: 1, paidTickets: 1 }]);
    expect(m.unattributed.orders).toBe(1);
    expect(m.campaignsWithoutOrders.map((c) => c.id)).toEqual(["c1"]);
  });

  it("attributes non-campaign tracking links to the link itself", () => {
    const m = run([sale("o1", "2026-09-20T10:00:00Z", 3, "ig-bio")], [announce]);
    expect(m.drivers[0]).toMatchObject({ kind: "tracking_link", code: "ig-bio", label: "ig-bio", paidTickets: 3, campaign: null, ordersPer100Clicks: null });
  });

  it("leaves orders with conflicting codes unattributed", () => {
    const m = run([sale("o1", "2026-09-04T10:00:00Z", 2, ["mc-announce", "ig-bio"])], [announce]);
    expect(m.conflictingOrders).toBe(1);
    expect(m.drivers).toHaveLength(0);
  });

  it("picks the most recent qualifying send when a code is reused", () => {
    const resend: CampaignRef = { ...announce, id: "c2", title: "On sale (resend)", sentAt: "2026-09-06T17:00:00Z" };
    const m = run([sale("o1", "2026-09-07T10:00:00Z", 1, "mc-announce")], [announce, resend]);
    expect(m.drivers[0]!.campaign!.id).toBe("c2");
  });

  it("reduces attributed revenue by refunds and ignores fully refunded or unpaid orders", () => {
    const partial = sale("o1", "2026-09-04T10:00:00Z", 2, "mc-announce", [{ refunded: true, status: "Not Attending" }]);
    const full = sale("o2", "2026-09-04T11:00:00Z", 1, "mc-announce");
    full.order.status = "refunded";
    const unpaid = sale("o3", "2026-09-04T12:00:00Z", 1, "mc-announce");
    unpaid.order.status = "unpaid";
    const m = run([partial, full, unpaid], [announce]);
    expect(m.drivers[0]).toMatchObject({ orders: 1, paidTickets: 1 });
    expect(m.drivers[0]!.grossAfterRefunds).toEqual([{ currency: "USD", minor: TICKET }]);
    expect(m.salesOrders).toBe(1);
  });

  it("does not count comp tickets as paid", () => {
    const c = [costs(0, 0, 0, 0), costs(2500, 271, 80, 0)];
    const o = normalizeOrder(order("o1", "e1", c, { created: "2026-09-04T10:00:00Z" }), "USD");
    const ls = attendees("o1", "e1", c, [{ affiliate: "ig-bio" }, { affiliate: "ig-bio" }]).map((a) => normalizeAttendee(a, "USD"));
    expect(computeMarketing([o], ls, []).drivers[0]!.paidTickets).toBe(1);
  });

  it("rejects malformed tracking codes rather than storing arbitrary text", () => {
    const s = sale("o1", "2026-09-04T10:00:00Z", 1, "<script>alert(1)</script>");
    expect(s.lines[0]!.trackingCode).toBeNull();
  });
});
