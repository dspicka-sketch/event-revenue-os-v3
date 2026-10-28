// Pure prompt builder for the per-show AI summary (DECISIONS D17). It turns a
// ShowCard and the marketing summaries RevOS already computed into the plain
// text the model receives. Only aggregates go in: show name, dates, counts,
// money formatted by the shared money module, campaign titles and tracking
// link labels. Never orders, tickets, names, emails or barcodes.
//
// `basis` is returned verbatim so the client can show exactly which figures
// the narrative was written from.

import { CHANNEL_LABELS, type DriverRow, type MarketingSummary, type MoneyByCurrency } from "../domain/marketing.js";
import { formatMoney, type Measure } from "../domain/money.js";
import type { ShowCard } from "../domain/pulse.js";

export const INSIGHT_SYSTEM = [
  "You write a short, plain-language note for a live-event operator about which marketing is driving ticket sales for one show.",
  "Use only the figures provided. Quote them as given.",
  "Never compute new numbers: no new totals, percentages, averages, differences or forecasts.",
  "Never infer causes the figures do not state. Opens, clicks, list size or timing never mean a sale came from that source.",
  "Tickets not linked to a source are 'unattributed'; if most tickets are unattributed, say so plainly.",
  "A figure marked Unavailable is unknown, not zero. Plan targets are not sales.",
  "If the data is marked stale or fixture, say so in the first sentence.",
  "Write 3 to 5 sentences, under 120 words, as plain text: no markdown, headings, bullet points or emojis. Do not greet or sign off.",
].join(" ");

export interface InsightPrompt {
  system: string;
  prompt: string;
  /** The figures given to the model, verbatim. */
  basis: string;
}

const money = (list: MoneyByCurrency[]): string =>
  list.length === 0 ? "none" : list.map((g) => (g.minor === null ? `Unavailable (${g.currency})` : formatMoney(g.minor, g.currency))).join(" and ");

const measure = (m: Measure | undefined, currency: string | null): string => {
  if (!m || m.status === "unavailable" || m.minor === null || !currency) return "Unavailable";
  return `${formatMoney(m.minor, currency)}${m.status === "partial" ? " (partial: some inputs unknown)" : ""}`;
};

function localDate(iso: string | null, timeZone: string): string {
  if (!iso) return "not scheduled";
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric", weekday: "short" }).format(new Date(iso));
}

function driverLine(d: DriverRow, includeSpend: boolean): string {
  const kind = d.kind === "campaign" ? "email campaign" : `tracking link, channel ${CHANNEL_LABELS[d.channel ?? "unassigned"]}`;
  const parts = [`${d.paidTickets} paid tickets (${d.ticketShare}% of the show)`, `${d.orders} orders`, `gross after refunds ${money(d.grossAfterRefunds)}`];
  if (d.ordersPer100Clicks !== null) parts.push(`${d.ordersPer100Clicks} linked orders per 100 clicks`);
  if (includeSpend && d.spend.length) parts.push(`spend entered ${money(d.spend)}`, `cost per paid ticket ${money(d.costPerPaidTicket)}`);
  return `- ${d.label} (${kind}): ${parts.join(", ")}`;
}

function marketingBlock(title: string, m: MarketingSummary | null, includeSpend: boolean): string[] {
  if (!m) return [`${title}: no sales data yet.`];
  const out = [`${title}: ${m.trackedShare}% of ${m.paidTickets} paid tickets (${m.salesOrders} orders) are linked to a marketing source.`];
  if (m.drivers.length === 0) out.push("- No linked sources.");
  for (const d of m.drivers.slice(0, 8)) out.push(driverLine(d, includeSpend));
  if (m.drivers.length > 8) out.push(`- ${m.drivers.length - 8} smaller sources not listed.`);
  out.push(`- Unattributed (no tracking code): ${m.unattributed.paidTickets} paid tickets, ${m.unattributed.orders} orders.`);
  if (m.conflictingOrders) out.push(`- ${m.conflictingOrders} orders had conflicting codes and are not attributed.`);
  for (const o of m.outsideWindow) out.push(`- "${o.title}": ${o.paidTickets} paid tickets used its link more than ${m.windowDays} days after the send and are not attributed.`);
  for (const c of m.campaignsWithoutOrders) out.push(`- Campaign "${c.title}" has no linked orders yet${c.eventLinkClicks !== null ? ` (${c.eventLinkClicks} clicks on its show links)` : ""}.`);
  const channels = m.byChannel.filter((c) => c.paidTickets > 0);
  if (channels.length) out.push(`- By channel: ${channels.map((c) => `${CHANNEL_LABELS[c.channel]} ${c.paidTickets} tickets (${c.ticketShare}%)`).join("; ")}.`);
  return out;
}

