// Read-only diagnostic for the first live Eventbrite read. It answers the
// ASSUMED items in docs/integrations.md from real payloads while emitting only
// aggregate counts, field names and Eventbrite's own enum strings: never IDs,
// names, emails, barcodes or per-buyer amounts.

import { EventbriteClient, type Pagination } from "./client.js";
import { classifyFeeComponent, type EbAttendee, type EbCosts, type EbMoney, type EbOrder } from "./normalize.js";

const COST_KEYS = ["gross", "base_price", "eventbrite_fee", "payment_fee", "tax"] as const;

type Counts = Record<string, number>;
const bump = (c: Counts, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };

export interface ProbeReport {
  generatedAt: string;
  requestsMade: number;
  authenticated: boolean;
  event: {
    organizationMatchesConfig: boolean | null;
    currency: string | null;
    timezone: string | null;
    hasSeriesId: boolean;
    topLevelKeys: string[];
  };
  pagination: { keysSeen: string[]; continuationUsed: boolean };
  orders: {
    total: number;
    statusValues: Counts;
    /** object_count reported for each `status` query value (first page only). */
    countByStatusParam: Record<string, number | string>;
    costs: Record<(typeof COST_KEYS)[number], { present: number; nullOrMissing: number; nonIntegerValue: number }>;
    moneyObjectKeys: string[];
    currencies: Counts;
    hasCreated: number;
    hasChanged: number;
    topLevelKeys: string[];
    /** gross vs components (itemized facility fees and rebates included), for orders with all components present. */
    feeShape: { buyerPaysAllFees: number; organizerAbsorbsPlatformFees: number; other: number };
    /** Itemized fee names as the venue set them up, with how RevOS classifies each. */
    feeComponentNames: Record<string, { orders: number; classifiedAs: string }>;
    ordersWithItemizedFees: number;
  };
  attendees: {
    totalDefaultListing: number;
    countByStatusParam: Record<string, number | string>;
    statusValues: Counts;
    refundedTrue: number;
    cancelledTrue: number;
    quantityValues: Counts;
    costsPresent: number;
    topLevelKeys: string[];
  };
  /** Orders whose attendees are partly refunded/cancelled: are order costs pre- or post-refund? */
  partialRefunds: { orders: number; orderGrossEqualsAllTickets: number; orderGrossEqualsActiveTicketsOnly: number; neither: number };
  /** Plain-language findings derived from the counts above. */
  findings: string[];
}

function keysOf(objs: object[]): string[] {
  const s = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o)) s.add(k);
  return [...s].sort();
}

const val = (m: EbMoney | null | undefined) => (m && Number.isInteger(m.value) ? m.value : null);

