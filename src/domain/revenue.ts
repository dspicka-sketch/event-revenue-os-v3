// Event revenue computation and internal reconciliation. Pure functions: no I/O,
// no provider or UI code. Every measure carries a status so that missing data
// is shown as partial/unavailable rather than silently treated as zero.

import { MeasureSum, combine, currencyScale, unavailable, type Measure, type MinorUnits } from "./money.js";
import type { NormalizedLine, NormalizedOrder, ProceedsPolicy } from "./types.js";

export type ExceptionSeverity = "info" | "warning" | "error";

export interface RevenueException {
  code:
    | "order_without_lines"
    | "order_line_gross_mismatch"
    | "partial_refund_line_level"
    | "refunded_order_with_active_lines"
    | "unknown_order_status"
    | "unknown_line_status"
    | "line_currency_mismatch"
    | "orphan_line"
    | "missing_from_source"
    | "refund_fee_treatment_unverified"
    | "missing_transaction_time";
  severity: ExceptionSeverity;
  message: string;
  orderSourceId?: string;
  lineSourceId?: string;
}

export interface TicketCounts {
  /** Active, paid (non-zero price or unknown price) tickets in completed orders. */
  paid: number;
  /** Active zero-price tickets in completed orders. */
  comp: number;
  refunded: number;
  cancelled: number;
  unpaid: number;
  /** True when some sales orders had no line detail, so counts are a lower bound. */
  partial: boolean;
}

export interface OrderCounts {
  completed: number;
  refunded: number;
  cancelled: number;
  unpaid: number;
  other: number;
}

export interface ReconciliationRow {
  key: string;
  label: string;
  /** "money" values are minor units of the row's currency; "count" values are ticket counts. */
  unit: "money" | "count";
  left: { label: string; minor: MinorUnits | null };
  right: { label: string; minor: MinorUnits | null };
  difference: MinorUnits | null;
  explained: boolean;
  explanation: string;
}

export interface CurrencyRevenue {
  currency: string;
  scale: number;
  tickets: TicketCounts;
  orders: OrderCounts;
  measures: {
    grossSales: Measure;
    refunds: Measure;
    grossAfterRefunds: Measure;
    ticketFaceValue: Measure;
    facilityFees: Measure;
    promoterRebates: Measure;
    platformFees: Measure;
    paymentFees: Measure;
    tax: Measure;
    discounts: Measure;
    organizerProceeds: Measure;
    cashRemitted: Measure;
  };
  /**
   * Rolling 168 h by transaction time, as of the sync. Kept for API stability;
   * clients use ShowCard.pace (venue-local sale days through today) instead so
   * "last 7 days" has one meaning everywhere.
   */
  last7Days: { paidTickets: number; grossSales: Measure };
  /**
   * Net sales by transaction date in the venue timezone (current state: fully
   * refunded orders and refunded tickets are excluded). Sorted ascending.
   */
  dailySales: DailySales[];
  reconciliation: ReconciliationRow[];
}

export interface DailySales {
  /** YYYY-MM-DD in the venue timezone. */
  date: string;
  paidTickets: number;
  /** Gross buyer payments after refunds for orders placed that day; null if any amount unknown. */
  grossAfterRefundsMinor: MinorUnits | null;
}

export interface EventRevenue {
  asOf: string;
  currencies: CurrencyRevenue[];
  exceptions: RevenueException[];
}

