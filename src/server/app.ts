// HTTP API shared by the desktop web client and the mobile client. Every
// tenant route checks the caller's membership in the organization in the path.

import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { authenticate, listMemberOrganizations, login, LoginThrottle, logout, roleIn, type AuthedUser, type Role } from "../auth/accounts.js";
import type { Db } from "../db/pool.js";
import {
  deleteTarget, getEventSummary, getConnection, getOrganization, listConnections, listEventSummaries, listSyncRuns, listTargets,
  ticketClassBreakdown, upsertTarget, type EventSummaryRow, type TargetRow,
} from "../db/repo.js";
import { buildOrgPulse, buildShowCard, type ShowInput, type Target } from "../domain/pulse.js";
import { MEASURE_DEFINITIONS } from "../domain/revenue.js";
import { actionFor, ProviderError } from "../providers/errors.js";
import type {
  ConnectionsResponse, EventDetailResponse, EventDto, EventsResponse, LoginResponse, MeResponse, Organization, PulseResponse, RefreshResponse,
} from "../shared/apiTypes.js";
import { syncEvent, type AdapterFactory, defaultAdapterFactory } from "../sync/syncEvent.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEASURES = new Set(["paidTickets", "grossAfterRefunds", "organizerProceeds"]);

/** Integrations on the roadmap, shown on the integrations page as not yet available. */
export const PLANNED_INTEGRATIONS: ConnectionsResponse["planned"] = [
  { provider: "mailchimp", label: "Mailchimp", milestone: "M2", role: "Email campaign reporting" },
  { provider: "wordpress_ga4", label: "WordPress + GA4", milestone: "M3", role: "Website funnel" },
  { provider: "klaviyo", label: "Klaviyo", milestone: "M4", role: "SMS / fan engagement" },
  { provider: "airtable", label: "Airtable", milestone: "M5", role: "Show plan, targets and budgets" },
  { provider: "ticket_evolution", label: "Ticket Evolution", milestone: "M6", role: "Resale / distribution" },
];

export interface AppOptions {
  db: Db;
  adapterFactory?: AdapterFactory;
  webDir?: string;
  logger?: boolean;
  now?: () => Date;
  /**
   * Browser origins allowed to call the API cross-origin (e.g. the mobile web
   * preview). Native mobile apps do not need CORS. Empty = same-origin only.
   */
  corsOrigins?: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : new Date(d).toISOString());

function targetsFor(rows: TargetRow[], eventId: string): Target[] {
  return rows
    .filter((t) => t.canonical_event_id === eventId)
    .map((t) => ({ measure: t.measure, value: t.target_value, currency: t.currency, source: t.source, updatedAt: iso(t.updated_at) }));
}

function eventDto(r: EventSummaryRow, targets: Target[]): EventDto {
  const latestRun = r.latest_run;
  const hasData = r.latest_result !== null;
  // Stale: there is retained data but the most recent attempt failed.
  const stale = hasData && latestRun !== null && latestRun.status === "failed";
  return {
    id: r.id,
    name: r.name,
    performanceStartUtc: iso(r.performance_start_utc ?? r.source_start_utc),
    venueTimezone: r.venue_timezone,
    source: {
      provider: r.provider,
      providerAccountId: r.provider_account_id,
      sourceEventId: r.source_event_id,
      sourceName: r.source_name,
      sourceUpdatedAt: iso(r.source_updated_at),
    },
    connection: {
      id: r.connection_id,
      mode: r.connection_mode,
      status: r.connection_status,
      statusKind: r.connection_status_kind,
      statusDetail: r.connection_status_detail,
      action: r.connection_status_kind ? actionFor(r.connection_status_kind) : null,
      lastAttemptAt: iso(r.last_attempt_at),
      lastSuccessAt: iso(r.last_success_at),
      proceedsPolicy: r.proceeds_policy,
    },
    freshness: { hasData, stale, dataAsOf: iso(r.latest_result_at), latestRun: latestRun as unknown as EventDto["freshness"]["latestRun"] },
    revenue: r.latest_result,
    sourceReport: r.source_report,
    reportComparison: r.report_comparison,
    targets,
  };
}

