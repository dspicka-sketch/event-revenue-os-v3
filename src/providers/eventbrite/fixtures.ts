// Synthetic Eventbrite-shaped data and a fake transport for FIXTURE MODE and
// tests. Contains no real patron data: no names, emails, phones or barcodes.
// Fixture connections are attached only to fixture organizations.

import type { EbAttendee, EbCosts, EbEvent, EbOrder } from "./normalize.js";

export const FIXTURE_ACCOUNT_ID = "fixture-eb-org-1";

export interface FixtureEventData {
  event: EbEvent;
  orders: EbOrder[];
  attendees: EbAttendee[];
}

export type FixtureFailure = { status: number; body?: unknown; headers?: Record<string, string> } | "timeout" | "network";

export interface FixtureTransportOptions {
  events: FixtureEventData[];
  pageSize?: number;
  /** Failures to return, in order, before serving real responses. */
  failures?: FixtureFailure[];
  /** Optional per-path failure hook (path without base URL). */
  failFor?: (path: string, query: URLSearchParams) => FixtureFailure | undefined;
}

export interface FixtureTransport {
  fetch: typeof fetch;
  calls: string[];
}

/** A fetch() look-alike serving fixture data with Eventbrite-style pagination. */
export function createFixtureTransport(opts: FixtureTransportOptions): FixtureTransport {
  const pageSize = opts.pageSize ?? 50;
  const failures = [...(opts.failures ?? [])];
  const calls: string[] = [];

  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  const page = <T>(key: string, items: T[], q: URLSearchParams) => {
    const cont = q.get("continuation");
    const pageParam = q.get("page");
    const start = cont ? Number(Buffer.from(cont, "base64url").toString()) : pageParam ? (Number(pageParam) - 1) * pageSize : 0;
    const slice = items.slice(start, start + pageSize);
    const hasMore = start + pageSize < items.length;
    return {
      pagination: {
        object_count: items.length,
        page_number: Math.floor(start / pageSize) + 1,
        page_size: pageSize,
        page_count: Math.max(1, Math.ceil(items.length / pageSize)),
        has_more_items: hasMore,
        ...(hasMore ? { continuation: Buffer.from(String(start + pageSize)).toString("base64url") } : {}),
      },
      [key]: slice,
    };
  };

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.method ?? "GET") !== "GET") throw new Error("Fixture transport: only GET is allowed");
    const path = url.pathname.replace(/^\/v3\//, "").replace(/^\//, "");
    calls.push(path + (url.search ? url.search : ""));
    const failure = failures.shift() ?? opts.failFor?.(path, url.searchParams);
    if (failure === "timeout") {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure) return respond(failure.status, failure.body ?? { error: "FIXTURE_ERROR" }, failure.headers);

    const auth = new Headers(init?.headers).get("authorization");
    if (!auth?.startsWith("Bearer ")) return respond(401, { error: "NO_AUTH" });

    if (path === "users/me/") return respond(200, { id: "fixture-user-1" });
    const m = path.match(/^events\/([^/]+)\/(orders\/|attendees\/)?$/);
    if (!m) return respond(404, { error: "NOT_FOUND" });
    const ev = opts.events.find((e) => e.event.id === decodeURIComponent(m[1]!));
    if (!ev) return respond(404, { error: "NOT_FOUND" });
    if (!m[2]) return respond(200, ev.event);
    if (m[2] === "orders/") return respond(200, page("orders", ev.orders, url.searchParams));
    return respond(200, page("attendees", ev.attendees, url.searchParams));
  };
  return { fetch: impl as typeof fetch, calls };
}

// ---------------------------------------------------------------------------
// Deterministic pilot dataset

function usd(value: number) {
  return { currency: "USD", value, major_value: (value / 100).toFixed(2), display: `${(value / 100).toFixed(2)} USD` };
}

/** Per-ticket costs. Fees passed to buyer: gross = base + fees + tax. */
function ticketCosts(base: number): EbCosts {
  if (base === 0) return { base_price: usd(0), eventbrite_fee: usd(0), payment_fee: usd(0), tax: usd(0), gross: usd(0) };
  const ebFee = Math.round(base * 0.037) + 179;
  const payFee = Math.round((base + ebFee) * 0.029);
  const tax = 0;
  return { base_price: usd(base), eventbrite_fee: usd(ebFee), payment_fee: usd(payFee), tax: usd(tax), gross: usd(base + ebFee + payFee + tax) };
}

