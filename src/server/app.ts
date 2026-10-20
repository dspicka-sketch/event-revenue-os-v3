import { existsSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Db } from "../db/pool.js";
import { getEventSummary, getOrganization, listEventSummaries, listOrganizations, listSyncRuns, ticketClassBreakdown, type EventSummaryRow } from "../db/repo.js";
import { MEASURE_DEFINITIONS } from "../domain/revenue.js";
import { actionFor } from "../providers/errors.js";
import { syncEvent, type AdapterFactory, defaultAdapterFactory } from "../sync/syncEvent.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppOptions {
  db: Db;
  accessToken?: string;
  adapterFactory?: AdapterFactory;
  webDir?: string;
  logger?: boolean;
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function eventDto(r: EventSummaryRow) {
  const latestRun = r.latest_run;
  const hasData = r.latest_result !== null;
  // Stale: there is retained data but the most recent attempt failed.
  const stale = hasData && latestRun !== null && latestRun.status === "failed";
  return {
    id: r.id,
    name: r.name,
    performanceStartUtc: r.performance_start_utc ?? r.source_start_utc,
    venueTimezone: r.venue_timezone,
    source: {
      provider: r.provider,
      providerAccountId: r.provider_account_id,
      sourceEventId: r.source_event_id,
      sourceName: r.source_name,
      sourceUpdatedAt: r.source_updated_at,
    },
    connection: {
      id: r.connection_id,
      mode: r.connection_mode,
      status: r.connection_status,
      statusKind: r.connection_status_kind,
      statusDetail: r.connection_status_detail,
      action: r.connection_status_kind ? actionFor(r.connection_status_kind) : null,
      lastAttemptAt: r.last_attempt_at,
      lastSuccessAt: r.last_success_at,
      proceedsPolicy: r.proceeds_policy,
    },
    freshness: { hasData, stale, dataAsOf: r.latest_result_at, latestRun },
    revenue: r.latest_result,
    sourceReport: r.source_report,
    reportComparison: r.report_comparison,
  };
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ? { redact: ["req.headers.authorization"] } : false });
  const { db } = opts;
  const factory = opts.adapterFactory ?? defaultAdapterFactory;

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url === "/api/health") return;
    if (!opts.accessToken) return;
    const h = req.headers.authorization ?? "";
    const given = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!tokenMatches(given, opts.accessToken)) return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/api/health", async () => ({ ok: true, authRequired: Boolean(opts.accessToken) }));

  app.get("/api/orgs", async () => ({ organizations: await listOrganizations(db) }));

  app.get<{ Params: { orgId: string } }>("/api/orgs/:orgId/events", async (req, reply) => {
    const { orgId } = req.params;
    if (!UUID.test(orgId)) return reply.code(404).send({ error: "not_found" });
    const org = await getOrganization(db, orgId);
    if (!org) return reply.code(404).send({ error: "not_found" });
    const rows = await listEventSummaries(db, orgId);
    return { organization: org, events: rows.map(eventDto) };
  });

  app.get<{ Params: { orgId: string; eventId: string } }>("/api/orgs/:orgId/events/:eventId", async (req, reply) => {
    const { orgId, eventId } = req.params;
    if (!UUID.test(orgId) || !UUID.test(eventId)) return reply.code(404).send({ error: "not_found" });
    const org = await getOrganization(db, orgId);
    const row = org && (await getEventSummary(db, orgId, eventId));
    if (!org || !row) return reply.code(404).send({ error: "not_found" });
    return {
      organization: org,
      event: eventDto(row),
      syncRuns: await listSyncRuns(db, orgId, eventId),
      ticketClasses: await ticketClassBreakdown(db, orgId, eventId),
      definitions: MEASURE_DEFINITIONS,
    };
  });

  app.post<{ Params: { orgId: string; eventId: string } }>("/api/orgs/:orgId/events/:eventId/refresh", async (req, reply) => {
    const { orgId, eventId } = req.params;
    if (!UUID.test(orgId) || !UUID.test(eventId)) return reply.code(404).send({ error: "not_found" });
    const out = await syncEvent(db, orgId, eventId, factory);
    if (out.ok) return { ok: true, runId: out.runId, counts: out.counts };
    const code = out.kind === "not_found" && !out.runId ? 404 : out.kind === "busy" ? 409 : 502;
    return reply.code(code).send({ ok: false, runId: out.runId, kind: out.kind, message: out.message, action: actionFor(out.kind) });
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