/** Human definitions for every measure, shown in the UI next to the number. */
export const MEASURE_DEFINITIONS: Record<keyof CurrencyRevenue["measures"], { label: string; definition: string }> = {
  grossSales: {
    label: "Buyer total (gross)",
    definition:
      "Order-level total paid by buyers (source 'gross') for completed and later-refunded orders, before refunds. Counted once per order, never per ticket. Not net revenue.",
  },
  refunds: {
    label: "Refunds",
    definition:
      "Gross of fully refunded orders plus gross of individually refunded or cancelled tickets inside otherwise completed orders.",
  },
  grossAfterRefunds: {
    label: "Gross buyer payments after refunds",
    definition: "Gross buyer payments minus refunds. Still includes fees and tax; not organizer proceeds.",
  },
  ticketFaceValue: {
    label: "Ticket face value",
    definition: "Ticket price before fees and tax (source 'base_price'), before refunds. Kept by the house. Discount treatment is not yet verified.",
  },
  facilityFees: {
    label: "Facility fees",
    definition: "Venue facility fee paid by the buyer on top of the ticket price, before refunds. Kept by the house. Read from the source's itemized fees; unavailable when the source does not itemize them.",
  },
  promoterRebates: {
    label: "Promoter rebates",
    definition: "Per-ticket charge paid by the buyer and returned to the promoter, before refunds. Kept by the house. Read from the source's itemized fees; unavailable when the source does not itemize them.",
  },
  platformFees: { label: "Platform fees", definition: "Ticketing platform service fee (source 'eventbrite_fee'), paid by the buyer and passed through to the platform. Before refunds." },
  paymentFees: { label: "Processing fees", definition: "Payment processing fee (source 'payment_fee'), paid by the buyer and passed through. Before refunds." },
  tax: { label: "Tax", definition: "Tax paid by the buyer (source 'tax') and owed to the tax authority. Before refunds." },
  discounts: { label: "Discounts", definition: "Not separately reported by the connected source fields." },
  organizerProceeds: {
    label: "Organizer ticket proceeds",
    definition:
      "What the house keeps: face value + facility fees + promoter rebates, net of refunds. Equals buyer total minus the pass-through platform fee, processing fee and tax (buyer pays all fees, D15). Shown only when fee ownership is documented for the source. Before show operating expenses. Not cash received.",
  },
  cashRemitted: { label: "Cash remitted (payouts)", definition: "Payout data is not connected in this milestone." },
};

