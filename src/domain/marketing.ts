// "Which marketing is working" (DECISIONS D13). Pure: given stored orders,
// ticket lines and campaign reports, attribute each order at most once via its
// tracking-link code. Shared by server, desktop and mobile.
//
// Rules:
// - Linkage is the tracking code stored with the purchase (e.g. Eventbrite `aff`).
//   No code -> unattributed. More than one distinct code in an order -> conflicting,
//   left unattributed.
// - A code that belongs to a campaign counts only if the order is within
//   `windowDays` after that campaign's send time; otherwise it is reported as
//   "outside window" and not attributed.
// - A code that belongs to no campaign (a bio link, an ad, a partner site) is
//   attributed to that tracking link; the link itself is the linkage.
// - Only completed orders count. Money is gross after refunds per currency;
//   fully refunded orders contribute nothing. Vendor "attributed revenue"
//   figures are never used.

import { addMinor, type MinorUnits } from "./money.js";
import type { NormalizedLine, NormalizedOrder } from "./types.js";

export interface CampaignRef {
  id: string;
  source: "mailchimp";
  title: string;
  sentAt: string | null;
  /** Tracking codes found in this campaign's links to this event. */
  trackingCodes: string[];
  emailsSent: number | null;
  uniqueOpens: number | null;
  /** Unique clicks on this campaign's links that point at this event. */
  eventLinkClicks: number | null;
}