function sumCosts(list: EbCosts[]): EbCosts {
  const k = ["base_price", "eventbrite_fee", "payment_fee", "tax", "gross"] as const;
  const out: EbCosts = {};
  for (const key of k) out[key] = usd(list.reduce((a, c) => a + (c[key]?.value ?? 0), 0));
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CLASSES = [
  { id: "tc-ga", name: "General Admission", price: 2500 },
  { id: "tc-adv", name: "Advance", price: 2000 },
  { id: "tc-vip", name: "VIP Balcony", price: 6000 },
];

/**
 * Two performances of the same show (same title, different dates/IDs).
 * `revision` 1 applies post-sale changes: a full refund, a partial refund and
 * one new order — used to demonstrate that refresh updates in place.
 */
export function pilotFixture(revision = 0): FixtureEventData[] {
  return [
    buildPerformance("fx-1001", "2026-11-14T04:00:00Z", 11, 140, revision),
    buildPerformance("fx-1002", "2026-11-15T04:00:00Z", 22, 60, revision),
  ];
}

function buildPerformance(eventId: string, startUtc: string, seed: number, orderCount: number, revision: number): FixtureEventData {
  const r = rng(seed);
  const event: EbEvent = {
    id: eventId,
    name: { text: "[FIXTURE] The Night Owls — Live" },
    start: { utc: startUtc, timezone: "America/Los_Angeles" },
    end: { utc: new Date(Date.parse(startUtc) + 3 * 3600_000).toISOString().replace(".000", "") },
    currency: "USD",
    changed: "2026-10-01T17:00:00Z",
    series_id: "fx-series-1",
    organization_id: FIXTURE_ACCOUNT_ID,
  };
  const orders: EbOrder[] = [];
  const attendees: EbAttendee[] = [];
  const base = Date.parse("2026-09-01T17:00:00Z");
  const extra = revision >= 1 ? 1 : 0;
  let partialRefundDone = false;
  for (let i = 0; i < orderCount + extra; i++) {
    const orderId = `${eventId}-o${String(i + 1).padStart(4, "0")}`;
    const created = new Date(i < orderCount ? base + Math.floor(r() * 50) * 86400_000 + i * 60_000 : Date.parse("2026-10-19T20:00:00Z")).toISOString().replace(".000", "");
    const qty = 1 + Math.floor(r() * 4);
    const cls = CLASSES[Math.floor(r() * CLASSES.length)]!;
    const comp = i % 47 === 5;
    let status = "placed";
    if (i % 61 === 7) status = "unpaid";
    const lines: EbAttendee[] = [];
    for (let j = 0; j < qty; j++) {
      lines.push({
        id: `${orderId}-a${j + 1}`,
        order_id: orderId,
        event_id: eventId,
        ticket_class_id: comp ? "tc-comp" : cls.id,
        ticket_class_name: comp ? "Guest List" : cls.name,
        quantity: 1,
        status: status === "unpaid" ? "Unpaid" : "Attending",
        refunded: false,
        cancelled: false,
        changed: created,
        costs: ticketCosts(comp ? 0 : cls.price),
      });
    }
    let changed = created;
    // Revision 1: order 3 fully refunded; the first multi-ticket order after
    // order 8 has one ticket refunded.
    if (revision >= 1 && i === 2) {
      status = "refunded";
      changed = "2026-10-18T18:00:00Z";
      for (const l of lines) Object.assign(l, { refunded: true, status: "Not Attending", changed });
    }
    if (revision >= 1 && i >= 8 && !partialRefundDone && status === "placed" && !comp && lines.length > 1) {
      partialRefundDone = true;
      changed = "2026-10-18T19:00:00Z";
      Object.assign(lines[0]!, { refunded: true, status: "Not Attending", changed });
    }
    orders.push({ id: orderId, event_id: eventId, status, created, changed, costs: sumCosts(lines.map((l) => l.costs!)) });
    attendees.push(...lines);
  }
  return { event, orders, attendees };
}
