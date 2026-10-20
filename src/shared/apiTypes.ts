// HTTP API contract shared by the server, the desktop web client and the
// mobile client. Dates are ISO-8601 strings on the wire.

import type { MeasureStatus } from "../domain/money.js";
import type { OrgPulse, ShowCard, Target, TargetMeasure } from "../domain/pulse.js";
import type { EventRevenue, ReconciliationRow, SourceReportFigures } from "../domain/revenue.js";

export type { OrgPulse, ShowCard, Target, TargetMeasure, MeasureStatus };

export type Role = "admin" | "viewer";

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  is_fixture: boolean;
  role: Role;
}

export interface LoginRequest {
  email: string;
  password: string;
  client: "web" | "mobile";
}
export interface LoginResponse {
  token: string;
  expiresAt: string;
}
export interface MeResponse {
  user: { id: string; email: string; displayName: string | null };
  organizations: Organization[];
}

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
  targets: Target[];
}

export interface EventsResponse {
  organization: Organization;
  events: EventDto[];
}

export interface EventDetailResponse {
  organization: Organization;
  event: EventDto;
  card: ShowCard;
  syncRuns: SyncRun[];
  ticketClasses: { ticket_class_name: string | null; currency: string; status: string; quantity: number; gross_minor: number | null; unknown_gross: number }[];
  definitions: Record<string, { label: string; definition: string }>;
}

export interface PulseResponse extends OrgPulse {
  organization: Organization;
}

export interface ConnectionDto {
  id: string;
  provider: string;
  providerAccountId: string;
  mode: "live" | "fixture";
  status: string;
  statusKind: string | null;
  statusDetail: string | null;
  action: string | null;
  /** Whether the server has the secret this connection references. Never the value. */
  secretPresent: boolean | null;
  secretRef: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  proceedsPolicy: string;
  mappedEvents: number;
  lastRunStatus: string | null;
  lastRunAt: string | null;
}

export interface ConnectionsResponse {
  organization: Organization;
  connections: ConnectionDto[];
  /** Integrations on the roadmap that are not yet available. */
  planned: { provider: string; label: string; milestone: string; role: string }[];
}

export interface RefreshResponse {
  ok: boolean;
  runId: string | null;
  kind?: string;
  message?: string;
  action?: string;
}

export interface TargetRequest {
  measure: TargetMeasure;
  /** Ticket count, or minor units of `currency` for money measures. */
  value: number;
  currency: string | null;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  action?: string;
}
