// Browser API client. Talks only to the RevOS server; never to vendor APIs.
import type { EventRevenue, ReconciliationRow, SourceReportFigures } from "../domain/revenue.js";

const TOKEN_KEY = "revos.accessToken";

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.message ?? body.error ?? `HTTP ${status}`));
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface Organization { id: string; name: string; timezone: string; is_fixture: boolean }

export interface SyncRun {
  id: string; started_at: string; finished_at: string | null; status: string; error_kind: string | null; error_message: string | null;
  pages_fetched: number | null; requests_made: number | null; orders_seen: number | null; lines_seen: number | null;
  orders_inserted: number | null; orders_updated: number | null; orders_missing: number | null;
}

export interface EventDto {
  id: string;
  name: string;
  performanceStartUtc: string | null;
  venueTimezone: string;
  source: { provider: string; providerAccountId: string; sourceEventId: string; sourceName: string | null; sourceUpdatedAt: string | null };
  connection: {
    id: string; mode: "live" | "fixture"; status: string; statusKind: string | null; statusDetail: string | null; action: string | null;
    lastAttemptAt: string | null; lastSuccessAt: string | null; proceedsPolicy: string;
  };
  freshness: { hasData: boolean; stale: boolean; dataAsOf: string | null; latestRun: SyncRun | null };
  revenue: EventRevenue | null;
  sourceReport: SourceReportFigures | null;
  reportComparison: ReconciliationRow[] | null;
}

export interface EventDetail {
  organization: Organization;
  event: EventDto;
  syncRuns: SyncRun[];
  ticketClasses: { ticket_class_name: string | null; currency: string; status: string; quantity: number; gross_minor: number | null; unknown_gross: number }[];
  definitions: Record<string, { label: string; definition: string }>;
}

export const api = {
  health: () => call<{ ok: boolean; authRequired: boolean }>("/api/health"),
  orgs: () => call<{ organizations: Organization[] }>("/api/orgs"),
  events: (orgId: string) => call<{ organization: Organization; events: EventDto[] }>(`/api/orgs/${orgId}/events`),
  event: (orgId: string, eventId: string) => call<EventDetail>(`/api/orgs/${orgId}/events/${eventId}`),
  refresh: (orgId: string, eventId: string) => call<{ ok: true }>(`/api/orgs/${orgId}/events/${eventId}/refresh`, { method: "POST" }),
};
