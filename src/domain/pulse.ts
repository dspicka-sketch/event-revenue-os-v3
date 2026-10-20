// Show cards and "needs attention" rules. Pure and provider-neutral: the
// server computes these once and both the desktop and mobile clients render
// them, so the two apps can never disagree about a number or an alert.

import { addMinor, currencyScale, type Measure, type MeasureStatus, type MinorUnits } from "./money.js";
import { localDate, type DailySales, type EventRevenue, type ReconciliationRow } from "./revenue.js";

export type TargetMeasure = "paidTickets" | "grossAfterRefunds" | "organizerProceeds";

export interface Target {
  measure: TargetMeasure;
  /** Ticket count, or minor units of `currency`. */
  value: number;
  currency: string | null;
  source: "manual";
  updatedAt: string | null;
}

export interface ShowInput {
  id: string;
  name: string;
  performanceStartUtc: string | null;
  venueTimezone: string;
  provider: string;
  mode: "live" | "fixture";
  connectionStatus: string;
  connectionStatusKind: string | null;
  connectionAction: string | null;
  stale: boolean;
  dataAsOf: string | null;
  revenue: EventRevenue | null;
  reportComparison: ReconciliationRow[] | null;
  targets: Target[];
}

export type AttentionSeverity = "error" | "warning" | "info";

export interface AttentionItem {
  code:
    | "not_configured" | "sync_error" | "stale" | "never_synced" | "not_refreshed_recently"
    | "reconciliation_difference" | "review_exceptions" | "behind_target" | "multiple_currencies" | "counts_partial";
  severity: AttentionSeverity;
  title: string;
  detail: string;
}

export type TargetStatus = "met" | "on_track" | "behind" | "missed" | "unknown";

export interface TargetProgress {
  measure: TargetMeasure;
  label: string;
  unit: "count" | "money";
  currency: string | null;
  target: number;
  actual: number | null;
  actualStatus: MeasureStatus;
  /** Whole percent (floor), null when actual is unknown or target is 0. */
  percent: number | null;
  status: TargetStatus;
  /** Needed per remaining day to reach the target; null when not applicable. */
  requiredPerDay: number | null;
  /** Average per day over the last 7 venue-local days. */
  recentPerDay: number | null;
  source: "manual";
}

export interface ShowCard {
  id: string;
  name: string;
  performanceStartUtc: string | null;
  venueTimezone: string;
  phase: "upcoming" | "today" | "past" | "unscheduled";
  /** Whole venue-local days until the performance date (0 = today). */
  daysUntil: number | null;
  provider: string;
  mode: "live" | "fixture";
  currency: string | null;
  otherCurrencies: string[];
  tickets: { paid: number; comp: number; refunded: number; partial: boolean } | null;
  revenue: { grossAfterRefunds: Measure; organizerProceeds: Measure } | null;
  pace: {
    /** Last 14 venue-local days ending today, zero-filled. */
    days: DailySales[];
    last7DaysPaidTickets: number;
    last7DaysGrossAfterRefundsMinor: MinorUnits | null;
    previous7DaysPaidTickets: number;
  } | null;
  targets: TargetProgress[];
  freshness: { connectionStatus: string; stale: boolean; dataAsOf: string | null; ageHours: number | null };
  attention: AttentionItem[];
}

export const TARGET_LABELS: Record<TargetMeasure, string> = {
  paidTickets: "Paid tickets",
  grossAfterRefunds: "Gross after refunds",
  organizerProceeds: "Organizer proceeds",
};

const DAY = 86400_000;
const SEVERITY_RANK: Record<AttentionSeverity, number> = { error: 0, warning: 1, info: 2 };

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayDiff(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY);
}

