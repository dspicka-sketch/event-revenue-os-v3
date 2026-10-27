// Mailchimp campaign reports -> NormalizedCampaign. Only campaign-level
// aggregates are read; subscriber-level data (emails, member activity) is never
// requested or stored.

import type { NormalizedCampaign } from "../../domain/types.js";
import { cleanTrackingCode } from "../eventbrite/normalize.js";

export interface McReport {
  id: string;
  campaign_title?: string | null;
  subject_line?: string | null;
  emails_sent?: number | null;
  send_time?: string | null;
  opens?: { unique_opens?: number | null } | null;
}

export interface McClickedUrl {
  url: string;
  total_clicks?: number | null;
  unique_clicks?: number | null;
}

/**
 * Find an Eventbrite event and its tracking code in a link URL.
 * Real event URLs end in the numeric event ID (".../e/some-name-tickets-123456789012");
 * fixture IDs look like "fx-1001".
 */
export function parseEventbriteLink(raw: string): { sourceEventId: string; trackingCode: string | null } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/(^|\.)eventbrite\.[a-z.]+$/i.test(u.hostname)) return null;
  const m = u.pathname.replace(/\/+$/, "").match(/\/e\/(?:.*?-)?((?:fx-)?\d+)$/);
  if (!m) return null;
  return { sourceEventId: m[1]!, trackingCode: cleanTrackingCode(u.searchParams.get("aff")) };
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function normalizeCampaign(r: McReport, clicked: McClickedUrl[]): NormalizedCampaign {
  const links = new Map<string, NormalizedCampaign["eventLinks"][number]>();
  for (const c of clicked) {
    const parsed = parseEventbriteLink(c.url);
    if (!parsed) continue;
    const key = `${parsed.sourceEventId}|${parsed.trackingCode ?? ""}`;
    const prev = links.get(key) ?? { provider: "eventbrite" as const, ...parsed, uniqueClicks: 0, totalClicks: 0 };
    // Summed per distinct link: one person clicking two links to the same event counts twice.
    const uc = int(c.unique_clicks);
    const tc = int(c.total_clicks);
    prev.uniqueClicks = prev.uniqueClicks === null || uc === null ? null : prev.uniqueClicks + uc;
    prev.totalClicks = prev.totalClicks === null || tc === null ? null : prev.totalClicks + tc;
    links.set(key, prev);
  }
  const sent = r.send_time && !Number.isNaN(Date.parse(r.send_time)) ? new Date(r.send_time).toISOString() : null;
  return {
    sourceId: String(r.id),
    title: (r.campaign_title || r.subject_line || `Campaign ${r.id}`).slice(0, 200),
    sentAt: sent,
    emailsSent: int(r.emails_sent),
    uniqueOpens: int(r.opens?.unique_opens),
    eventLinks: [...links.values()],
  };
}
