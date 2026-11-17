// AutoRev (D19): scheduled jobs and the underplay candidate API.
//
// Cron routes skip session sign-in and instead require the shared CRON_SECRET
// as a bearer token (the way Vercel Cron calls a function). Unset secret means
// the jobs are off: 503, never an open route.

import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../auth/accounts.js";
import type { Db } from "../db/pool.js";
import { getOrganization, listCandidates, listWatchArtists, setCandidateStage, upsertCandidates, type CandidateRow } from "../db/repo.js";
import { CANDIDATE_STAGES, DISCOVERY_METHOD, selectCandidates, WAX_POETIC_RULES, type AreaShow, type CandidateStage, type DiscoveryRules } from "../domain/discovery.js";
import { ProviderError } from "../providers/errors.js";
import type { CandidateDto, DiscoveryResponse } from "../shared/apiTypes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AutoRevOptions {
  /** Shared secret for /api/cron/*. Unset = scheduled jobs are off. */
  cronSecret?: string;
  /** The organization whose underplay candidates the discovery job maintains. */
  discoveryOrgId?: string;
  /** Reads upcoming area shows (Bay Shows in production). */
  areaShowsSource?: (now: Date) => Promise<AreaShow[]>;
  discoveryRules?: DiscoveryRules;
}

export interface AutoRevContext {
  db: Db;
  now: () => Date;
  orgFor: (req: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply, need?: Role) => Promise<{ id: string } | null>;
}

export function isCronPath(url: string): boolean {
  return (url.split("?")[0] ?? "").startsWith("/api/cron/");
}

function candidateDto(r: CandidateRow): CandidateDto {
  return {
    id: r.id, artist: r.artist, origin: r.origin, stage: r.stage, dismissed: r.dismissed_at !== null, score: r.score, reasons: r.reasons,
    anchor: { headliner: r.anchor.headliner, venueName: r.anchor.venueName, city: r.anchor.city, venueCapacity: r.anchor.venueCapacity, startsAt: r.anchor.startsAt, status: r.anchor.status, ticketUrl: r.anchor.ticketUrl },
    firstSeenAt: r.first_seen_at.toISOString(), lastSeenAt: r.last_seen_at.toISOString(), stageChangedAt: r.stage_changed_at?.toISOString() ?? null, notes: r.notes,
  };
}

export function registerAutoRev(app: FastifyInstance, ctx: AutoRevContext, opts: AutoRevOptions): void {
  const { db, now, orgFor } = ctx;
  const digest = (s: string) => createHash("sha256").update(s).digest();

  /** True when the caller presented the cron secret. Otherwise the reply is already sent. */
  function cronAuthorized(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!opts.cronSecret) {
      reply.code(503).send({ error: "not_configured", message: "Scheduled jobs are off: CRON_SECRET is not set on the server." });
      return false;
    }
    const h = req.headers.authorization ?? "";
    const given = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!timingSafeEqual(digest(given), digest(opts.cronSecret))) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  }

  app.get("/api/cron/discovery", async (req, reply) => {
    if (!cronAuthorized(req, reply)) return;
    const org = opts.discoveryOrgId && UUID.test(opts.discoveryOrgId) ? await getOrganization(db, opts.discoveryOrgId) : null;
    if (!org || org.is_fixture || !opts.areaShowsSource) {
      return reply.code(503).send({ error: "not_configured", message: "Discovery needs REVOS_DISCOVERY_ORG_ID (a live organization) and the Bay Shows URL and key." });
    }
    let shows: AreaShow[];
    try {
      shows = await opts.areaShowsSource(now());
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "unexpected";
      req.log.error({ kind }, "discovery source failed");
      return reply.code(502).send({ error: "source_failed", kind, message: e instanceof ProviderError ? e.message : "The discovery source failed." });
    }
    const candidates = selectCandidates(shows, opts.discoveryRules ?? WAX_POETIC_RULES, now(), await listWatchArtists(db, org.id));
    const counts = await upsertCandidates(db, org.id, candidates, now());
    return { considered: shows.length, candidates: candidates.length, ...counts };
  });

  for (const path of ["/api/cron/sync", "/api/cron/digest"]) {
    app.get(path, async (req, reply) => {
      if (!cronAuthorized(req, reply)) return;
      return reply.code(501).send({ error: "not_implemented" });
    });
  }

  app.get<{ Params: { orgId: string }; Querystring: { stage?: string; include?: string } }>("/api/orgs/:orgId/discovery", async (req, reply) => {
    const org = await orgFor(req, reply);
    if (!org) return;
    const stage = CANDIDATE_STAGES.includes(req.query.stage as CandidateStage) ? (req.query.stage as CandidateStage) : undefined;
    const rows = await listCandidates(db, org.id, { stage, includeDismissed: req.query.include === "dismissed" });
    return { method: DISCOVERY_METHOD, candidates: rows.map(candidateDto) } satisfies DiscoveryResponse;
  });

  app.put<{ Params: { orgId: string; id: string }; Body: { stage?: unknown; dismissed?: unknown; notes?: unknown } }>("/api/orgs/:orgId/discovery/:id", async (req, reply) => {
    const org = await orgFor(req, reply, "admin");
    if (!org) return;
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: "not_found" });
    const { stage, dismissed, notes } = req.body ?? {};
    const change: { stage?: CandidateStage; dismissed?: boolean; notes?: string | null } = {};
    if (stage !== undefined) {
      if (!CANDIDATE_STAGES.includes(stage as CandidateStage)) return reply.code(400).send({ error: "bad_request", message: `stage must be one of: ${CANDIDATE_STAGES.join(", ")}.` });
      change.stage = stage as CandidateStage;
    }
    if (dismissed !== undefined) {
      if (typeof dismissed !== "boolean") return reply.code(400).send({ error: "bad_request", message: "dismissed must be true or false." });
      change.dismissed = dismissed;
    }
    if (notes !== undefined) {
      if (notes !== null && (typeof notes !== "string" || notes.length > 2000)) return reply.code(400).send({ error: "bad_request", message: "notes must be text of at most 2,000 characters." });
      change.notes = notes as string | null;
    }
    if (Object.keys(change).length === 0) return reply.code(400).send({ error: "bad_request", message: "Send stage, dismissed or notes." });
    const ok = await setCandidateStage(db, org.id, req.params.id, change, now());
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });
}
