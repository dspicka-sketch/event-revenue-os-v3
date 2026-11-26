// HTTP API contract shared by the server, the desktop web client and the
// mobile client. Dates are ISO-8601 strings on the wire.

import type { UnderplayEstimate, UnderplayRules } from "../domain/underplay.js";
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

// ---- AutoRev underplay discovery (D19)

export type CandidateOriginDto = "watchlist" | "small_room";
export type CandidateStageDto =
  | "research" | "representation_identified" | "initial_outreach" | "conversation_started" | "routing_discussion"
  | "offer_submitted" | "negotiation" | "booked" | "repeat_artist" | "long_term_relationship";

export interface CandidateDto {
  id: string;
  artist: string;
  origin: CandidateOriginDto;
  stage: CandidateStageDto;
  dismissed: boolean;
  /** Sum of plain signals. The weights are an unapproved starting proposal (see `method`). */
  score: number;
  reasons: string[];
  /** The act's soonest qualifying area show when last seen. */
  anchor: { headliner: string; venueName: string; city: string; venueCapacity: number | null; startsAt: string; status: string; ticketUrl: string | null };
  /**
   * Deal estimate for a booking prospect (D20): what the owner's underplay model needs against what fans may pay.
   * An estimate only, never revenue or a settlement. Null when the act was found as support on another act's show.
   */
  underplay: UnderplayEstimate | null;
  /** Whole days from the server's clock until the anchor show starts. */
  daysUntilShow: number;
  /** Under 30 days out: logistics are tight. A flag only; it never hides or down-ranks a candidate. */
  shortLead: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  stageChangedAt: string | null;
  notes: string | null;
}

export interface DiscoveryResponse {
  /** Scoring method version, e.g. "discovery v0.4". */
  method: string;
  candidates: CandidateDto[];
  /** The rules behind every candidate's deal estimate, so clients state the model and its assumptions without re-deriving them. */
  underplayModel: UnderplayRules;
}
