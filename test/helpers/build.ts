import type { EbAttendee, EbCosts, EbOrder } from "../../src/providers/eventbrite/normalize.js";

export const m = (value: number, currency = "USD") => ({ currency, value });

export function costs(base: number, fee: number, pay: number, tax: number, currency = "USD"): EbCosts {
  return { base_price: m(base, currency), eventbrite_fee: m(fee, currency), payment_fee: m(pay, currency), tax: m(tax, currency), gross: m(base + fee + pay + tax, currency) };
}

export function order(id: string, eventId: string, lineCosts: EbCosts[], extra: Partial<EbOrder> = {}): EbOrder {
  const sum = (k: "base_price" | "eventbrite_fee" | "payment_fee" | "tax" | "gross") => m(lineCosts.reduce((a, c) => a + (c[k]?.value ?? 0), 0), lineCosts[0]?.gross?.currency ?? "USD");
  return {
    id, event_id: eventId, status: "placed", created: "2026-10-10T18:00:00Z", changed: "2026-10-10T18:00:00Z",
    costs: {
      base_price: sum("base_price"), eventbrite_fee: sum("eventbrite_fee"), payment_fee: sum("payment_fee"), tax: sum("tax"), gross: sum("gross"),
      // Carry itemized fees up to the order when the tickets have them (summed by name).
      ...(lineCosts.some((c) => Array.isArray(c.fee_components))
        ? {
            fee_components: Object.values(
              lineCosts.flatMap((c) => c.fee_components ?? []).reduce<Record<string, NonNullable<EbCosts["fee_components"]>[number]>>((acc, f) => {
                const k = f.name ?? "";
                const prev = acc[k];
                acc[k] = prev && typeof prev.value === "number" && typeof f.value === "number" ? { ...prev, value: prev.value + f.value } : { ...f };
                return acc;
              }, {}),
            ),
          }
        : {}),
    },
    ...extra,
  };
}

export function attendees(orderId: string, eventId: string, lineCosts: EbCosts[], extra: Partial<EbAttendee>[] = []): EbAttendee[] {
  return lineCosts.map((c, i) => ({
    id: `${orderId}-a${i + 1}`, order_id: orderId, event_id: eventId, ticket_class_id: "tc1", ticket_class_name: "GA",
    quantity: 1, status: "Attending", refunded: false, cancelled: false, changed: "2026-10-10T18:00:00Z", costs: c, ...(extra[i] ?? {}),
  }));
}