function showInput(e: EventDto): ShowInput {
  return {
    id: e.id,
    name: e.source.sourceName ?? e.name,
    performanceStartUtc: e.performanceStartUtc,
    venueTimezone: e.venueTimezone,
    provider: e.source.provider,
    mode: e.connection.mode,
    connectionStatus: e.freshness.stale ? "stale" : e.connection.status,
    connectionStatusKind: e.connection.statusKind,
    connectionAction: e.connection.action,
    stale: e.freshness.stale,
    dataAsOf: e.freshness.dataAsOf,
    revenue: e.revenue,
    reportComparison: e.reportComparison,
    targets: e.targets,
  };
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ? { redact: ["req.headers.authorization"] } : false, trustProxy: false });
  const { db } = opts;
  const factory = opts.adapterFactory ?? defaultAdapterFactory;
  const now = opts.now ?? (() => new Date());
  const throttle = new LoginThrottle();

  if (opts.corsOrigins?.length) {
    // Bearer tokens only (no cookies), so credentials mode is not needed.
    await app.register(fastifyCors, { origin: opts.corsOrigins, methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Authorization", "Content-Type"] });
  }

  // ---- authentication (same bearer sessions for web and mobile)
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.method === "OPTIONS") return;
    if (req.url === "/api/health" || req.url === "/api/auth/login") return;
    const h = req.headers.authorization ?? "";
    const user = h.startsWith("Bearer ") ? await authenticate(db, h.slice(7)) : null;
    if (!user) return reply.code(401).send({ error: "unauthorized", message: "Sign in required." });
    req.user = user;
  });

  /** Resolve the org from the path and the caller's role; 404 for non-members (no existence leak). */
  async function orgFor(req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply, need: Role = "viewer"): Promise<Organization | null> {
    const { orgId } = req.params;
    if (!UUID.test(orgId)) { reply.code(404).send({ error: "not_found" }); return null; }
    const role = await roleIn(db, req.user!.userId, orgId);
    const org = role ? await getOrganization(db, orgId) : null;
    if (!org || !role) { reply.code(404).send({ error: "not_found" }); return null; }
    if (need === "admin" && role !== "admin") { reply.code(403).send({ error: "forbidden", message: "Admin role required." }); return null; }
    return { ...org, role };
  }

  app.get("/api/health", async () => ({ ok: true }));

  app.post<{ Body: { email?: unknown; password?: unknown; client?: unknown } }>("/api/auth/login", async (req, reply) => {
    const { email, password, client } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || email.length > 320 || password.length > 512) {
      return reply.code(400).send({ error: "bad_request", message: "Email and password are required." });
    }
    const key = `${email.toLowerCase()}|${req.ip}`;
    if (throttle.blocked(key)) return reply.code(429).send({ error: "too_many_attempts", message: "Too many failed sign-in attempts. Try again in 15 minutes." });
    const result = await login(db, email, password, client === "mobile" ? "mobile" : "web");
    if (!result) {
      throttle.fail(key);
      return reply.code(401).send({ error: "invalid_credentials", message: "Email or password is incorrect." });
    }
    throttle.succeed(key);
    return { token: result.token, expiresAt: result.expiresAt.toISOString() } satisfies LoginResponse;
  });

  app.post("/api/auth/logout", async (req) => {
    await logout(db, req.user!.sessionId);
    return { ok: true };
  });

  app.get("/api/me", async (req): Promise<MeResponse> => ({
    user: { id: req.user!.userId, email: req.user!.email, displayName: req.user!.displayName },
    organizations: await listMemberOrganizations(db, req.user!.userId),
  }));

  // ---- shows

  async function loadEvents(orgId: string): Promise<EventDto[]> {
    const [rows, targets] = await Promise.all([listEventSummaries(db, orgId), listTargets(db, orgId)]);
    return rows.map((r) => eventDto(r, targetsFor(targets, r.id)));
  }

  app.get<{ Params: { orgId: string } }>("/api/orgs/:orgId/pulse", async (req, reply) => {
    const org = await orgFor(req, reply);
    if (!org) return;
    const events = await loadEvents(org.id);
    return { organization: org, ...buildOrgPulse(events.map(showInput), now()) } satisfies PulseResponse;
  });

  app.get<{ Params: { orgId: string } }>("/api/orgs/:orgId/events", async (req, reply) => {
    const org = await orgFor(req, reply);
    if (!org) return;
    return { organization: org, events: await loadEvents(org.id) } satisfies EventsResponse;
  });

  app.get<{ Params: { orgId: string; eventId: string } }>("/api/orgs/:orgId/events/:eventId", async (req, reply) => {
    const org = await orgFor(req, reply);
    if (!org) return;
    const { eventId } = req.params;
    const row = UUID.test(eventId) ? await getEventSummary(db, org.id, eventId) : null;
    if (!row) return reply.code(404).send({ error: "not_found" });
    const event = eventDto(row, targetsFor(await listTargets(db, org.id), eventId));
    return {
      organization: org,
      event,
      card: buildShowCard(showInput(event), now()),
      syncRuns: (await listSyncRuns(db, org.id, eventId)) as unknown as EventDetailResponse["syncRuns"],
      ticketClasses: await ticketClassBreakdown(db, org.id, eventId),
      definitions: MEASURE_DEFINITIONS,
    } satisfies EventDetailResponse;
  });

  app.post<{ Params: { orgId: string; eventId: string } }>("/api/orgs/:orgId/events/:eventId/refresh", async (req, reply) => {
    const org = await orgFor(req, reply);
    if (!org) return;
    const { eventId } = req.params;
    if (!UUID.test(eventId)) return reply.code(404).send({ error: "not_found" });
    const out = await syncEvent(db, org.id, eventId, factory);
    if (out.ok) return { ok: true, runId: out.runId } satisfies RefreshResponse;
    const code = out.kind === "not_found" && !out.runId ? 404 : out.kind === "busy" ? 409 : 502;
    return reply.code(code).send({ ok: false, runId: out.runId, kind: out.kind, message: out.message, action: actionFor(out.kind) } satisfies RefreshResponse);
  });

  // ---- targets (plan values; admin only)

  app.put<{ Params: { orgId: string; eventId: string }; Body: { measure?: unknown; value?: unknown; currency?: unknown } }>(
    "/api/orgs/:orgId/events/:eventId/targets",
    async (req, reply) => {
      const org = await orgFor(req, reply, "admin");
      if (!org) return;
      const { eventId } = req.params;
      if (!UUID.test(eventId) || !(await getEventSummary(db, org.id, eventId))) return reply.code(404).send({ error: "not_found" });
      const { measure, value, currency } = req.body ?? {};
      if (typeof measure !== "string" || !MEASURES.has(measure)) return reply.code(400).send({ error: "bad_request", message: "Unknown target measure." });
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return reply.code(400).send({ error: "bad_request", message: "Target must be a non-negative integer (tickets, or minor units such as cents)." });
      }
      const isCount = measure === "paidTickets";
      if (isCount ? currency !== null && currency !== undefined : typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
        return reply.code(400).send({ error: "bad_request", message: isCount ? "Ticket targets have no currency." : "Money targets need a 3-letter currency." });
      }
      await upsertTarget(db, org.id, eventId, { measure: measure as Target["measure"], value, currency: isCount ? null : (currency as string).toUpperCase() }, req.user!.userId);
      return { ok: true };
    },
  );

  app.delete<{ Params: { orgId: string; eventId: string; measure: string } }>("/api/orgs/:orgId/events/:eventId/targets/:measure", async (req, reply) => {
    const org = await orgFor(req, reply, "admin");
    if (!org) return;
    if (!UUID.test(req.params.eventId) || !MEASURES.has(req.params.measure)) return reply.code(404).send({ error: "not_found" });
    await deleteTarget(db, org.id, req.params.eventId, req.params.measure);
    return { ok: true };
  });

  // ---- integrations

  app.get<{ Params: { orgId: string } }>("/api/orgs/:orgId/connections", async (req, reply) => {
    const org = await orgFor(req, reply);
    if (!org) return;
    const rows = await listConnections(db, org.id);
    return {
      organization: org,
      connections: rows.map((c) => ({
        id: c.id,
        provider: c.provider,
        providerAccountId: c.provider_account_id,
        mode: c.mode,
        status: c.status,
        statusKind: c.status_kind,
        statusDetail: c.status_detail,
        action: c.status_kind ? actionFor(c.status_kind) : null,
        secretPresent: c.mode === "fixture" ? null : Boolean(c.secret_ref && process.env[c.secret_ref]),
        secretRef: c.secret_ref,
        lastAttemptAt: iso(c.last_attempt_at),
        lastSuccessAt: iso(c.last_success_at),
        proceedsPolicy: c.proceeds_policy,
        mappedEvents: c.mapped_events,
        lastRunStatus: c.last_run_status,
        lastRunAt: iso(c.last_run_at),
      })),
      planned: PLANNED_INTEGRATIONS,
    } satisfies ConnectionsResponse;
  });

  /** Credential check only (read-only). Does not change stored status: "verified" needs a successful event read. */
  app.post<{ Params: { orgId: string; connectionId: string } }>("/api/orgs/:orgId/connections/:connectionId/test", async (req, reply) => {
    const org = await orgFor(req, reply, "admin");
    if (!org) return;
    const conn = UUID.test(req.params.connectionId) ? await getConnection(db, org.id, req.params.connectionId) : null;
    if (!conn) return reply.code(404).send({ error: "not_found" });
    try {
      await factory(conn, { priorSuccesses: 0 }).validate();
      return { ok: true, message: conn.mode === "fixture" ? "Fixture transport responded. This is not a live credential check." : "Credential accepted by the provider." };
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : "internal";
      return reply.code(502).send({ ok: false, kind, message: err instanceof Error ? err.message : String(err), action: actionFor(kind) });
    }
  });

  if (opts.webDir && existsSync(path.join(opts.webDir, "index.html"))) {
    await app.register(fastifyStatic, { root: path.resolve(opts.webDir) });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