export function buildShowCard(input: ShowInput, now: Date, opts: { staleAfterHours?: number } = {}): ShowCard {
  const staleAfterHours = opts.staleAfterHours ?? 24;
  const tz = input.venueTimezone;
  const today = localDate(now, tz);
  const attention: AttentionItem[] = [];

  let phase: ShowCard["phase"] = "unscheduled";
  let daysUntil: number | null = null;
  if (input.performanceStartUtc) {
    daysUntil = dayDiff(today, localDate(input.performanceStartUtc, tz));
    phase = daysUntil > 0 ? "upcoming" : daysUntil === 0 ? "today" : "past";
  }

  // Primary currency: the one with the most paid tickets.
  const currencies = [...(input.revenue?.currencies ?? [])].sort((a, b) => b.tickets.paid - a.tickets.paid);
  const primary = currencies[0] ?? null;
  if (currencies.length > 1) {
    attention.push({
      code: "multiple_currencies", severity: "info", title: "Sales in more than one currency",
      detail: `This card shows ${primary!.currency}. Other currencies (${currencies.slice(1).map((c) => c.currency).join(", ")}) are listed separately on desktop and never added together.`,
    });
  }

  // Connection and freshness.
  const ageHours = input.dataAsOf ? Math.floor((now.getTime() - Date.parse(input.dataAsOf)) / 3600_000) : null;
  if (input.connectionStatus === "not_configured") {
    attention.push({ code: "not_configured", severity: "error", title: "Source not configured", detail: input.connectionAction ?? "Add the source credential on the server." });
  } else if (input.stale) {
    attention.push({ code: "stale", severity: "warning", title: "Last refresh failed — figures may be out of date", detail: input.connectionAction ?? `Error: ${input.connectionStatusKind ?? "unknown"}.` });
  } else if (input.connectionStatus === "error") {
    attention.push({ code: "sync_error", severity: "error", title: "Source read failed", detail: input.connectionAction ?? `Error: ${input.connectionStatusKind ?? "unknown"}.` });
  }
  if (!input.revenue && input.connectionStatus !== "not_configured" && input.connectionStatus !== "error") {
    attention.push({ code: "never_synced", severity: "info", title: "No data yet", detail: "Run Refresh to read this show for the first time." });
  } else if (ageHours !== null && ageHours >= staleAfterHours && phase !== "past") {
    attention.push({ code: "not_refreshed_recently", severity: "info", title: `Not refreshed for ${ageHours >= 48 ? `${Math.floor(ageHours / 24)} days` : `${ageHours} hours`}`, detail: "Figures are from the last refresh. Refresh to update." });
  }

  // Data quality.
  const unexplained = [...(primary?.reconciliation ?? []), ...(input.reportComparison ?? [])].filter((r) => !r.explained);
  if (unexplained.length > 0) {
    attention.push({ code: "reconciliation_difference", severity: "warning", title: `${unexplained.length} reconciliation difference${unexplained.length > 1 ? "s" : ""}`, detail: unexplained.map((r) => r.label).join("; ") });
  }
  const reviewable = (input.revenue?.exceptions ?? []).filter((e) => e.severity !== "info");
  if (reviewable.length > 0) {
    attention.push({ code: "review_exceptions", severity: reviewable.some((e) => e.severity === "error") ? "error" : "info", title: `${reviewable.length} record${reviewable.length > 1 ? "s" : ""} to review`, detail: "Refunds, status changes or mismatches flagged during reconciliation. Details on desktop." });
  }
  if (primary?.tickets.partial) {
    attention.push({ code: "counts_partial", severity: "warning", title: "Ticket counts incomplete", detail: "Some orders arrived without ticket detail." });
  }

  // Pace over the last 14 venue-local days.
  let pace: ShowCard["pace"] = null;
  if (primary) {
    const byDate = new Map(primary.dailySales.map((d) => [d.date, d]));
    const days: DailySales[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = addDays(today, -i);
      days.push(byDate.get(date) ?? { date, paidTickets: 0, grossAfterRefundsMinor: 0 });
    }
    const last7 = days.slice(7);
    const prev7 = days.slice(0, 7);
    pace = {
      days,
      last7DaysPaidTickets: last7.reduce((a, d) => a + d.paidTickets, 0),
      last7DaysGrossAfterRefundsMinor: last7.reduce<number | null>((a, d) => (a === null || d.grossAfterRefundsMinor === null ? null : addMinor(a, d.grossAfterRefundsMinor)), 0),
      previous7DaysPaidTickets: prev7.reduce((a, d) => a + d.paidTickets, 0),
    };
  }

  // Targets (plan values, compared against actuals — never added to them).
  const targets: TargetProgress[] = input.targets.map((t) => {
    const unit = t.measure === "paidTickets" ? "count" : "money";
    let actual: number | null = null;
    let actualStatus: MeasureStatus = "unavailable";
    let recentPerDay: number | null = null;
    const cur = t.currency ? currencies.find((c) => c.currency === t.currency) : primary;
    if (t.measure === "paidTickets" && primary) {
      actual = currencies.reduce((a, c) => a + c.tickets.paid, 0);
      actualStatus = primary.tickets.partial ? "partial" : "complete";
      recentPerDay = pace ? pace.last7DaysPaidTickets / 7 : null;
    } else if (cur && t.measure !== "paidTickets") {
      const m = cur.measures[t.measure];
      actual = m.minor;
      actualStatus = m.status;
      if (t.measure === "grossAfterRefunds" && cur === primary && pace?.last7DaysGrossAfterRefundsMinor != null) {
        recentPerDay = pace.last7DaysGrossAfterRefundsMinor / 7;
      }
    }
    const percent = actual !== null && t.value > 0 ? Math.floor((actual * 100) / t.value) : null;
    let status: TargetStatus = "unknown";
    let requiredPerDay: number | null = null;
    if (actual !== null && actualStatus !== "unavailable") {
      if (actual >= t.value) status = "met";
      else if (phase === "past") status = "missed";
      else if (phase === "upcoming" && daysUntil !== null) {
        requiredPerDay = (t.value - actual) / daysUntil;
        status = recentPerDay === null ? "unknown" : recentPerDay >= requiredPerDay ? "on_track" : "behind";
      } else if (phase === "today") status = "behind";
    }
    if (status === "behind") {
      attention.push({
        code: "behind_target", severity: "warning", title: `Behind ${TARGET_LABELS[t.measure].toLowerCase()} target`,
        detail: requiredPerDay !== null && recentPerDay !== null
          ? `Needs about ${fmtRate(requiredPerDay, unit, t.currency)}/day for ${daysUntil} days; last 7 days averaged ${fmtRate(recentPerDay, unit, t.currency)}/day. Simple run-rate comparison, not a forecast.`
          : "Target not yet reached on the day of the show.",
      });
    }
    return { measure: t.measure, label: TARGET_LABELS[t.measure], unit, currency: t.currency, target: t.value, actual, actualStatus, percent, status, requiredPerDay, recentPerDay, source: t.source };
  });

  attention.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    id: input.id,
    name: input.name,
    performanceStartUtc: input.performanceStartUtc,
    venueTimezone: tz,
    phase,
    daysUntil,
    provider: input.provider,
    mode: input.mode,
    currency: primary?.currency ?? null,
    otherCurrencies: currencies.slice(1).map((c) => c.currency),
    tickets: primary ? { paid: currencies.reduce((a, c) => a + c.tickets.paid, 0), comp: currencies.reduce((a, c) => a + c.tickets.comp, 0), refunded: currencies.reduce((a, c) => a + c.tickets.refunded, 0), partial: currencies.some((c) => c.tickets.partial) } : null,
    revenue: primary ? { grossAfterRefunds: primary.measures.grossAfterRefunds, organizerProceeds: primary.measures.organizerProceeds } : null,
    pace,
    targets,
    freshness: { connectionStatus: input.connectionStatus, stale: input.stale, dataAsOf: input.dataAsOf, ageHours },
    attention,
  };
}

