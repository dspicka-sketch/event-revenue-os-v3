import "server-only";
import { appMode, modelConfig, pricing } from "../config";
import { SPECIALIST_KEYS, ROLES, type SpecialistKey } from "../domain/roles";
import { Orchestrator } from "./engine";
import { FixtureModelClient, GatewayModelClient, type FixtureScript, type ModelClient } from "./model";
import type { RunStore } from "./store";
import type { ClaimItem } from "./types";

const g = globalThis as unknown as { __p104store?: RunStore; __p104pool?: unknown };

/** Topic filters each demo specialist uses to restate recorded claims. */
const DEMO_TOPICS: Record<SpecialistKey, string[]> = {
  public_policy: ["zoning"],
  fundraising: ["CAST", "1023"],
  community_outreach: ["confidential", "operators"],
  data_engineer: ["brochure", "rent"],
  niva_liaison: ["NIVA"],
  strategist: ["option", "ownership"],
  general_counsel: ["sublease", "1023"],
};

/**
 * Deterministic demo behavior: restate already-recorded claims with their citations and
 * propose follow-up tasks. Clearly labeled as fixture output; never presented as research.
 */
function demoScript(role: SpecialistKey): FixtureScript {
  return async (_call, { callTool }) => {
    const found: ClaimItem[] = [];
    for (const topic of DEMO_TOPICS[role]) found.push(...((await callTool("read_claims", { topic })) as ClaimItem[]));
    const uniq = [...new Map(found.map((c) => [c.id, c])).values()].filter((c) => c.source_ids.length).slice(0, 3);
    return {
      summary: `[FIXTURE — not live research] ${ROLES[role].title}: restated ${uniq.length} recorded claim(s) with their existing citations.`,
      findings: uniq.map((c) => ({
        statement: c.statement,
        evidence_class: c.evidence_class === "user_reported" ? "user_reported" : "documented_historical",
        source_refs: c.source_ids.slice(0, 2).map((source_id) => ({ source_id, locator: "see recorded claim" })),
        limits: c.limits ?? undefined,
      })),
      unknowns: uniq.length ? [] : [`No recorded claims matched ${role}'s demo topics.`],
      recommendations: [],
      proposed_tasks: [{ title: `[FIXTURE] ${ROLES[role].firstOutput}`, assigned_role: role, next_action: "Run with a configured live model to produce real findings." }],
      proposed_risks: [],
      proposed_decisions: [],
      drafts: [],
      approval_requests: [],
    };
  };
}

export function modelClient(): ModelClient | null {
  if (appMode() === "demo") {
    return new FixtureModelClient(Object.fromEntries(SPECIALIST_KEYS.map((k) => [k, demoScript(k)])), 1500);
  }
  const cfg = modelConfig();
  return cfg.model ? new GatewayModelClient(cfg.model, pricing()) : null;
}

export async function runStore(): Promise<RunStore> {
  if (g.__p104store) return g.__p104store;
  if (appMode() === "demo") {
    const { MemoryRunStore } = await import("./memory-store");
    const { DemoDb, DEMO_USER_ID, DEMO_PROJECT_ID } = await import("../data/demo-db");
    const store = new MemoryRunStore();
    store.addMember(DEMO_PROJECT_ID, DEMO_USER_ID, "owner");
    // Scope is read from the demo tables at run time.
    const db = new DemoDb();
    store.getEvidenceScope = async () => {
      const [sources, claims, links] = await Promise.all([db.list("sources"), db.list("claims"), db.list("claim_sources")]);
      return {
        projectVersion: `demo#${claims.length}`,
        sources: sources.map((s) => ({ ...s, text: null }) as any),
        claims: claims.map((c) => ({ ...c, source_ids: links.filter((l) => l.claim_id === c.id).map((l) => l.source_id) }) as any),
      };
    };
    g.__p104store = store;
    return store;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the agent worker needs a server-side Postgres connection.");
  const { Pool } = await import("pg");
  const { PgRunStore } = await import("./pg-store");
  const pool = new Pool({ connectionString: url, max: 5, ssl: dbSsl(url) });
  g.__p104store = new PgRunStore(pool);
  return g.__p104store;
}

function dbSsl(url: string) {
  if (/localhost|127\.0\.0\.1/.test(url)) return undefined;
  // Supabase uses its own CA. Provide it via DATABASE_CA_CERT for full verification;
  // without it the connection is encrypted but the server certificate is not verified.
  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export async function orchestrator(workerId = `web-${process.pid}-${Math.random().toString(36).slice(2, 8)}`) {
  return new Orchestrator({ store: await runStore(), model: modelClient(), workerId });
}
