// Map Eventbrite payloads to normalized records. Patron PII (names, emails,
// profiles, barcodes, addresses) is deliberately never read or copied.

import { assertMinor } from "../../domain/money.js";
import type { LineStatus, MoneyComponents, NormalizedEvent, NormalizedLine, NormalizedOrder, OrderStatus } from "../../domain/types.js";
import { ProviderError } from "../errors.js";

export interface EbMoney {
  currency: string;
  value: number;
  major_value?: string;
  display?: string;
}

export interface EbCosts {
  base_price?: EbMoney | null;
  eventbrite_fee?: EbMoney | null;
  gross?: EbMoney | null;
  payment_fee?: EbMoney | null;
  tax?: EbMoney | null;
}

export interface EbEvent {
  id: string;
  name?: { text?: string | null } | null;
  start?: { utc?: string | null; timezone?: string | null } | null;
  end?: { utc?: string | null } | null;
  currency?: string | null;
  changed?: string | null;
  series_id?: string | null;
  organization_id?: string | null;
}

export interface EbOrder {
  id: string;
  event_id: string;
  status?: string | null;
  created?: string | null;
  changed?: string | null;
  costs?: EbCosts | null;
}

export interface EbAttendee {
  id: string;
  order_id: string;
  event_id: string;
  ticket_class_id?: string | null;
  ticket_class_name?: string | null;
  quantity?: number | null;
  status?: string | null;
  refunded?: boolean | null;
  cancelled?: boolean | null;
  changed?: string | null;
  costs?: EbCosts | null;
}

/** Eventbrite order statuses (see docs/integrations.md; UNVERIFIED list). */
export function mapOrderStatus(s: string | null | undefined): OrderStatus {
  switch ((s ?? "").toLowerCase()) {
    case "placed":
      return "completed";
    case "refunded":
      return "refunded";
    case "deleted":
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "unpaid":
    case "pending":
    case "started":
    case "abandoned":
      return "unpaid";
    default:
      return "other";
  }
}

export function mapAttendeeStatus(a: Pick<EbAttendee, "status" | "refunded" | "cancelled">): LineStatus {
  if (a.cancelled) return "cancelled";
  if (a.refunded) return "refunded";
  switch ((a.status ?? "").toLowerCase()) {
    case "attending":
    case "checked in":
      return "active";
    case "unpaid":
      return "unpaid";
    case "deleted":
      return "cancelled";
    default:
      // e.g. "Not Attending" without refunded/cancelled flags (could be a
      // transfer). Not counted; surfaced as an exception.
      return "other";
  }
}

function money(m: EbMoney | null | undefined, field: string, currency: string): number | null {
  if (m === null || m === undefined) return null;
  if (m.currency && m.currency.toUpperCase() !== currency) {
    throw new ProviderError("bad_response", `${field}: currency ${m.currency} differs from ${currency} within one record.`);
  }
  return assertMinor(m.value, field);
}

function components(costs: EbCosts | null | undefined, fallbackCurrency: string | null, ctx: string): MoneyComponents {
  const c = costs ?? {};
  const currency = (c.gross?.currency ?? c.base_price?.currency ?? fallbackCurrency ?? "").toUpperCase();
  if (!currency) throw new ProviderError("bad_response", `${ctx}: no currency available.`);
  return {
    currency,
    grossMinor: money(c.gross, `${ctx}.gross`, currency),
    basePriceMinor: money(c.base_price, `${ctx}.base_price`, currency),
    providerFeeMinor: money(c.eventbrite_fee, `${ctx}.eventbrite_fee`, currency),
    paymentFeeMinor: money(c.payment_fee, `${ctx}.payment_fee`, currency),
    taxMinor: money(c.tax, `${ctx}.tax`, currency),
  };
}

function iso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function normalizeEvent(e: EbEvent): NormalizedEvent {
  return {
    sourceId: String(e.id),
    name: e.name?.text ?? `Eventbrite event ${e.id}`,
    startUtc: iso(e.start?.utc),
    endUtc: iso(e.end?.utc),
    timezone: e.start?.timezone ?? null,
    currency: e.currency ? e.currency.toUpperCase() : null,
    sourceUpdatedAt: iso(e.changed),
    seriesId: e.series_id ?? null,
  };
}

export function normalizeOrder(o: EbOrder, eventCurrency: string | null): NormalizedOrder {
  return {
    sourceId: String(o.id),
    sourceEventId: String(o.event_id),
    sourceStatus: o.status ?? "",
    status: mapOrderStatus(o.status),
    createdAt: iso(o.created),
    sourceUpdatedAt: iso(o.changed),
    ...components(o.costs, eventCurrency, `order ${o.id}`),
  };
}

export function normalizeAttendee(a: EbAttendee, eventCurrency: string | null): NormalizedLine {
  const q = a.quantity ?? 1;
  if (!Number.isSafeInteger(q) || q < 0) throw new ProviderError("bad_response", `attendee ${a.id}: invalid quantity.`);
  return {
    sourceId: String(a.id),
    orderSourceId: String(a.order_id),
    sourceEventId: String(a.event_id),
    ticketClassSourceId: a.ticket_class_id ? String(a.ticket_class_id) : null,
    ticketClassName: a.ticket_class_name ?? null,
    sourceStatus: [a.status ?? "", a.refunded ? "refunded" : "", a.cancelled ? "cancelled" : ""].filter(Boolean).join("+"),
    status: mapAttendeeStatus(a),
    quantity: q,
    sourceUpdatedAt: iso(a.changed),
    ...components(a.costs, eventCurrency, `attendee ${a.id}`),
  };
}