function fmtRate(v: number, unit: "count" | "money", currency: string | null): string {
  if (unit === "count") return (Math.round(v * 10) / 10).toString();
  // Rates are display-only; money totals are never derived from them.
  const scale = currency ? currencyScale(currency) : 2;
  return `${Math.round(v / 10 ** scale)} ${currency ?? ""}`.trim();
}

export interface OrgPulse {
  generatedAt: string;
  summary: {
    upcomingShows: number;
    showsNeedingAttention: number;
    paidTicketsLast7Days: number;
    /** Upcoming (incl. today) shows' gross after refunds, per currency. */
    upcomingGrossByCurrency: { currency: string; minor: MinorUnits | null; status: MeasureStatus }[];
  };
  shows: ShowCard[];
}

/** Sort: today, upcoming soonest first, unscheduled, then past most recent first. */
export function buildOrgPulse(inputs: ShowInput[], now: Date): OrgPulse {
  const cards = inputs.map((i) => buildShowCard(i, now));
  const rank = (c: ShowCard) => (c.phase === "today" ? 0 : c.phase === "upcoming" ? 1 : c.phase === "unscheduled" ? 2 : 3);
  cards.sort((a, b) => rank(a) - rank(b) || (a.phase === "past" ? (b.daysUntil ?? 0) - (a.daysUntil ?? 0) : (a.daysUntil ?? 0) - (b.daysUntil ?? 0)));

  const gross = new Map<string, { minor: number | null; status: MeasureStatus }>();
  for (const c of cards) {
    if ((c.phase !== "upcoming" && c.phase !== "today") || !c.revenue || !c.currency) continue;
    const m = c.revenue.grossAfterRefunds;
    const prev = gross.get(c.currency) ?? { minor: 0, status: "complete" as MeasureStatus };
    const minor = prev.minor === null || m.minor === null ? null : addMinor(prev.minor, m.minor);
    const status: MeasureStatus = m.status === "unavailable" || prev.status === "unavailable" ? "unavailable" : m.status === "partial" || prev.status === "partial" ? "partial" : "complete";
    gross.set(c.currency, { minor: status === "unavailable" ? null : minor, status });
  }
  return {
    generatedAt: now.toISOString(),
    summary: {
      upcomingShows: cards.filter((c) => c.phase === "upcoming" || c.phase === "today").length,
      showsNeedingAttention: cards.filter((c) => c.attention.some((a) => a.severity !== "info")).length,
      paidTicketsLast7Days: cards.reduce((a, c) => a + (c.pace?.last7DaysPaidTickets ?? 0), 0),
      upcomingGrossByCurrency: [...gross.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, ...v })),
    },
    shows: cards,
  };
}