const SALES_STATUSES = new Set(["completed", "refunded"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function proceedsOf(x: { grossMinor: number | null; providerFeeMinor: number | null; paymentFeeMinor: number | null; taxMinor: number | null }): number | null {
  if (x.grossMinor === null || x.providerFeeMinor === null || x.paymentFeeMinor === null || x.taxMinor === null) return null;
  return x.grossMinor - x.providerFeeMinor - x.paymentFeeMinor - x.taxMinor;
}

export interface ComputeOptions {
  proceedsPolicy: ProceedsPolicy;
  /** Reference time for the "last 7 days" window (transaction time). */
  asOf: Date;
  /** Orders known to exist previously but absent from the latest full read. */
  missingFromSource?: string[];
  /** Venue timezone for sales-date bucketing. Default America/Los_Angeles. */
  timeZone?: string;
}

/** YYYY-MM-DD of an instant in a timezone. */
export function localDate(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function computeEventRevenue(
  orders: NormalizedOrder[],
  lines: NormalizedLine[],
  opts: ComputeOptions,
): EventRevenue {
  const exceptions: RevenueException[] = [];
  const linesByOrder = new Map<string, NormalizedLine[]>();
  const orderIds = new Set(orders.map((o) => o.sourceId));
  for (const l of lines) {
    if (!orderIds.has(l.orderSourceId)) {
      exceptions.push({ code: "orphan_line", severity: "warning", lineSourceId: l.sourceId, orderSourceId: l.orderSourceId, message: "Ticket line references an order that was not returned by the source; excluded." });
      continue;
    }
    const arr = linesByOrder.get(l.orderSourceId) ?? [];
    arr.push(l);
    linesByOrder.set(l.orderSourceId, arr);
  }
  for (const id of opts.missingFromSource ?? []) {
    exceptions.push({ code: "missing_from_source", severity: "warning", orderSourceId: id, message: "Order was present in an earlier sync but not in the latest full read; excluded from totals pending review." });
  }

  const byCurrency = new Map<string, NormalizedOrder[]>();
  for (const o of orders) {
    const key = o.currency.toUpperCase();
    const arr = byCurrency.get(key) ?? [];
    arr.push(o);
    byCurrency.set(key, arr);
  }

  const since = opts.asOf.getTime() - 7 * DAY_MS;
  const currencies: CurrencyRevenue[] = [];
  let anyRefund = false;

  for (const [currency, cOrders] of [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const tickets: TicketCounts = { paid: 0, comp: 0, refunded: 0, cancelled: 0, unpaid: 0, partial: false };
    const orderCounts: OrderCounts = { completed: 0, refunded: 0, cancelled: 0, unpaid: 0, other: 0 };
    const gross = new MeasureSum();
    const refunds = new MeasureSum();
    const face = new MeasureSum();
    const facility = new MeasureSum();
    const rebate = new MeasureSum();
    const platform = new MeasureSum();
    const payment = new MeasureSum();
    const tax = new MeasureSum();
    const proceeds = new MeasureSum();
    const last7Gross = new MeasureSum();
    let last7Paid = 0;
    const daily = new Map<string, DailySales>();
    const tz = opts.timeZone ?? "America/Los_Angeles";
    // Internal check: order-level gross vs sum of ticket-line gross for
    // completed orders that have no refunded/cancelled lines.
    let checkOrderGross: number | null = 0;
    let checkLineGross: number | null = 0;
    let checkOrders = 0;
    let checkMismatches = 0;
    // Buyer total vs its itemized parts, for orders where every part is known.
    let itemOrders = 0;
    let itemGross = 0;
    let itemParts = 0;

    for (const o of cOrders) {
      orderCounts[o.status]++;
      const ls = linesByOrder.get(o.sourceId) ?? [];
      for (const l of ls) {
        if (l.currency.toUpperCase() !== currency) {
          exceptions.push({ code: "line_currency_mismatch", severity: "error", orderSourceId: o.sourceId, lineSourceId: l.sourceId, message: `Line currency ${l.currency} differs from order currency ${currency}.` });
        }
        if (l.status === "other") {
          exceptions.push({ code: "unknown_line_status", severity: "warning", orderSourceId: o.sourceId, lineSourceId: l.sourceId, message: `Unrecognised ticket status '${l.sourceStatus}'; not counted.` });
        }
      }

      if (o.status === "other") {
        exceptions.push({ code: "unknown_order_status", severity: "warning", orderSourceId: o.sourceId, message: `Unrecognised order status '${o.sourceStatus}'; excluded from sales.` });
        continue;
      }
      if (o.status === "unpaid") {
        for (const l of ls) tickets.unpaid += l.quantity;
        continue;
      }
      if (o.status === "cancelled") {
        for (const l of ls) tickets.cancelled += l.quantity;
        continue;
      }
      if (!SALES_STATUSES.has(o.status)) continue;

      if (ls.length === 0) {
        tickets.partial = true;
        exceptions.push({ code: "order_without_lines", severity: "warning", orderSourceId: o.sourceId, message: "Sales order has no ticket lines from the source; ticket counts are incomplete." });
      }

      if (o.status === "completed") {
        const parts = [o.basePriceMinor, o.facilityFeeMinor, o.promoterRebateMinor, o.providerFeeMinor, o.paymentFeeMinor, o.taxMinor];
        if (o.grossMinor !== null && parts.every((p) => p !== null)) {
          itemOrders++;
          itemGross += o.grossMinor;
          itemParts += parts.reduce<number>((a, p) => a + p!, 0);
        }
      }

      // Order-level money: counted exactly once per order.
      gross.add(o.grossMinor);
      face.add(o.basePriceMinor);
      facility.add(o.facilityFeeMinor);
      rebate.add(o.promoterRebateMinor);
      platform.add(o.providerFeeMinor);
      payment.add(o.paymentFeeMinor);
      tax.add(o.taxMinor);

      if (o.status === "refunded") {
        anyRefund = true;
        refunds.add(o.grossMinor);
        // A fully refunded order contributes no proceeds (fee treatment on refund is flagged below).
        proceeds.add(o.grossMinor === null ? null : 0);
        for (const l of ls) {
          if (l.status === "active") {
            exceptions.push({ code: "refunded_order_with_active_lines", severity: "warning", orderSourceId: o.sourceId, lineSourceId: l.sourceId, message: "Order is refunded but this ticket is still reported active; counted as refunded. Verify against source." });
          }
          if (l.status === "cancelled") tickets.cancelled += l.quantity;
          else tickets.refunded += l.quantity;
        }
        continue;
      }

      // Completed order.
      let orderProceeds = proceedsOf(o);
      const refundedLines = ls.filter((l) => l.status === "refunded" || l.status === "cancelled");
      for (const l of ls) {
        if (l.status === "active") {
          const isComp = l.grossMinor === 0 && (l.basePriceMinor === 0 || l.basePriceMinor === null);
          if (isComp) tickets.comp += l.quantity;
          else tickets.paid += l.quantity;
        } else if (l.status === "refunded") tickets.refunded += l.quantity;
        else if (l.status === "cancelled") tickets.cancelled += l.quantity;
        else if (l.status === "unpaid") tickets.unpaid += l.quantity;
      }
      if (refundedLines.length > 0) {
        anyRefund = true;
        exceptions.push({
          code: "partial_refund_line_level",
          severity: "warning",
          orderSourceId: o.sourceId,
          message: `${refundedLines.length} ticket(s) refunded/cancelled inside a completed order. Refund amount taken from ticket-line gross, assuming order-level costs are pre-refund. Verify against the source report.`,
        });
        for (const l of refundedLines) {
          refunds.add(l.grossMinor);
          const lp = proceedsOf(l);
          orderProceeds = orderProceeds === null || lp === null ? null : orderProceeds - lp;
        }
      } else if (ls.length > 0) {
        checkOrders++;
        const lineGross = ls.reduce<number | null>((acc, l) => (acc === null || l.grossMinor === null ? null : acc + l.grossMinor), 0);
        checkOrderGross = checkOrderGross === null || o.grossMinor === null ? null : checkOrderGross + o.grossMinor;
        checkLineGross = checkLineGross === null || lineGross === null ? null : checkLineGross + lineGross;
        if (o.grossMinor !== null && lineGross !== null && o.grossMinor !== lineGross) {
          checkMismatches++;
          exceptions.push({ code: "order_line_gross_mismatch", severity: "warning", orderSourceId: o.sourceId, message: `Order gross ${o.grossMinor} differs from sum of ticket gross ${lineGross} (${currency} minor units). Order-level value used.` });
        }
      }
      proceeds.add(orderProceeds);

      if (!o.createdAt) {
        exceptions.push({ code: "missing_transaction_time", severity: "info", orderSourceId: o.sourceId, message: "Order has no transaction time from the source; it counts in totals but not in daily pace or last-7-day figures." });
      } else {
        const date = localDate(o.createdAt, tz);
        const d = daily.get(date) ?? { date, paidTickets: 0, grossAfterRefundsMinor: 0 };
        for (const l of ls) {
          if (l.status === "active" && !(l.grossMinor === 0 && (l.basePriceMinor === 0 || l.basePriceMinor === null))) d.paidTickets += l.quantity;
        }
        let net: number | null = o.grossMinor;
        for (const l of refundedLines) net = net === null || l.grossMinor === null ? null : net - l.grossMinor;
        d.grossAfterRefundsMinor = d.grossAfterRefundsMinor === null || net === null ? null : d.grossAfterRefundsMinor + net;
        daily.set(date, d);
      }

      if (o.createdAt && Date.parse(o.createdAt) >= since && Date.parse(o.createdAt) <= opts.asOf.getTime()) {
        last7Gross.add(o.grossMinor);
        for (const l of ls) {
          if (l.status === "active" && !(l.grossMinor === 0 && (l.basePriceMinor === 0 || l.basePriceMinor === null))) last7Paid += l.quantity;
        }
      }
    }

    const grossM = gross.result();
    const refundsM = refunds.result();
    const grossAfter = combine([{ sign: 1, m: grossM }, { sign: -1, m: refundsM }]);

    let organizerProceeds: Measure;
    if (opts.proceedsPolicy === "unverified") {
      organizerProceeds = unavailable("Fee and tax ownership for this source has not been verified; proceeds are not derived.");
    } else {
      organizerProceeds = proceeds.result();
      if (anyRefund && organizerProceeds.status === "complete") {
        organizerProceeds = { ...organizerProceeds, status: "partial", note: "Refunds present: fee treatment on refunds is not verified, so proceeds may be overstated or understated." };
      }
    }

    const reconciliation: ReconciliationRow[] = [];
    if (checkOrders > 0) {
      const diff = checkOrderGross !== null && checkLineGross !== null ? checkOrderGross - checkLineGross : null;
      reconciliation.push({
        key: "order_vs_line_gross",
        label: `Order-level gross vs ticket-line gross (${checkOrders} orders without refunds)`,
        unit: "money",
        left: { label: "Σ order gross", minor: checkOrderGross },
        right: { label: "Σ ticket gross", minor: checkLineGross },
        difference: diff,
        explained: diff === 0,
        explanation:
          diff === 0
            ? "Order totals equal the sum of their tickets; no order-level charge was multiplied."
            : diff === null
              ? "Some amounts missing; cannot compare."
              : `${checkMismatches} order(s) differ; see exceptions. Order-level values are used for totals.`,
      });
    }

    if (itemOrders > 0) {
      const diff = itemGross - itemParts;
      reconciliation.push({
        key: "buyer_total_vs_items",
        label: `Buyer total vs face value + facility fee + rebate + platform fee + processing fee + tax (${itemOrders} orders)`,
        unit: "money",
        left: { label: "Σ buyer total", minor: itemGross },
        right: { label: "Σ itemized", minor: itemParts },
        difference: diff,
        explained: diff === 0,
        explanation: diff === 0
          ? "Every dollar the buyer paid is accounted for by a line item."
          : "The buyer total includes an amount that is not itemized (for example an unrecognised fee). Check the source's fee names.",
      });
    }

    currencies.push({
      currency,
      scale: currencyScale(currency),
      tickets,
      orders: orderCounts,
      measures: {
        grossSales: grossM,
        refunds: refundsM,
        grossAfterRefunds: grossAfter,
        ticketFaceValue: face.result(),
        facilityFees: facility.result(),
        promoterRebates: rebate.result(),
        platformFees: platform.result(),
        paymentFees: payment.result(),
        tax: tax.result(),
        discounts: unavailable(MEASURE_DEFINITIONS.discounts.definition),
        organizerProceeds,
        cashRemitted: unavailable(MEASURE_DEFINITIONS.cashRemitted.definition),
      },
      last7Days: { paidTickets: last7Paid, grossSales: last7Gross.result() },
      dailySales: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      reconciliation,
    });
  }

  if (anyRefund && opts.proceedsPolicy !== "unverified") {
    exceptions.push({ code: "refund_fee_treatment_unverified", severity: "info", message: "Whether platform/payment fees are returned on refund is not verified for this source." });
  }

  return { asOf: opts.asOf.toISOString(), currencies, exceptions };
}

export interface SourceReportFigures {
  currency: string;
  /** Description of filters used in the source report (dates, statuses, fees). */
  filters: string;
  grossSales?: MinorUnits;
  refunds?: MinorUnits;
  grossAfterRefunds?: MinorUnits;
  platformFees?: MinorUnits;
  paymentFees?: MinorUnits;
  tax?: MinorUnits;
  paidTickets?: number;
}

/** Compare computed measures with figures copied from a source report. */
export function compareWithSourceReport(rev: CurrencyRevenue, report: SourceReportFigures): ReconciliationRow[] {
  if (rev.currency !== report.currency.toUpperCase()) throw new Error(`Currency mismatch: computed ${rev.currency}, report ${report.currency}`);
  const rows: ReconciliationRow[] = [];
  const keys = ["grossSales", "refunds", "grossAfterRefunds", "platformFees", "paymentFees", "tax"] as const;
  for (const k of keys) {
    const expected = report[k];
    if (expected === undefined) continue;
    const m = rev.measures[k];
    const diff = m.minor === null ? null : m.minor - expected;
    rows.push({
      key: `report_${k}`,
      label: `${MEASURE_DEFINITIONS[k].label} vs source report`,
      unit: "money",
      left: { label: "RevOS", minor: m.minor },
      right: { label: "Source report", minor: expected },
      difference: diff,
      explained: diff === 0,
      explanation: diff === 0 ? "Matches." : diff === null ? `RevOS value is ${m.status}.` : "Unexplained difference — investigate before relying on this measure.",
    });
  }
  if (report.paidTickets !== undefined) {
    const diff = rev.tickets.paid - report.paidTickets;
    rows.push({
      key: "report_paidTickets",
      label: "Paid tickets vs source report",
      unit: "count",
      left: { label: "RevOS", minor: rev.tickets.paid },
      right: { label: "Source report", minor: report.paidTickets },
      difference: diff,
      explained: diff === 0,
      explanation: diff === 0 ? "Matches." : "Unexplained difference — investigate.",
    });
  }
  return rows;
}
