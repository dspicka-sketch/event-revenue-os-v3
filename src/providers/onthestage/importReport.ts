// On The Stage report import (DECISIONS D18). On The Stage has no public API
// that we could find, so the first data path may be an orders/sales export
// from its dashboard. This module turns such an export into the same
// normalized orders and lines the Eventbrite adapter produces, so revenue,
// reconciliation and attribution run unchanged.
//
// It is deliberately format-agnostic: the caller supplies an explicit column
// mapping. The sample layout in the tests is ASSUMED until a real export has
// been seen. Rules:
// - Money is parsed from decimal text into integer minor units, never floats.
//   A missing column is unknown (null), never zero. A value that cannot be
//   parsed makes the row a reported skip, never a guess.
// - A status column (or an explicit `assumeStatus`) is required: nothing is
//   silently treated as a sale.
// - The promo code on an order is the marketing linkage (tracking code).
// - Imported data is provenance-tagged (row count, SHA-256) and can never be
//   `verified`; that word is reserved for a live authorized read.

import { createHash } from "node:crypto";
import { currencyScale, type MinorUnits } from "../../domain/money.js";
import type { LineStatus, NormalizedLine, NormalizedOrder, OrderStatus } from "../../domain/types.js";
import { cleanTrackingCode } from "../eventbrite/normalize.js";
import { parseCsv } from "./csv.js";

/** Which export column holds each value. Omit what the export does not have. */
export interface ColumnMapping {
  orderId: string;
  /** Order / transaction time. ISO, "YYYY-MM-DD HH:mm[:ss]" or "M/D/YYYY h:mm[:ss] [AM|PM]"; naive times are in `timeZone`. */
  orderDate: string;
  /** Performance identifier or name; rows are grouped by it. Omit when the file is one performance (then `sourceEventId` is required). */
  performance?: string;
  status?: string;
  ticketType?: string;
  /** Tickets in the row. Default 1 per row. */
  quantity?: string;
  /** What the buyer paid for the row (gross). */
  buyerTotal?: string;
  /** Face value for the row (base price). */
  ticketPrice?: string;
  /** Ticketing platform's service fee. */
  platformFee?: string;
  processingFee?: string;
  facilityFee?: string;
  promoterRebate?: string;
  tax?: string;
  promoCode?: string;
  currency?: string;
}

export interface ImportOptions {
  mapping: ColumnMapping;
  /** ISO 4217 code used when the export has no currency column. */
  currency: string;
  /** Venue time zone for naive order dates. */
  timeZone: string;
  /** Whether each row is one ticket (grouped into orders) or one order (quantity column gives tickets). */
  rowIs: "ticket" | "order";
  /** Used as sourceEventId when `mapping.performance` is absent. */
  sourceEventId?: string;
  /** Keep only rows of this performance (value of the performance column). */
  onlyPerformance?: string;
  /** When the export has no status column, every row is taken as this status. Required then. */
  assumeStatus?: OrderStatus;
  /** Extra source status words, lower-cased, mapped onto normalized statuses. */
  statusMap?: Record<string, OrderStatus>;
}

export interface ImportSkip {
  /** 1-based data row number (header excluded). */
  row: number;
  reason: string;
}

export interface ImportResult {
  orders: NormalizedOrder[];
  lines: NormalizedLine[];
  /** Data rows in the file. */
  rowCount: number;
  skipped: ImportSkip[];
  warnings: string[];
  /** SHA-256 of the file text, for provenance. */
  sha256: string;
  /** Column names the mapping referred to that the file does not have. */
  missingColumns: string[];
}

const DEFAULT_STATUS: Record<string, OrderStatus> = {
  completed: "completed", complete: "completed", paid: "completed", confirmed: "completed", placed: "completed", success: "completed", successful: "completed",
  refunded: "refunded", refund: "refunded",
  cancelled: "cancelled", canceled: "cancelled", void: "cancelled", voided: "cancelled", deleted: "cancelled",
  pending: "unpaid", unpaid: "unpaid", reserved: "unpaid", held: "unpaid", hold: "unpaid", abandoned: "unpaid",
};

const LINE_STATUS: Record<OrderStatus, LineStatus> = { completed: "active", refunded: "refunded", cancelled: "cancelled", unpaid: "unpaid", other: "other" };