/** Marketing channels a tracking link can belong to. Email campaigns are always "email". */
export const CHANNELS = ["email", "social", "paid_ads", "website", "partner", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel | "unassigned", string> = {
  email: "Email", social: "Social", paid_ads: "Paid ads", website: "Website", partner: "Partner", other: "Other", unassigned: "Unassigned",
};

/** What an admin has said about a tracking code. */
export interface LinkInfo {
  label?: string | null;
  channel?: Channel | null;
}

export interface MoneyByCurrency {
  currency: string;
  /** null when any contributing amount is unknown. */
  minor: MinorUnits | null;
}

export interface DriverRow {
  code: string;
  label: string;
  kind: "campaign" | "tracking_link";
  campaign: Omit<CampaignRef, "trackingCodes"> | null;
  orders: number;
  paidTickets: number;
  grossAfterRefunds: MoneyByCurrency[];
  /** Whole percent of all paid tickets for the show. */
  ticketShare: number;
  /** Linked orders per 100 unique clicks on this campaign's event links. */
  ordersPer100Clicks: number | null;
  channel: Channel | null;
  /** Spend entered for this source on this show (empty when none, or in a time-windowed view). */
  spend: MoneyByCurrency[];
  /** Spend ÷ attributed paid tickets, per currency, rounded to the minor unit. */
  costPerPaidTicket: MoneyByCurrency[];
}

export interface MarketingSummary {
  windowDays: number;
  salesOrders: number;
  paidTickets: number;
  attributedOrders: number;
  attributedTickets: number;
  /** Whole percent of paid tickets with a valid attribution. */
  trackedShare: number;
  /** Attributed drivers, most paid tickets first. */
  drivers: DriverRow[];
  outsideWindow: { code: string; title: string; orders: number; paidTickets: number }[];
  conflictingOrders: number;
  unattributed: { orders: number; paidTickets: number };
  /** Campaigns linking to this show with no attributed orders yet. */
  campaignsWithoutOrders: { id: string; title: string; sentAt: string | null; eventLinkClicks: number | null }[];
  /** Attributed paid tickets by channel (sources with no channel assigned are "unassigned"). */
  byChannel: { channel: Channel | "unassigned"; orders: number; paidTickets: number; ticketShare: number }[];
  /** Orders placed on or after this instant only; null = all sales to date. */
  since: string | null;
}

const DAY = 86400_000;

function isPaidActive(l: NormalizedLine): boolean {
  return l.status === "active" && !(l.grossMinor === 0 && (l.basePriceMinor === 0 || l.basePriceMinor === null));
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.floor((part * 100) / whole) : 0;
}

export function computeMarketing(
  orders: NormalizedOrder[],
  lines: NormalizedLine[],
  campaigns: CampaignRef[],
  opts: {
    windowDays?: number;
    links?: Record<string, LinkInfo>;
    /** Spend per tracking code for this show (only used when `since` is not set). */
    spend?: Record<string, MoneyByCurrency[]>;
    /** Count only orders placed on or after this time. */
    since?: Date;
  } = {},
): MarketingSummary {
  const windowDays = opts.windowDays ?? 7;
  const linesByOrder = new Map<string, NormalizedLine[]>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.orderSourceId) ?? [];
    arr.push(l);
    linesByOrder.set(l.orderSourceId, arr);
  }
  const campaignsByCode = new Map<string, CampaignRef[]>();
  for (const c of campaigns) {
    for (const code of c.trackingCodes) {
      const arr = campaignsByCode.get(code) ?? [];
      arr.push(c);
      campaignsByCode.set(code, arr);
    }
  }

  type Acc = { row: DriverRow; money: Map<string, number | null> };
  const drivers = new Map<string, Acc>();
  const outside = new Map<string, { code: string; title: string; orders: number; paidTickets: number }>();
  let salesOrders = 0;
  let paidTickets = 0;
  let attributedOrders = 0;
  let attributedTickets = 0;
  let conflictingOrders = 0;
  const unattributed = { orders: 0, paidTickets: 0 };

  for (const o of orders) {
    if (o.status !== "completed") continue;
    if (opts.since && (!o.createdAt || Date.parse(o.createdAt) < opts.since.getTime())) continue;
    const ls = linesByOrder.get(o.sourceId) ?? [];
    const tickets = ls.filter(isPaidActive).reduce((a, l) => a + l.quantity, 0);
    salesOrders++;
    paidTickets += tickets;

    const codes = [...new Set(ls.map((l) => l.trackingCode).filter((c): c is string => Boolean(c)))];
    if (codes.length === 0) { unattributed.orders++; unattributed.paidTickets += tickets; continue; }
    if (codes.length > 1) { conflictingOrders++; unattributed.orders++; unattributed.paidTickets += tickets; continue; }
    const code = codes[0]!;

    const linked = campaignsByCode.get(code);
    let campaign: CampaignRef | null = null;
    if (linked) {
      // The most recent send at or before the purchase, within the window.
      const t = o.createdAt ? Date.parse(o.createdAt) : NaN;
      campaign = linked
        .filter((c) => c.sentAt && !Number.isNaN(t) && t >= Date.parse(c.sentAt) && t < Date.parse(c.sentAt) + windowDays * DAY)
        .sort((a, b) => Date.parse(b.sentAt!) - Date.parse(a.sentAt!))[0] ?? null;
      if (!campaign) {
        const key = code;
        const prev = outside.get(key) ?? { code, title: linked[0]!.title, orders: 0, paidTickets: 0 };
        prev.orders++;
        prev.paidTickets += tickets;
        outside.set(key, prev);
        unattributed.orders++;
        unattributed.paidTickets += tickets;
        continue;
      }
    }

    const key = campaign ? `c:${campaign.id}` : `l:${code}`;
    let acc = drivers.get(key);
    if (!acc) {
      const { trackingCodes: _codes, ...info } = campaign ?? ({} as CampaignRef);
      acc = {
        row: {
          code,
          label: campaign ? campaign.title : opts.links?.[code]?.label || code,
          kind: campaign ? "campaign" : "tracking_link",
          campaign: campaign ? info : null,
          orders: 0, paidTickets: 0, grossAfterRefunds: [], ticketShare: 0, ordersPer100Clicks: null,
          channel: campaign ? "email" : opts.links?.[code]?.channel ?? null, spend: [], costPerPaidTicket: [],
        },
        money: new Map(),
      };
      drivers.set(key, acc);
    }
    acc.row.orders++;
    acc.row.paidTickets += tickets;
    attributedOrders++;
    attributedTickets += tickets;

    // Net gross for this order: order gross minus refunded/cancelled ticket gross.
    let net: number | null = o.grossMinor;
    for (const l of ls) if (l.status === "refunded" || l.status === "cancelled") net = net === null || l.grossMinor === null ? null : net - l.grossMinor;
    const cur = o.currency.toUpperCase();
    const prev = acc.money.has(cur) ? acc.money.get(cur)! : 0;
    acc.money.set(cur, prev === null || net === null ? null : addMinor(prev, net));
  }

  const rows = [...drivers.values()].map(({ row, money }) => {
    row.grossAfterRefunds = [...money.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor }));
    row.ticketShare = pct(row.paidTickets, paidTickets);
    const clicks = row.campaign?.eventLinkClicks ?? null;
    row.ordersPer100Clicks = clicks && clicks > 0 ? Math.round((row.orders * 1000) / clicks) / 10 : null;
    if (!opts.since) {
      row.spend = opts.spend?.[row.code] ?? [];
      row.costPerPaidTicket = costPerTicket(row.spend, row.paidTickets);
    }
    return row;
  });
  // A source with spend but no attributed sales still belongs on the board (0 tickets for the money).
  if (!opts.since) {
    for (const [code, spend] of Object.entries(opts.spend ?? {})) {
      if (rows.some((r) => r.code === code)) continue;
      const campaign = (campaignsByCode.get(code) ?? [])[0] ?? null;
      const { trackingCodes: _c, ...info } = campaign ?? ({} as CampaignRef);
      rows.push({
        code, label: campaign ? campaign.title : opts.links?.[code]?.label || code, kind: campaign ? "campaign" : "tracking_link",
        campaign: campaign ? info : null, orders: 0, paidTickets: 0, grossAfterRefunds: [], ticketShare: 0, ordersPer100Clicks: null,
        channel: campaign ? "email" : opts.links?.[code]?.channel ?? null, spend, costPerPaidTicket: costPerTicket(spend, 0),
      });
    }
  }
  rows.sort((a, b) => b.paidTickets - a.paidTickets || b.orders - a.orders || a.label.localeCompare(b.label));

  const channels = new Map<Channel | "unassigned", { orders: number; paidTickets: number }>();
  for (const r of rows) {
    const k = r.channel ?? "unassigned";
    const c = channels.get(k) ?? { orders: 0, paidTickets: 0 };
    c.orders += r.orders;
    c.paidTickets += r.paidTickets;
    channels.set(k, c);
  }
  const used = new Set(rows.filter((r) => r.campaign).map((r) => r.campaign!.id));
  return {
    windowDays,
    salesOrders,
    paidTickets,
    attributedOrders,
    attributedTickets,
    trackedShare: pct(attributedTickets, paidTickets),
    drivers: rows,
    outsideWindow: [...outside.values()].sort((a, b) => b.paidTickets - a.paidTickets),
    conflictingOrders,
    unattributed,
    campaignsWithoutOrders: campaigns
      .filter((c) => !used.has(c.id))
      .map((c) => ({ id: c.id, title: c.title, sentAt: c.sentAt, eventLinkClicks: c.eventLinkClicks })),
    byChannel: [...channels.entries()]
      .map(([channel, v]) => ({ channel, ...v, ticketShare: pct(v.paidTickets, paidTickets) }))
      .sort((a, b) => b.paidTickets - a.paidTickets),
    since: opts.since ? opts.since.toISOString() : null,
  };
}

/** Spend per paid ticket in each currency (integer division, rounded half up). Never mixes currencies. */
export function costPerTicket(spend: MoneyByCurrency[], paidTickets: number): MoneyByCurrency[] {
  return spend.map((s) => ({
    currency: s.currency,
    minor: s.minor === null || paidTickets <= 0 ? null : Math.floor((s.minor * 2 + paidTickets) / (paidTickets * 2)),
  }));
}
