import { describe, expect, it } from "vitest";
import { computeEventRevenue } from "../src/domain/revenue.js";
import { classifyFeeComponent, normalizeAttendee, normalizeOrder, type EbCosts } from "../src/providers/eventbrite/normalize.js";
import { attendees, m, order } from "./helpers/build.js";

const ASOF = new Date("2026-10-20T00:00:00Z");

/** A ticket where the buyer pays face + facility + rebate + platform + processing + tax. */
function buyerPaysAll(face: number, facility: number, rebate: number, platform: number, processing: number, tax: number, extraFee = 0): EbCosts {
  return {
    base_price: m(face), eventbrite_fee: m(platform), payment_fee: m(processing), tax: m(tax),
    gross: m(face + facility + rebate + platform + processing + tax + extraFee),
    fee_components: [
      { name: "Facility Fee", value: facility, payer: "attendee" },
      { name: "Promoter Rebate", value: rebate, payer: "attendee" },
      { name: "eventbrite.service_fee", value: platform, payer: "attendee" },
      ...(extraFee ? [{ name: "Parking Fee", value: extraFee, payer: "attendee" }] : []),
    ],
  };
}

function run(lc: EbCosts[], orderCosts?: EbCosts) {
  const o = order("o1", "e1", lc);
  if (orderCosts) o.costs = orderCosts;
  return computeEventRevenue([normalizeOrder(o, "USD")], attendees("o1", "e1", lc).map((a) => normalizeAttendee(a, "USD")), {
    proceedsPolicy: "gross_minus_fees_and_tax", asOf: ASOF,
  }).currencies[0]!;
}

describe("buyer-paid line items (D15)", () => {
  it("itemizes face value, facility fee, rebate, platform fee, processing fee and tax", () => {
    const t = buyerPaysAll(2500, 200, 100, 271, 95, 219);
    const c = run([t, t], { ...buyerPaysAll(5000, 400, 200, 542, 190, 438) });
    expect(c.measures.ticketFaceValue.minor).toBe(5000);
    expect(c.measures.facilityFees).toMatchObject({ status: "complete", minor: 400 });
    expect(c.measures.promoterRebates).toMatchObject({ status: "complete", minor: 200 });
    expect(c.measures.platformFees.minor).toBe(542);
    expect(c.measures.paymentFees.minor).toBe(190);
    expect(c.measures.tax.minor).toBe(438);
    expect(c.measures.grossSales.minor).toBe(5000 + 400 + 200 + 542 + 190 + 438);
    // The house keeps face + facility + rebate; platform, processing and tax pass through.
    expect(c.measures.organizerProceeds).toMatchObject({ status: "complete", minor: 5600 });
    expect(c.reconciliation.find((r) => r.key === "buyer_total_vs_items")).toMatchObject({ difference: 0, explained: true });
  });

  it("flags money in the buyer total that no line item explains", () => {
    const t = buyerPaysAll(2500, 200, 100, 271, 95, 219, 500);
    const c = run([t]);
    expect(c.reconciliation.find((r) => r.key === "buyer_total_vs_items")).toMatchObject({ difference: 500, explained: false });
  });

  it("shows facility fees and rebates as unavailable, not zero, when the source does not itemize fees", () => {
    const t: EbCosts = { base_price: m(2500), eventbrite_fee: m(271), payment_fee: m(95), tax: m(219), gross: m(3085) };
    const c = run([t]);
    expect(c.measures.facilityFees).toMatchObject({ status: "unavailable", minor: null });
    expect(c.measures.promoterRebates).toMatchObject({ status: "unavailable", minor: null });
    expect(c.reconciliation.find((r) => r.key === "buyer_total_vs_items")).toBeUndefined();
  });

  it("records a known zero when fees are itemized but none is a facility fee or rebate", () => {
    const t: EbCosts = { base_price: m(2500), eventbrite_fee: m(271), payment_fee: m(95), tax: m(0), gross: m(2866), fee_components: [{ name: "eventbrite.service_fee", value: 271 }] };
    expect(run([t]).measures.facilityFees).toMatchObject({ status: "complete", minor: 0 });
  });

  it("treats a recognised fee with no amount as unknown", () => {
    const t: EbCosts = { base_price: m(2500), eventbrite_fee: m(271), payment_fee: m(95), tax: m(0), gross: m(3066), fee_components: [{ name: "Facility Fee", value: null }] };
    expect(normalizeOrder(order("o1", "e1", [t], { costs: t }), "USD").facilityFeeMinor).toBeNull();
  });

  it("recognises common fee names", () => {
    expect(classifyFeeComponent({ name: "Facility Fee" })).toBe("facility_fee");
    expect(classifyFeeComponent({ name: "Venue Fee" })).toBe("facility_fee");
    expect(classifyFeeComponent({ internal_name: "facility_maintenance_fee" })).toBe("facility_fee");
    expect(classifyFeeComponent({ name: "Promoter Rebate" })).toBe("promoter_rebate");
    expect(classifyFeeComponent({ name: "eventbrite.service_fee" })).toBeNull();
    expect(classifyFeeComponent({ name: "Parking Fee" })).toBeNull();
  });
});
