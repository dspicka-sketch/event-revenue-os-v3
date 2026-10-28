// On The Stage report import (D18). The column layout below is ASSUMED: it is a
// placeholder until a real export has been seen. Nothing here is a live claim.
import { describe, expect, it } from "vitest";
import { computeMarketing } from "../src/domain/marketing.js";
import { computeEventRevenue } from "../src/domain/revenue.js";
import { parseCsv } from "../src/providers/onthestage/csv.js";
import { importOnTheStageReport, parseReportDate, parseReportMoney, type ColumnMapping } from "../src/providers/onthestage/importReport.js";

const TZ = "America/Los_Angeles";

/** ASSUMED layout: one row per ticket, with order totals repeated per row. */
const MAPPING: ColumnMapping = {
  orderId: "Order Number", orderDate: "Order Date", performance: "Performance", status: "Status", ticketType: "Ticket Type",
  ticketPrice: "Ticket Price", platformFee: "Service Fee", processingFee: "Processing Fee", tax: "Tax", buyerTotal: "Total", promoCode: "Promo Code",
};

const HEADER = "Order Number,Order Date,Performance,Status,Ticket Type,Ticket Price,Service Fee,Processing Fee,Tax,Total,Promo Code";
const SAMPLE = [
  HEADER,
  '1001,10/18/2026 7:05 PM,"Night Owls, Fri",Completed,General Admission,25.00,2.71,0.80,0.00,28.51,FBOCT',
  '1001,10/18/2026 7:05 PM,"Night Owls, Fri",Completed,General Admission,25.00,2.71,0.80,0.00,28.51,FBOCT',
  "1002,2026-10-19 10:30,\"Night Owls, Fri\",Completed,VIP,60.00,4.50,1.20,0.00,65.70,",
  "1003,2026-10-01T17:00:00Z,\"Night Owls, Fri\",Refunded,General Admission,25.00,2.71,0.80,0.00,28.51,EMAIL1",
  "1004,10/20/2026 9:00 AM,\"Night Owls, Sat\",Completed,General Admission,25.00,2.71,0.80,0.00,28.51,",
  "1005,10/20/2026 9:10 AM,\"Night Owls, Fri\",Pending,General Admission,25.00,2.71,0.80,0.00,28.51,",
  "",
].join("\r\n");

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes, CRLF, a BOM and blank lines", () => {
    const t = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,\n');
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([{ a: "1", b: "x, y", c: 'say "hi"' }, { a: "2", b: "", c: "" }]);
  });
});

describe("report money and dates", () => {
  it("parses decimal text into integer minor units and never floats", () => {
    expect(parseReportMoney("28.51", "USD")).toBe(2851);
    expect(parseReportMoney("$1,250.5", "USD")).toBe(125050);
    expect(parseReportMoney("USD 12", "USD")).toBe(1200);
    expect(parseReportMoney("-3.00", "USD")).toBe(-300);
    expect(parseReportMoney("(3.00)", "USD")).toBe(-300);
    expect(parseReportMoney("1200", "JPY")).toBe(1200);
    expect(parseReportMoney("", "USD")).toBeNull();
    expect(parseReportMoney(undefined, "USD")).toBeNull();
    expect(parseReportMoney("n/a", "USD")).toBeUndefined();
    expect(parseReportMoney("12.345", "USD")).toBeUndefined();
    expect(parseReportMoney("12.340", "USD")).toBe(1234);
  });

  it("reads naive dates as venue wall-clock time and converts to UTC", () => {
    expect(parseReportDate("10/18/2026 7:05 PM", TZ)).toBe("2026-10-19T02:05:00.000Z"); // PDT, UTC-7
    expect(parseReportDate("2026-12-01 09:00", TZ)).toBe("2026-12-01T17:00:00.000Z"); // PST, UTC-8
    expect(parseReportDate("2026-10-01T17:00:00Z", TZ)).toBe("2026-10-01T17:00:00.000Z");
    expect(parseReportDate("12/31/2026", TZ)).toBe("2026-12-31T08:00:00.000Z"); // midnight PST
    expect(parseReportDate("", TZ)).toBeNull();
    expect(parseReportDate("yesterday", TZ)).toBeUndefined();
    expect(parseReportDate("13/40/2026", TZ)).toBeUndefined();
  });
});