/** Decimal text ("12.50", "$1,250.00", "-3.00", "(3.00)") to integer minor units. "" → null. Unparseable → undefined. */
export function parseReportMoney(text: string | undefined, currency: string): MinorUnits | null | undefined {
  if (text === undefined) return null;
  let t = text.trim();
  if (t === "" || t === "-" || t === "—") return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) { negative = true; t = t.slice(1, -1); }
  if (t.startsWith("-")) { negative = !negative; t = t.slice(1); }
  t = t.replace(/[,\s]/g, "").replace(/^[$€£¥]/, "").replace(/^[A-Z]{3}/, "");
  const scale = currencyScale(currency);
  const m = t.match(/^(\d{1,12})(?:\.(\d+))?$/);
  if (!m) return undefined;
  const frac = m[2] ?? "";
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) return undefined; // more precision than the currency has
  const minor = Number(m[1]) * 10 ** scale + (scale > 0 ? Number(frac.slice(0, scale).padEnd(scale, "0")) : 0);
  if (!Number.isSafeInteger(minor)) return undefined;
  return negative ? -minor : minor;
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Parse an order date. Naive values are wall-clock time in `timeZone`. Returns null when empty, undefined when unparseable. */
export function parseReportDate(text: string | undefined, timeZone: string): string | null | undefined {
  if (text === undefined) return null;
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  let y: number, mo: number, d: number, h = 0, mi = 0, s = 0;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; h = +(m[4] ?? 0); mi = +(m[5] ?? 0); s = +(m[6] ?? 0); }
  else {
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (!m) return undefined;
    mo = +m[1]!; d = +m[2]!; y = +m[3]!; h = +(m[4] ?? 0); mi = +(m[5] ?? 0); s = +(m[6] ?? 0);
    const ap = m[7]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  utc = guess - tzOffsetMinutes(new Date(utc), timeZone) * 60_000; // settle across a DST edge
  return new Date(utc).toISOString();
}

function addOrNull(a: MinorUnits | null, b: MinorUnits | null): MinorUnits | null {
  return a === null || b === null ? null : a + b;
}

