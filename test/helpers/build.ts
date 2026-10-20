import type { EbAttendee, EbCosts, EbOrder } from "../../src/providers/eventbrite/normalize.js";

export const m = (value: number, currency = "USD") => ({ currency, value });

export function costs(base: number, fee: number, pay: number, tax: number, currency = "USD"): EbCosts {
  return { base_price: m(base, currency), eventbrite_fee: m(fee, currency), payment_fee: m(pay, currency), tax: m(tax, currency), gross: m(base + fee + pay + tax, currency) };
}

export function order(id: string, eventId: string, lineCosts: EbCosts[], extra: Partial<EbOrder> = {}): EbOrder {
  const sum = (k: keyof EbCosts) => m(lineCosts.reduce((a, c) => a + (c[k]?.value ?? 0), 0), lineCosts[0]?.gross?.currency ?? "USD");
  return {
    id, event_id: eventId, status: "placed", created: "2026-10-10T18:00:00Z", changed: "2026-10-10T18:00:00Z",
    costs: { base_price: sum("base_price"), eventbrite_fee: sum("eventbrite_fee"), payment_fee: sum("payment_fee"), tax: sum("tax"), gross: sum("gross") },
    ...extra,
  };
}

export function attendees(orderId: string, eventId: string, lineCosts: EbCosts[], extra: Partial<EbAttendee>[] = []): EbAttendee[] {
  return lineCosts.map((c, i) => ({
    id: `${orderId}-a${i + 1}`, order_id: orderId, event_id: eventId, ticket_class_id: "tc1", ticket_class_name: "GA",
    quantity: 1, status: "Attending", refunded: false, cancelled: false, changed: "2026-10-10T18:00:00Z", costs: c, ...(extra[i] ?? {}),
  }));
}
