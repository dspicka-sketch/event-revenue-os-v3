// Provider-neutral normalized records. Adapters map vendor payloads into these;
// the revenue/reconciliation layer only ever sees these shapes.

import type { MinorUnits } from "./money.js";

/**
 * Normalized order status.
 * - completed: a placed/paid sale (may still contain refunded lines)
 * - refunded:  the whole order was refunded
 * - cancelled: the order was cancelled/deleted at source and is not a sale
 * - unpaid:    started/pending/unpaid — never a completed sale
 * - other:     a source status we do not recognise; excluded and flagged
 */
export type OrderStatus = "completed" | "refunded" | "cancelled" | "unpaid" | "other";

/** Normalized line (one ticket/attendee) status. */
export type LineStatus = "active" | "refunded" | "cancelled" | "unpaid" | "other";

/** Money components as reported by the source. `null` = not supplied (unknown). */
export interface MoneyComponents {
  currency: string;
  /** Total the buyer paid (source "gross"). */
  grossMinor: MinorUnits | null;
  /** Ticket face value as reported (source "base_price"). */
  basePriceMinor: MinorUnits | null;
  /** Ticketing platform's service fee. */
  providerFeeMinor: MinorUnits | null;
  /** Payment processing fee. */
  paymentFeeMinor: MinorUnits | null;
  taxMinor: MinorUnits | null;
}

export interface NormalizedOrder extends MoneyComponents {
  sourceId: string;
  sourceEventId: string;
  sourceStatus: string;
  status: OrderStatus;
  /** Transaction time (UTC ISO). */
  createdAt: string | null;
  /** Source last-changed time (UTC ISO), when supplied. */
  sourceUpdatedAt: string | null;
}

export interface NormalizedLine extends MoneyComponents {
  sourceId: string;
  orderSourceId: string;
  sourceEventId: string;
  ticketClassSourceId: string | null;
  ticketClassName: string | null;
  sourceStatus: string;
  status: LineStatus;
  quantity: number;
  sourceUpdatedAt: string | null;
  /** Marketing tracking-link code the purchase came through (e.g. Eventbrite `aff`), if any. */
  trackingCode: string | null;
}

export interface NormalizedEvent {
  sourceId: string;
  name: string;
  /** Performance start (UTC ISO). */
  startUtc: string | null;
  endUtc: string | null;
  timezone: string | null;
  currency: string | null;
  sourceUpdatedAt: string | null;
  seriesId: string | null;
}

export interface NormalizedSnapshot {
  event: NormalizedEvent;
  orders: NormalizedOrder[];
  lines: NormalizedLine[];
  pagesFetched: number;
  requestsMade: number;
}

/** How organizer proceeds may be derived for a source connection. */
export type ProceedsPolicy =
  /** Fee/tax ownership not yet documented for this source: proceeds unavailable. */
  | "unverified"
  /** Proceeds = buyer gross − platform fee − payment fee − tax. */
  | "gross_minus_fees_and_tax";

/** An email campaign and its links to ticketing events (marketing source, not a sale). */
export interface NormalizedCampaign {
  sourceId: string;
  title: string;
  /** Send time (UTC ISO); null if not sent. */
  sentAt: string | null;
  emailsSent: number | null;
  uniqueOpens: number | null;
  /** One entry per (event, tracking code) the campaign linked to. */
  eventLinks: { provider: "eventbrite"; sourceEventId: string; trackingCode: string | null; uniqueClicks: number | null; totalClicks: number | null }[];
}