/** Parse one export (CSV text) into normalized orders and lines. Pure apart from hashing. */
export function importOnTheStageReport(csvText: string, opts: ImportOptions): ImportResult {
  const { mapping: col } = opts;
  if (!col.status && !opts.assumeStatus) throw new Error("A status column or an explicit assumeStatus is required: rows are never silently counted as sales.");
  if (!col.performance && !opts.sourceEventId) throw new Error("Either a performance column or a fixed sourceEventId is required.");
  const table = parseCsv(csvText);
  const have = new Set(table.headers);
  const missingColumns = Object.values(col).filter((c): c is string => typeof c === "string" && !have.has(c));
  const warnings: string[] = [];
  if (missingColumns.length) warnings.push(`Mapped columns not in the file (treated as unknown): ${missingColumns.join(", ")}.`);
  for (const k of ["buyerTotal", "ticketPrice", "platformFee", "processingFee", "tax"] as const) {
    if (!col[k]) warnings.push(`No ${k} column mapped: that amount is unknown for every row.`);
  }
  if (!col.promoCode) warnings.push("No promo code column mapped: no order can be linked to marketing.");
  const statusMap = { ...DEFAULT_STATUS, ...(opts.statusMap ?? {}) };
  const cell = (row: Record<string, string>, key: keyof ColumnMapping): string | undefined => {
    const c = col[key];
    return c && have.has(c) ? row[c] : undefined;
  };

  const skipped: ImportSkip[] = [];
  type Row = { n: number; orderId: string; eventId: string; createdAt: string | null; sourceStatus: string; status: OrderStatus; ticketType: string | null; quantity: number; promo: string | null; currency: string; money: Record<"gross" | "base" | "platform" | "payment" | "facility" | "rebate" | "tax", MinorUnits | null> };
  const rows: Row[] = [];
  table.rows.forEach((r, i) => {
    const n = i + 1;
    const skip = (reason: string) => skipped.push({ row: n, reason });
    const orderId = (cell(r, "orderId") ?? "").trim();
    if (!orderId) return skip("missing order id");
    const eventId = col.performance ? (cell(r, "performance") ?? "").trim() : opts.sourceEventId!;
    if (!eventId) return skip("missing performance");
    if (opts.onlyPerformance !== undefined && eventId !== opts.onlyPerformance) return;
    const currency = (cell(r, "currency") || opts.currency).toUpperCase();
    if (currency !== opts.currency.toUpperCase() && !col.currency) return skip(`currency ${currency} differs from ${opts.currency}`);
    const created = parseReportDate(cell(r, "orderDate"), opts.timeZone);
    if (created === undefined) return skip(`unparseable order date "${cell(r, "orderDate")}"`);
    const sourceStatus = col.status ? (cell(r, "status") ?? "") : (opts.assumeStatus ?? "");
    const status: OrderStatus = col.status ? statusMap[sourceStatus.trim().toLowerCase()] ?? "other" : opts.assumeStatus!;
    const qText = cell(r, "quantity");
    const quantity = qText === undefined || qText === "" ? 1 : Number(qText);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return skip(`invalid quantity "${qText}"`);
    const money = {} as Row["money"];
    const fields: [keyof Row["money"], keyof ColumnMapping][] = [["gross", "buyerTotal"], ["base", "ticketPrice"], ["platform", "platformFee"], ["payment", "processingFee"], ["facility", "facilityFee"], ["rebate", "promoterRebate"], ["tax", "tax"]];
    for (const [k, c] of fields) {
      const v = parseReportMoney(cell(r, c), currency);
      if (v === undefined) return skip(`unparseable amount in ${col[c]}: "${cell(r, c)}"`);
      money[k] = v;
    }
    rows.push({ n, orderId, eventId, createdAt: created, sourceStatus, status, ticketType: cell(r, "ticketType") || null, quantity, promo: cleanTrackingCode(cell(r, "promoCode")), currency, money });
  });

  const orders: NormalizedOrder[] = [];
  const lines: NormalizedLine[] = [];
  const byOrder = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.eventId}\u0000${r.orderId}`;
    const arr = byOrder.get(k) ?? [];
    arr.push(r);
    byOrder.set(k, arr);
  }
  for (const group of byOrder.values()) {
    const first = group[0]!;
    if (opts.rowIs === "order" && group.length > 1) {
      warnings.push(`Order ${first.orderId} appears on ${group.length} rows in an export declared as one row per order; rows were combined.`);
    }
    const statuses = new Set(group.map((g) => g.status));
    const orderStatus: OrderStatus = statuses.size === 1 ? first.status : statuses.has("completed") ? "completed" : first.status;
    const sum = (k: keyof Row["money"]) => group.reduce<MinorUnits | null>((acc, g) => addOrNull(acc, g.money[k]), 0);
    const components = {
      currency: first.currency,
      grossMinor: sum("gross"), basePriceMinor: sum("base"), providerFeeMinor: sum("platform"), paymentFeeMinor: sum("payment"),
      facilityFeeMinor: sum("facility"), promoterRebateMinor: sum("rebate"), taxMinor: sum("tax"),
    };
    orders.push({
      sourceId: first.orderId, sourceEventId: first.eventId, sourceStatus: [...new Set(group.map((g) => g.sourceStatus))].join("+"), status: orderStatus,
      createdAt: group.map((g) => g.createdAt).filter((d): d is string => d !== null).sort()[0] ?? null, sourceUpdatedAt: null, ...components,
    });
    group.forEach((g, i) => {
      lines.push({
        sourceId: group.length === 1 ? g.orderId : `${g.orderId}#${i + 1}`, orderSourceId: g.orderId, sourceEventId: g.eventId,
        ticketClassSourceId: null, ticketClassName: g.ticketType, sourceStatus: g.sourceStatus, status: LINE_STATUS[g.status], quantity: g.quantity,
        sourceUpdatedAt: null, trackingCode: g.promo, currency: g.currency,
        grossMinor: g.money.gross, basePriceMinor: g.money.base, providerFeeMinor: g.money.platform, paymentFeeMinor: g.money.payment,
        facilityFeeMinor: g.money.facility, promoterRebateMinor: g.money.rebate, taxMinor: g.money.tax,
      });
    });
  }
  const promos = new Set(rows.flatMap((r) => (r.promo ? [r.promo] : [])));
  const conflicting = [...byOrder.values()].filter((g) => new Set(g.map((r) => r.promo).filter(Boolean)).size > 1).length;
  if (conflicting) warnings.push(`${conflicting} order(s) carry more than one promo code across their rows; they stay unattributed.`);
  if (col.promoCode && promos.size === 0 && rows.length) warnings.push("The promo code column is mapped but no row has a code.");

  return { orders, lines, rowCount: table.rows.length, skipped, warnings, sha256: createHash("sha256").update(csvText).digest("hex"), missingColumns };
}
