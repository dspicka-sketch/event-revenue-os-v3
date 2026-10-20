import { describe, expect, it } from "vitest";
import { computeEventRevenue } from "../src/domain/revenue.js";
import { normalizeAttendee, normalizeOrder, type EbAttendee, type EbOrder } from "../src/providers/eventbrite/normalize.js";
import { attendees, costs, order } from "./helpers/build.js";

const ASOF = new Date("2026-10-20T00:00:00Z");
function run(orders: EbOrder[], atts: EbAttendee[], policy: "unverified" | "gross_minus_fees_and_tax" = "gross_minus_fees_and_tax") {
  return computeEventRevenue(orders.map((o) => normalizeOrder(o, "USD")), atts.map((a) => normalizeAttendee(a, "USD")), { proceedsPolicy: policy, asOf: ASOF });
}

describe("computeEventRevenue", () => {
  it("counts order-level charges once for multi-line orders", () => {
    const lc = [costs(2500, 271, 80, 0), costs(2500, 271, 80, 0), costs(2500, 271, 80, 0)];
    const r = run([order("o1", "e1", lc)], attendees("o1", "e1", lc));
    const usd = r.currencies[0]!;
    expect(usd.tickets.paid).toBe(3);
    expect(usd.measures.grossSales).toMatchObject({ status: "complete", minor: 3 * 2851 });
    expect(usd.measures.platformFees.minor).toBe(3 * 271);
    expect(usd.measures.organizerProceeds).toMatchObject({ status: "complete", minor: 7500 });
    expect(usd.reconciliation[0]).toMatchObject({ difference: 0, explained: true });
  });

  it("handles a full refund: money moves to refunds, tickets to refunded", () => {
    const lc = [costs(2000, 253, 65, 0), costs(2000, 253, 65, 0)];
    const keep = [costs(2500, 271, 80, 0)];
    const r = run(
      [order("o1", "e1", lc, { status: "refunded" }), order("o2", "e1", keep)],
      [...attendees("o1", "e1", lc, [{ refunded: true, status: "Not Attending" }, { refunded: true, status: "Not Attending" }]), ...attendees("o2", "e1", keep)],
    );
    const usd = r.currencies[0]!;
    expect(usd.tickets).toMatchObject({ paid: 1, refunded: 2 });
    expect(usd.orders).toMatchObject({ completed: 1, refunded: 1 });
    expect(usd.measures.refunds.minor).toBe(2 * 2318);
    expect(usd.measures.grossAfterRefunds.minor).toBe(2851);
    // Refunds present: proceeds flagged partial because fee treatment on refund is unverified.
    expect(usd.measures.organizerProceeds).toMatchObject({ status: "partial", minor: 2500 });
  });

  it("handles a partial (line-level) refund and flags the ambiguity", () => {
    const lc = [costs(2500, 271, 80, 0), costs(2500, 271, 80, 0)];
    const r = run([order("o1", "e1", lc)], attendees("o1", "e1", lc, [{ refunded: true, status: "Not Attending" }]));
    const usd = r.currencies[0]!;
    expect(usd.tickets).toMatchObject({ paid: 1, refunded: 1 });
    expect(usd.measures.refunds.minor).toBe(2851);
    expect(usd.measures.grossAfterRefunds.minor).toBe(2851);
    expect(r.exceptions.map((e) => e.code)).toContain("partial_refund_line_level");
  });

  it("flags a refunded order whose tickets are still active", () => {
    const lc = [costs(2500, 271, 80, 0)];
    const r = run([order("o1", "e1", lc, { status: "refunded" })], attendees("o1", "e1", lc));
    expect(r.exceptions.map((e) => e.code)).toContain("refunded_order_with_active_lines");
    expect(r.currencies[0]!.tickets.refunded).toBe(1);
  });

  it("excludes unpaid and cancelled orders from sales", () => {
    const lc = [costs(2500, 271, 80, 0)];
    const r = run(
      [order("o1", "e1", lc, { status: "unpaid" }), order("o2", "e1", lc, { status: "deleted" }), order("o3", "e1", lc)],
      [...attendees("o1", "e1", lc, [{ status: "Unpaid" }]), ...attendees("o2", "e1", lc), ...attendees("o3", "e1", lc)],
    );
    const usd = r.currencies[0]!;
    expect(usd.tickets).toMatchObject({ paid: 1, unpaid: 1, cancelled: 1 });
    expect(usd.measures.grossSales.minor).toBe(2851);
  });

  it("counts comps separately from paid tickets", () => {
    const lc = [costs(0, 0, 0, 0), costs(2500, 271, 80, 0)];
    const r = run([order("o1", "e1", lc)], attendees("o1", "e1", lc));
    expect(r.currencies[0]!.tickets).toMatchObject({ paid: 1, comp: 1 });
  });

  it("marks missing fees as unknown and never invents proceeds", () => {
    const o = order("o1", "e1", [costs(2500, 271, 80, 0)]);
    delete o.costs!.eventbrite_fee;
    const a = attendees("o1", "e1", [costs(2500, 271, 80, 0)]);
    const usd = run([o], a).currencies[0]!;
    expect(usd.measures.platformFees.status).toBe("unavailable");
    expect(usd.measures.organizerProceeds.status).toBe("unavailable");
    expect(usd.measures.grossSales.status).toBe("complete");
    expect(usd.measures.cashRemitted.status).toBe("unavailable");
    expect(usd.measures.discounts.status).toBe("unavailable");
  });

  it("does not derive proceeds while fee ownership is unverified", () => {
    const lc = [costs(2500, 271, 80, 0)];
    const usd = run([order("o1", "e1", lc)], attendees("o1", "e1", lc), "unverified").currencies[0]!;
    expect(usd.measures.organizerProceeds).toMatchObject({ status: "unavailable", minor: null });
  });

  it("never adds different currencies together", () => {
    const usd = [costs(2500, 271, 80, 0, "USD")];
    const cad = [costs(3000, 300, 90, 0, "CAD")];
    const r = computeEventRevenue(
      [normalizeOrder(order("o1", "e1", usd), "USD"), normalizeOrder(order("o2", "e1", cad), "CAD")],
      [...attendees("o1", "e1", usd), ...attendees("o2", "e1", cad)].map((a) => normalizeAttendee(a, null)),
      { proceedsPolicy: "gross_minus_fees_and_tax", asOf: ASOF },
    );
    expect(r.currencies.map((c) => c.currency)).toEqual(["CAD", "USD"]);
    expect(r.currencies.find((c) => c.currency === "USD")!.measures.grossSales.minor).toBe(2851);
    expect(r.currencies.find((c) => c.currency === "CAD")!.measures.grossSales.minor).toBe(3390);
  });

  it("flags orders without ticket lines and makes counts partial", () => {
    const r = run([order("o1", "e1", [costs(2500, 271, 80, 0)])], []);
    expect(r.currencies[0]!.tickets.partial).toBe(true);
    expect(r.exceptions.map((e) => e.code)).toContain("order_without_lines");
  });

  it("flags order/line gross mismatch but uses the order-level value", () => {
    const lc = [costs(2500, 271, 80, 0)];
    const o = order("o1", "e1", lc);
    o.costs!.gross = { currency: "USD", value: 3000 };
    const r = run([o], attendees("o1", "e1", lc));
    expect(r.currencies[0]!.measures.grossSales.minor).toBe(3000);
    expect(r.currencies[0]!.reconciliation[0]).toMatchObject({ difference: 149, explained: false });
  });

  it("computes the last-7-days window by transaction time", () => {
    const lc = [costs(2500, 271, 80, 0)];
    const r = run(
      [order("old", "e1", lc, { created: "2026-09-01T00:00:00Z" }), order("new", "e1", lc, { created: "2026-10-18T00:00:00Z" })],
      [...attendees("old", "e1", lc), ...attendees("new", "e1", lc)],
    );
    expect(r.currencies[0]!.last7Days).toMatchObject({ paidTickets: 1, grossSales: { minor: 2851 } });
  });
});
