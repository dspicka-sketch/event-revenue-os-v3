// Weekly digest text (D19). Pure: it renders what the shared pulse already
// computed and never derives a new figure. Unknown stays "unavailable".

import { DISCOVERY_METHOD, type CandidateOrigin } from "./discovery.js";
import { formatMoney, type Measure } from "./money.js";
import type { OrgPulse, ShowCard } from "./pulse.js";

export const SWEEP_STALE_AFTER_HOURS = 36;
const MAX_CANDIDATES = 10;

export interface DigestSweepFailure {
  name: string;
  kind: string;
  message: string;
}

export interface DigestCandidate {
  artist: string;
  origin: CandidateOrigin;
  reasons: string[];
  anchorVenue: string;
  anchorCity: string;
  anchorStartsAt: string;
}

export interface DigestInput {
  organizationName: string;
  /** Timezone for the digest's own timestamps. Shows use their venue timezone. */
  timezone?: string;
  pulse: OrgPulse;
  lastSweepSucceededAt: Date | null;
  lastSweepFailures: DigestSweepFailure[];
  /** Candidates first seen since the previous digest. */
  newCandidates: DigestCandidate[];
  now: Date;
}

const clean = (s: string) => s.replace(/[  ]/g, " ");
const day = (d: Date, timeZone: string) => clean(new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone }).format(d));
const moment = (d: Date, timeZone: string) =>
  clean(new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(d));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function money(m: Measure | undefined, currency: string | null): string {
  if (!m || m.status === "unavailable" || m.minor === null || !currency) return "unavailable";
  return formatMoney(m.minor, currency) + (m.status === "partial" ? " (partial: some amounts unknown)" : "");
}

function when(card: ShowCard): string {
  if (!card.performanceStartUtc) return "Date unknown";
  const d = day(new Date(card.performanceStartUtc), card.venueTimezone);
  const n = card.daysUntil;
  if (n === null) return d;
  const rel = n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 ? `in ${n} days` : n === -1 ? "yesterday" : `${-n} days ago`;
  return `${d} · ${rel}`;
}

function showBlock(card: ShowCard): string[] {
  const lines = [card.name, `  ${when(card)}`];
  lines.push(`  Paid tickets: ${card.tickets ? card.tickets.paid + (card.tickets.partial ? " (partial count)" : "") : "unavailable"}`);
  lines.push(`  Gross after refunds: ${money(card.revenue?.grossAfterRefunds, card.currency)}`);
  if (card.pace) lines.push(`  Last 7 days: ${card.pace.last7DaysPaidTickets} paid (prior 7 days: ${card.pace.previous7DaysPaidTickets})`);
  for (const a of card.attention) lines.push(`  ! ${a.title}`);
  return lines;
}

const byDate = (a: ShowCard, b: ShowCard) =>
  (a.performanceStartUtc ? Date.parse(a.performanceStartUtc) : Infinity) - (b.performanceStartUtc ? Date.parse(b.performanceStartUtc) : Infinity);

export function buildDigest(input: DigestInput): { subject: string; text: string } {
  const tz = input.timezone ?? "America/Los_Angeles";
  const { pulse } = input;
  const upcoming = pulse.shows.filter((s) => s.phase !== "past").sort(byDate);
  const past = pulse.shows.filter((s) => s.phase === "past").sort(byDate);
  const needing = pulse.shows.filter((s) => s.attention.length > 0).length;
  const total = pulse.shows.length;

  const subject = `${input.organizationName} weekly digest: ${
    total === 0 ? "no shows" : needing > 0 ? `${needing} of ${plural(total, "show")} need attention` : `${plural(total, "show")}, nothing needs attention`
  }`;

  const out: string[] = [];
  const last = input.lastSweepSucceededAt;
  if (!last) out.push("WARNING: automatic sync has never run.", "");
  else if (input.now.getTime() - last.getTime() > SWEEP_STALE_AFTER_HOURS * 3600_000) {
    out.push(`WARNING: automatic sync has not succeeded since ${moment(last, tz)}. Figures below may be out of date.`, "");
  }
  if (input.lastSweepFailures.length) {
    out.push(`WARNING: the last sync could not refresh ${plural(input.lastSweepFailures.length, "show")}:`);
    for (const f of input.lastSweepFailures) out.push(`  - ${f.name} (${f.kind}): ${f.message}`);
    out.push("");
  }

  out.push(`${input.organizationName}: week of ${day(input.now, tz)}`);
  const gross = pulse.summary.upcomingGrossByCurrency.map((g) => (g.minor === null || g.status === "unavailable" ? `${g.currency} unavailable` : formatMoney(g.minor, g.currency) + (g.status === "partial" ? " (partial)" : "")));
  out.push(`Upcoming shows: ${pulse.summary.upcomingShows} · Paid tickets, last 7 days: ${pulse.summary.paidTicketsLast7Days} · Upcoming gross after refunds: ${gross.length ? gross.join(", ") : "unavailable"}`, "");

  if (upcoming.length === 0) out.push("No upcoming shows.", "");
  for (const card of upcoming) out.push(...showBlock(card), "");
  if (past.length) {
    out.push("Recent shows", "");
    for (const card of past) out.push(...showBlock(card), "");
  }

  if (input.newCandidates.length === 0) out.push("No new underplay candidates this week.");
  else {
    out.push(`New underplay candidates this week (${input.newCandidates.length}):`);
    for (const c of input.newCandidates.slice(0, MAX_CANDIDATES)) {
      out.push(`  - ${c.artist}${c.origin === "watchlist" ? " [watchlist]" : ""}: ${c.anchorVenue}, ${c.anchorCity}, ${day(new Date(c.anchorStartsAt), tz)}.${c.reasons.length ? ` ${c.reasons.join("; ")}` : ""}`);
    }
    if (input.newCandidates.length > MAX_CANDIDATES) out.push(`  ...and ${input.newCandidates.length - MAX_CANDIDATES} more in the candidate list.`);
    out.push(`Scores use ${DISCOVERY_METHOD}, a starting method that has not been approved.`);
  }
  out.push("", last ? `Data as of: last successful sync ${moment(last, tz)}.` : "Data as of: no successful sync yet.");
  out.push("Sent by RevOS AutoRev to this organization's admins. Nothing in this email was sent to anyone else.");
  return { subject, text: out.join("\n") };
}
