// Read-only reader for Bay Shows, the owner's Bay Area concert database
// (Supabase project of the waxpoetic-bay-ahows repo). It uses the project's
// public REST endpoint with the publishable key; `events` and `venues` allow
// public read by row-level-security policy. Nothing is ever written.
// Evidence: docs/integrations.md → Bay Shows.

import type { AreaShow, AreaShowStatus } from "../../domain/discovery.js";
import { ProviderError } from "../errors.js";

const SELECT = "source_id,headliner,support,venue_name,city,starts_at,genre,price_min,status,ticket_url,venues(capacity)";
const STATUSES: AreaShowStatus[] = ["onsale", "low", "soldout", "cancelled", "postponed"];

export interface FetchAreaShowsOptions {
  /** Project API URL, e.g. https://<ref>.supabase.co */
  url: string;
  /** Publishable key. Public by design, still kept in the server environment. */
  key: string;
  now: Date;
  windowDays: number;
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
}

interface Row {
  source_id?: unknown; headliner?: unknown; support?: unknown; venue_name?: unknown; city?: unknown; starts_at?: unknown;
  genre?: unknown; price_min?: unknown; status?: unknown; ticket_url?: unknown; venues?: { capacity?: unknown } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function toShow(r: Row): AreaShow | null {
  const id = str(r.source_id), headliner = str(r.headliner), venueName = str(r.venue_name), startsAt = str(r.starts_at);
  if (!id || !headliner || !venueName || !startsAt) return null;
  const status = STATUSES.includes(r.status as AreaShowStatus) ? (r.status as AreaShowStatus) : "postponed";
  return {
    sourceEventId: id, headliner, support: Array.isArray(r.support) ? r.support.filter((s): s is string => typeof s === "string") : [],
    venueName, city: str(r.city) ?? "", venueCapacity: num(r.venues?.capacity), startsAt, genre: str(r.genre),
    priceMin: num(r.price_min), status, ticketUrl: str(r.ticket_url),
  };
}

export async function fetchAreaShows(opts: FetchAreaShowsOptions): Promise<AreaShow[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 10;
  const from = opts.now.toISOString();
  const to = new Date(opts.now.getTime() + opts.windowDays * 86400_000).toISOString();
  const out: AreaShow[] = [];
  for (let page = 0; ; page++) {
    if (page >= maxPages) throw new ProviderError("limit_exceeded", `Bay Shows returned more than ${maxPages * pageSize} shows in the window.`);
    const u = new URL("/rest/v1/events", opts.url);
    u.searchParams.set("select", SELECT);
    u.searchParams.append("starts_at", `gte.${from}`);
    u.searchParams.append("starts_at", `lte.${to}`);
    u.searchParams.set("order", "starts_at.asc,id.asc");
    u.searchParams.set("limit", String(pageSize));
    u.searchParams.set("offset", String(page * pageSize));
    let res: Response;
    try {
      res = await doFetch(u, { headers: { apikey: opts.key, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ProviderError("network", "Bay Shows could not be reached.");
    }
    if (!res.ok) {
      const kind = res.status === 401 ? "auth" : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "server" : "bad_response";
      throw new ProviderError(kind, `Bay Shows answered HTTP ${res.status}.`, res.status);
    }
    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body)) throw new ProviderError("bad_response", "Bay Shows did not return a list of events.");
    for (const r of body as Row[]) {
      const s = toShow(r);
      if (s) out.push(s);
    }
    if (body.length < pageSize) return out;
  }
}
