// HTTP API contract shared by the server, the desktop web client and the
// mobile client. Dates are ISO-8601 strings on the wire.

import type { MeasureStatus } from "../domain/money.js";
import type { OrgDriver, OrgMarketing, OrgPulse, ShowCard, Target, TargetMeasure } from "../domain/pulse.js";
import type { EventRevenue, ReconciliationRow, SourceReportFigures } from "../domain/revenue.js";
import type { DriverRow, MarketingSummary } from "../domain/marketing.js";

export type { OrgDriver, OrgMarketing, OrgPulse, ShowCard, Target, TargetMeasure, MeasureStatus, MarketingSummary, DriverRow };

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
  /** "What's driving sales" (D13), all sales to date; null until the show has sales data. */
  marketing: MarketingSummary | null;
  /** The same, counting only orders placed in the last 7 days (no spend in this view). */
  marketingLast7Days: MarketingSummary | null;
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
  /** Whether "Summarize with AI" is offered for this show (D17). */
  insight: InsightAvailability;
}

/** Whether the server can write AI summaries (D17). Never carries the key, only its presence. */
export interface InsightAvailability {
  available: boolean;
  provider: "gemini" | null;
  model: string | null;
}

/**
 * An AI-written description of one show's figures (D17). `text` is narrative
 * for people to read; clients label it as AI-generated and never parse it into
 * money or counts. `basis` is exactly what the model was given.
 */
export interface ShowInsightResponse {
  configured: boolean;
  provider: "gemini" | null;
  model: string | null;
  text: string | null;
  basis: string | null;
  generatedAt: string | null;
  /** True when the same figures were summarized before and the earlier text was reused. */
  cached: boolean;
  /** The data snapshot the figures came from. */
  dataAsOf: string | null;
  fixture: boolean;
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
  /** Campaigns stored for a marketing connection. */
  campaigns: number;
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
  /** Marketing sources refreshed alongside the show. A failure here does not fail the show refresh. */
  marketing?: { provider: string; ok: boolean; kind?: string; message?: string }[];
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