export function buildInsightPrompt(card: ShowCard, marketing: MarketingSummary | null, marketingLast7Days: MarketingSummary | null): InsightPrompt {
  const tz = card.venueTimezone;
  const lines: string[] = [];
  lines.push(`Show: ${card.name}`);
  const when = card.phase === "today" ? "today" : card.phase === "past" ? "already happened" : card.daysUntil !== null ? `in ${card.daysUntil} days` : "unscheduled";
  lines.push(`Performance: ${localDate(card.performanceStartUtc, tz)} (${when}), venue time zone ${tz}.`);
  const flags = [card.mode === "fixture" ? "FIXTURE DATA (demo, not a real show)" : null, card.freshness.stale ? "STALE (the last read from the source failed; figures are from the last good read)" : null].filter(Boolean);
  lines.push(`Data as of: ${card.freshness.dataAsOf ?? "never read"}${flags.length ? `. ${flags.join(". ")}.` : "."}`);
  if (card.otherCurrencies.length) lines.push(`Note: sales exist in more than one currency (${[card.currency, ...card.otherCurrencies].filter(Boolean).join(", ")}); money below is ${card.currency} only and currencies are never added together.`);
  if (card.tickets) {
    lines.push(`Tickets: ${card.tickets.paid} paid, ${card.tickets.comp} comp, ${card.tickets.refunded} refunded${card.tickets.partial ? " (counts partial: some records could not be classified)" : ""}.`);
  } else {
    lines.push("Tickets: no data read yet.");
  }
  lines.push(`Gross after refunds (before fees): ${measure(card.revenue?.grossAfterRefunds, card.currency)}.`);
  lines.push(`Organizer proceeds: ${measure(card.revenue?.organizerProceeds, card.currency)}.`);
  if (card.pace) {
    const g7 = card.pace.last7DaysGrossAfterRefundsMinor;
    lines.push(`Pace: ${card.pace.last7DaysPaidTickets} paid tickets in the last 7 days${g7 !== null && card.currency ? ` (${formatMoney(g7, card.currency)})` : ""}, ${card.pace.previous7DaysPaidTickets} in the 7 days before that.`);
  }
  if (card.targets.length) {
    lines.push("Targets (plan values set by the organizer, not sales):");
    for (const t of card.targets) {
      const val = (v: number | null) => (v === null ? "Unavailable" : t.unit === "money" && t.currency ? formatMoney(v, t.currency) : String(v));
      const rate = t.requiredPerDay !== null && t.recentPerDay !== null ? `; needs ${val(t.requiredPerDay)} per day, recent average ${val(t.recentPerDay)} per day` : "";
      lines.push(`- ${t.label}: target ${val(t.target)}, actual ${val(t.actual)}${t.percent !== null ? ` (${t.percent}%)` : ""}, status ${t.status.replace("_", " ")}${rate}.`);
    }
  }
  lines.push("");
  lines.push(...marketingBlock("Marketing, all sales to date", marketing, true));
  lines.push("");
  lines.push(...marketingBlock("Marketing, orders placed in the last 7 days", marketingLast7Days, false));
  if (card.attention.length) {
    lines.push("");
    lines.push("Items RevOS flags for attention:");
    for (const a of card.attention) lines.push(`- ${a.title}: ${a.detail}`);
  }
  const basis = lines.join("\n");
  const prompt = `${basis}\n\nTask: in 3 to 5 plain sentences, tell the operator what the figures above say about which marketing is driving sales for this show, what share is unattributed, and anything flagged for attention. Use only these figures.`;
  return { system: INSIGHT_SYSTEM, prompt, basis };
}