describe("importOnTheStageReport", () => {
  const run = (text = SAMPLE, extra: Partial<Parameters<typeof importOnTheStageReport>[1]> = {}) =>
    importOnTheStageReport(text, { mapping: MAPPING, currency: "USD", timeZone: TZ, rowIs: "ticket", onlyPerformance: "Night Owls, Fri", ...extra });

  it("groups ticket rows into orders, counting order-level money once per order", () => {
    const r = run();
    expect(r.rowCount).toBe(6);
    expect(r.skipped).toEqual([]);
    expect(r.orders.map((o) => o.sourceId)).toEqual(["1001", "1002", "1003", "1005"]);
    const o1 = r.orders[0]!;
    // Two ticket rows of 28.51 each: the order's gross is their sum, not 28.51 twice per ticket and once per order.
    expect(o1).toMatchObject({ status: "completed", sourceEventId: "Night Owls, Fri", createdAt: "2026-10-19T02:05:00.000Z", currency: "USD", grossMinor: 5702, basePriceMinor: 5000, providerFeeMinor: 542, paymentFeeMinor: 160, taxMinor: 0 });
    expect(o1.facilityFeeMinor).toBeNull();
    expect(o1.promoterRebateMinor).toBeNull();
    expect(r.lines.filter((l) => l.orderSourceId === "1001").map((l) => [l.sourceId, l.quantity, l.grossMinor, l.trackingCode])).toEqual([["1001#1", 1, 2851, "FBOCT"], ["1001#2", 1, 2851, "FBOCT"]]);
    expect(r.orders.find((o) => o.sourceId === "1003")).toMatchObject({ status: "refunded" });
    expect(r.lines.find((l) => l.orderSourceId === "1003")).toMatchObject({ status: "refunded", trackingCode: "EMAIL1" });
    expect(r.orders.find((o) => o.sourceId === "1005")).toMatchObject({ status: "unpaid" });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("feeds the shared revenue and attribution engines unchanged", () => {
    const r = run();
    const rev = computeEventRevenue(r.orders, r.lines, { proceedsPolicy: "unverified", asOf: new Date("2026-10-20T19:00:00Z"), timeZone: TZ });
    const usd = rev.currencies.find((c) => c.currency === "USD")!;
    expect(usd.tickets.paid).toBe(3); // 1001 ×2 + 1002; the refunded and pending tickets are not paid
    expect(usd.measures.grossAfterRefunds.minor).toBe(5702 + 6570);
    expect(usd.measures.organizerProceeds.status).toBe("unavailable");
    const mk = computeMarketing(r.orders, r.lines, [], { links: { FBOCT: { label: "Facebook October", channel: "social" } } });
    expect(mk.drivers.map((d) => [d.label, d.paidTickets, d.orders])).toEqual([["Facebook October", 2, 1]]);
    expect(mk.unattributed).toEqual({ orders: 1, paidTickets: 1 });
  });

  it("treats a missing column as unknown, never zero, and says so", () => {
    const { tax: _tax, platformFee: _pf, ...noFees } = MAPPING;
    const r = run(SAMPLE, { mapping: noFees });
    expect(r.orders[0]!.taxMinor).toBeNull();
    expect(r.orders[0]!.providerFeeMinor).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/No platformFee column mapped/);
    const r2 = run(SAMPLE, { mapping: { ...MAPPING, facilityFee: "Facility Fee" } });
    expect(r2.missingColumns).toEqual(["Facility Fee"]);
    expect(r2.orders[0]!.facilityFeeMinor).toBeNull();
  });

  it("skips and reports rows it cannot read instead of guessing", () => {
    const bad = [HEADER, "2001,10/18/2026 7:05 PM,P,Completed,GA,25.00,2.71,0.80,0.00,TBD,", ",10/18/2026 7:05 PM,P,Completed,GA,25.00,2.71,0.80,0.00,28.51,", "2003,soon,P,Completed,GA,25.00,2.71,0.80,0.00,28.51,", "2004,10/18/2026 7:05 PM,P,Weird,GA,25.00,2.71,0.80,0.00,28.51,bad code!"].join("\n");
    const r = run(bad, { onlyPerformance: undefined });
    expect(r.skipped).toEqual([
      { row: 1, reason: 'unparseable amount in Total: "TBD"' },
      { row: 2, reason: "missing order id" },
      { row: 3, reason: 'unparseable order date "soon"' },
    ]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toMatchObject({ sourceId: "2004", status: "other", sourceStatus: "Weird" });
    expect(r.lines[0]!.trackingCode).toBeNull();
  });

  it("supports one row per order with a quantity column, and a fixed performance", () => {
    const text = ["Order,When,State,Qty,Paid,Code", "A1,2026-10-18 19:05,paid,3,85.53,IGBIO", "A2,2026-10-18 19:06,paid,,28.51,"].join("\n");
    const r = importOnTheStageReport(text, {
      mapping: { orderId: "Order", orderDate: "When", status: "State", quantity: "Qty", buyerTotal: "Paid", promoCode: "Code" },
      currency: "USD", timeZone: TZ, rowIs: "order", sourceEventId: "perf-77",
    });
    expect(r.orders.map((o) => [o.sourceId, o.sourceEventId, o.status, o.grossMinor, o.basePriceMinor])).toEqual([["A1", "perf-77", "completed", 8553, null], ["A2", "perf-77", "completed", 2851, null]]);
    expect(r.lines.map((l) => [l.sourceId, l.quantity, l.trackingCode])).toEqual([["A1", 3, "IGBIO"], ["A2", 1, null]]);
  });

  it("refuses to count rows as sales without a status column or an explicit assumption", () => {
    const text = ["Order,When,Paid", "A1,2026-10-18 19:05,28.51"].join("\n");
    const base = { mapping: { orderId: "Order", orderDate: "When", buyerTotal: "Paid" }, currency: "USD", timeZone: TZ, rowIs: "order" as const, sourceEventId: "p" };
    expect(() => importOnTheStageReport(text, base)).toThrow(/status column/);
    expect(importOnTheStageReport(text, { ...base, assumeStatus: "completed" }).orders[0]).toMatchObject({ status: "completed" });
    expect(() => importOnTheStageReport(text, { ...base, assumeStatus: "completed", sourceEventId: undefined })).toThrow(/performance column/);
  });

  it("flags orders whose rows carry different promo codes (they stay unattributed)", () => {
    const text = [HEADER, "3001,2026-10-18 19:05,P,Completed,GA,25.00,2.71,0.80,0.00,28.51,A", "3001,2026-10-18 19:05,P,Completed,GA,25.00,2.71,0.80,0.00,28.51,B"].join("\n");
    const r = run(text, { onlyPerformance: undefined });
    expect(r.warnings.join(" ")).toMatch(/1 order\(s\) carry more than one promo code/);
    const mk = computeMarketing(r.orders, r.lines, []);
    expect(mk.conflictingOrders).toBe(1);
    expect(mk.drivers).toEqual([]);
  });
});