export async function probeEventbrite(client: EventbriteClient, cfg: { organizationId: string; eventId: string }): Promise<ProbeReport> {
  const findings: string[] = [];
  const evPath = `events/${encodeURIComponent(cfg.eventId)}/`;

  const me = await client.get<{ id?: unknown }>("users/me/");
  const event = await client.get<Record<string, unknown> & { organization_id?: string; currency?: string; start?: { timezone?: string }; series_id?: string }>(evPath);

  // Full listings, recording pagination keys from the raw first page.
  const firstOrders = await client.get<{ pagination?: Pagination }>(`${evPath}orders/`, { status: "all_not_deleted" });
  const orders = await client.listAll<EbOrder>(`${evPath}orders/`, "orders", { status: "all_not_deleted" });
  const attendees = await client.listAll<EbAttendee>(`${evPath}attendees/`, "attendees");

  // What each status filter returns (one page each; object_count when reported).
  const countFor = async (path: string, key: string, status?: string) => {
    try {
      const b = await client.get<{ pagination?: Pagination } & Record<string, unknown>>(path, status ? { status } : {});
      return b.pagination?.object_count ?? `≥${Array.isArray(b[key]) ? (b[key] as unknown[]).length : 0} (no object_count)`;
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const orderParams: Record<string, number | string> = {};
  for (const st of ["active", "inactive", "both", "all_not_deleted"]) orderParams[st] = await countFor(`${evPath}orders/`, "orders", st);
  const attendeeParams: Record<string, number | string> = { "(no filter)": await countFor(`${evPath}attendees/`, "attendees") };
  for (const st of ["attending", "not_attending", "unpaid"]) attendeeParams[st] = await countFor(`${evPath}attendees/`, "attendees", st);

  // Orders.
  const statusValues: Counts = {};
  const currencies: Counts = {};
  const costs = Object.fromEntries(COST_KEYS.map((k) => [k, { present: 0, nullOrMissing: 0, nonIntegerValue: 0 }])) as ProbeReport["orders"]["costs"];
  const moneyKeys: object[] = [];
  const feeShape = { buyerPaysAllFees: 0, organizerAbsorbsPlatformFees: 0, other: 0 };
  const feeComponentNames: ProbeReport["orders"]["feeComponentNames"] = {};
  let ordersWithItemizedFees = 0;
  let hasCreated = 0;
  let hasChanged = 0;
  for (const o of orders) {
    bump(statusValues, String(o.status ?? "(missing)"));
    if (o.created) hasCreated++;
    if (o.changed) hasChanged++;
    const c: EbCosts = o.costs ?? {};
    for (const k of COST_KEYS) {
      const m = c[k];
      if (!m) costs[k].nullOrMissing++;
      else {
        costs[k].present++;
        moneyKeys.push(m);
        if (!Number.isInteger(m.value)) costs[k].nonIntegerValue++;
        bump(currencies, String(m.currency ?? "(missing)"));
      }
    }
    // Organizer-defined fees (facility fee, rebate) from the itemized list; names are the venue's own labels.
    let orgFees = 0;
    if (Array.isArray(c.fee_components)) {
      ordersWithItemizedFees++;
      for (const fc of c.fee_components) {
        const name = String(fc.name ?? fc.internal_name ?? "(unnamed)").slice(0, 80);
        const kind = classifyFeeComponent(fc);
        const e = feeComponentNames[name] ?? { orders: 0, classifiedAs: kind ?? "not counted separately" };
        e.orders++;
        feeComponentNames[name] = e;
        const v = typeof fc.value === "number" ? fc.value : val(fc.value as EbMoney | null);
        if (kind && v !== null) orgFees += v;
      }
    }
    const [g, b, f, p, t] = [val(c.gross), val(c.base_price), val(c.eventbrite_fee), val(c.payment_fee), val(c.tax)];
    if (g !== null && b !== null && f !== null && p !== null && t !== null && !(g === 0 && b === 0)) {
      if (g === b + orgFees + f + p + t) feeShape.buyerPaysAllFees++;
      else if (g === b + orgFees + t) feeShape.organizerAbsorbsPlatformFees++;
      else feeShape.other++;
    }
  }

  // Attendees.
  const aStatus: Counts = {};
  const qty: Counts = {};
  let refundedTrue = 0;
  let cancelledTrue = 0;
  let costsPresent = 0;
  const byOrder = new Map<string, EbAttendee[]>();
  for (const a of attendees) {
    bump(aStatus, String(a.status ?? "(missing)"));
    bump(qty, String(a.quantity ?? "(missing)"));
    if (a.refunded) refundedTrue++;
    if (a.cancelled) cancelledTrue++;
    if (a.costs?.gross) costsPresent++;
    const arr = byOrder.get(String(a.order_id)) ?? [];
    arr.push(a);
    byOrder.set(String(a.order_id), arr);
  }

  // Partial refunds: compare order gross with the sum of all vs active tickets.
  const partial = { orders: 0, orderGrossEqualsAllTickets: 0, orderGrossEqualsActiveTicketsOnly: 0, neither: 0 };
  for (const o of orders) {
    const ls = byOrder.get(String(o.id)) ?? [];
    const off = ls.filter((a) => a.refunded || a.cancelled);
    if (off.length === 0 || off.length === ls.length) continue;
    partial.orders++;
    const g = val(o.costs?.gross);
    const all = ls.reduce<number | null>((s, a) => (s === null || val(a.costs?.gross) === null ? null : s + val(a.costs?.gross)!), 0);
    const active = ls.filter((a) => !a.refunded && !a.cancelled).reduce<number | null>((s, a) => (s === null || val(a.costs?.gross) === null ? null : s + val(a.costs?.gross)!), 0);
    if (g !== null && g === all) partial.orderGrossEqualsAllTickets++;
    else if (g !== null && g === active) partial.orderGrossEqualsActiveTicketsOnly++;
    else partial.neither++;
  }

  // Findings.
  const fp = firstOrders.pagination ?? {};
  const orgMatch = event.organization_id ? String(event.organization_id) === cfg.organizationId : null;
  if (orgMatch === false) findings.push("BLOCKER: the event's organization_id does not match EVENTBRITE_ORGANIZATION_ID.");
  for (const k of COST_KEYS) {
    if (costs[k].nonIntegerValue) findings.push(`BLOCKER: ${costs[k].nonIntegerValue} order costs.${k}.value are not integers — the minor-unit assumption is wrong.`);
    if (costs[k].nullOrMissing && orders.length) findings.push(`costs.${k} missing on ${costs[k].nullOrMissing}/${orders.length} orders → that measure will show as partial/unavailable.`);
  }
  const known = new Set(["placed", "refunded", "deleted", "cancelled", "canceled", "unpaid", "pending", "started", "abandoned"]);
  const unknown = Object.keys(statusValues).filter((s) => !known.has(s.toLowerCase()));
  findings.push(unknown.length ? `Order status values not yet mapped: ${unknown.join(", ")} — update mapOrderStatus.` : "All order status values are mapped.");
  const aKnown = new Set(["attending", "checked in", "not attending", "unpaid", "deleted"]);
  const aUnknown = Object.keys(aStatus).filter((s) => !aKnown.has(s.toLowerCase()));
  if (aUnknown.length) findings.push(`Attendee status values not yet mapped: ${aUnknown.join(", ")}.`);
  const notAtt = attendeeParams["not_attending"];
  if (typeof notAtt === "number" && notAtt > 0 && refundedTrue + cancelledTrue + (aStatus["Not Attending"] ?? 0) === 0) {
    findings.push("BLOCKER: the default attendee listing appears to EXCLUDE not-attending (refunded/cancelled) tickets; refunds would be undercounted. Fetch with explicit status filters.");
  }
  if (partial.orders) {
    findings.push(
      partial.orderGrossEqualsActiveTicketsOnly > partial.orderGrossEqualsAllTickets
        ? "Order costs appear REDUCED after partial refunds → current code would double-subtract; change partial-refund handling."
        : partial.orderGrossEqualsAllTickets > 0
          ? "Order costs appear to be PRE-refund for partially refunded orders → current handling is consistent."
          : "Partial refunds present but order/ticket totals match neither pattern → investigate manually.",
    );
  } else findings.push("No partially refunded orders in this event; partial-refund behavior remains unverified.");
  if (feeShape.buyerPaysAllFees || feeShape.organizerAbsorbsPlatformFees || feeShape.other) {
    findings.push(`Fee shape: ${feeShape.buyerPaysAllFees} orders consistent with the buyer paying every fee (D15), ${feeShape.organizerAbsorbsPlatformFees} look like the organizer absorbed platform/processing fees, ${feeShape.other} match neither.${feeShape.other ? " Check fee names below for unrecognised fees." : ""}`);
  }
  if (orders.length && ordersWithItemizedFees === 0) {
    findings.push("Orders carry no itemized fee list (fee_components): facility fees and promoter rebates will show as 'not reported by source'.");
  } else if (Object.keys(feeComponentNames).length) {
    findings.push(`Itemized fees: ${Object.entries(feeComponentNames).map(([n, v]) => `"${n}" → ${v.classifiedAs}`).join("; ")}. If a facility fee or rebate is not recognised, tell the developer its exact name.`);
  }
  if (orders.length && !hasCreated) findings.push("BLOCKER: orders have no 'created' time; sales-date views cannot work.");

  return {
    generatedAt: new Date().toISOString(),
    requestsMade: client.requestsMade,
    authenticated: Boolean(me.id),
    event: {
      organizationMatchesConfig: orgMatch,
      currency: event.currency ?? null,
      timezone: event.start?.timezone ?? null,
      hasSeriesId: Boolean(event.series_id),
      topLevelKeys: Object.keys(event).sort(),
    },
    pagination: { keysSeen: Object.keys(fp).sort(), continuationUsed: Boolean(fp.continuation) },
    orders: {
      total: orders.length,
      statusValues,
      countByStatusParam: orderParams,
      costs,
      moneyObjectKeys: keysOf(moneyKeys),
      currencies,
      hasCreated,
      hasChanged,
      topLevelKeys: keysOf(orders),
      feeShape,
      feeComponentNames,
      ordersWithItemizedFees,
    },
    attendees: {
      totalDefaultListing: attendees.length,
      countByStatusParam: attendeeParams,
      statusValues: aStatus,
      refundedTrue,
      cancelledTrue,
      quantityValues: qty,
      costsPresent,
      topLevelKeys: keysOf(attendees),
    },
    partialRefunds: partial,
    findings,
  };
}

export function probeToMarkdown(r: ProbeReport): string {
  const kv = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `| ${k} | ${typeof v === "object" ? JSON.stringify(v) : String(v)} |`).join("\n");
  return `# Eventbrite live probe

Generated ${r.generatedAt} · ${r.requestsMade} read-only requests · authenticated: ${r.authenticated}

Contains only counts, field names and Eventbrite enum values: no IDs, names, emails or per-buyer amounts. Safe to share with the developer.

## Findings
${r.findings.map((f) => `- ${f}`).join("\n")}

## Event
| Item | Value |
|---|---|
${kv(r.event)}

## Pagination
Keys seen: ${r.pagination.keysSeen.join(", ") || "(none)"} · continuation used: ${r.pagination.continuationUsed}

## Orders (${r.orders.total})
| Item | Value |
|---|---|
| status values | ${JSON.stringify(r.orders.statusValues)} |
| count by \`status\` param | ${JSON.stringify(r.orders.countByStatusParam)} |
| currencies | ${JSON.stringify(r.orders.currencies)} |
| money object keys | ${r.orders.moneyObjectKeys.join(", ")} |
| has created / changed | ${r.orders.hasCreated} / ${r.orders.hasChanged} |
| fee shape | ${JSON.stringify(r.orders.feeShape)} |
| orders with itemized fees | ${r.orders.ordersWithItemizedFees} |
| itemized fee names | ${JSON.stringify(r.orders.feeComponentNames)} |
| top-level keys | ${r.orders.topLevelKeys.join(", ")} |

| Cost field | present | null/missing | non-integer value |
|---|---|---|---|
${Object.entries(r.orders.costs).map(([k, v]) => `| ${k} | ${v.present} | ${v.nullOrMissing} | ${v.nonIntegerValue} |`).join("\n")}

## Attendees (${r.attendees.totalDefaultListing} in default listing)
| Item | Value |
|---|---|
| count by \`status\` param | ${JSON.stringify(r.attendees.countByStatusParam)} |
| status values | ${JSON.stringify(r.attendees.statusValues)} |
| refunded / cancelled flags | ${r.attendees.refundedTrue} / ${r.attendees.cancelledTrue} |
| quantity values | ${JSON.stringify(r.attendees.quantityValues)} |
| with costs.gross | ${r.attendees.costsPresent} |
| top-level keys | ${r.attendees.topLevelKeys.join(", ")} |

## Partial refunds
${JSON.stringify(r.partialRefunds)}
`;
}
