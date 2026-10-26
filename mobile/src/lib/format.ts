// Display helpers. Money formatting itself comes from the shared domain module.
import { formatMoney, formatMoneyCompact, type Measure } from "@revos/domain/money";
import type { ShowCard } from "@revos/domain/pulse";

export { formatMoney, formatMoneyCompact };

export function showDate(iso: string | null, timeZone: string): string {
  if (!iso) return "Date not set";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function whenLabel(card: Pick<ShowCard, "phase" | "daysUntil">): string {
  if (card.phase === "today") return "Tonight";
  if (card.phase === "unscheduled" || card.daysUntil === null) return "Unscheduled";
  if (card.phase === "past") return card.daysUntil === -1 ? "Yesterday" : `${-card.daysUntil} days ago`;
  return card.daysUntil === 1 ? "Tomorrow" : `In ${card.daysUntil} days`;
}

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Compact measure for glance surfaces; never shows a number for an unavailable measure. */
export function measureCompact(m: Measure | undefined, currency: string | null): string {
  if (!m || m.status === "unavailable" || m.minor === null || !currency) return "Unavailable";
  return formatMoneyCompact(m.minor, currency) + (m.status === "partial" ? "*" : "");
}
