// The orchestrator against the real Postgres store: leases, idempotency and dedupe under concurrency.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { as, pool, resetDb } from "./helpers";
import { PgRunStore } from "@/lib/orchestrator/pg-store";
import { FixtureModelClient } from "@/lib/orchestrator/model";
import { Orchestrator } from "@/lib/orchestrator/engine";

const OWNER = "00000000-0000-4000-8000-0000000000c1";
const VIEWER = "00000000-0000-4000-8000-0000000000c2";
let p: Pool;
let A: string;
let f07Source: string;

const base = { summary: "ok", findings: [], unknowns: [], recommendations: [], proposed_tasks: [], proposed_risks: [], proposed_decisions: [], drafts: [], approval_requests: [] };

beforeAll(async () => {
  resetDb();
  p = pool();
  A = await as(p, OWNER, async (c) => {
    const id = (await c.query("select public.create_project('Protect 104','m') id")).rows[0].id;
    await c.query("select public.seed_protect104_baseline($1)", [id]);
    await c.query("insert into public.project_members (project_id, user_id, role) values ($1,$2,'viewer')", [id, VIEWER]);
    return id;
  }, true);
  f07Source = (await p.query("select id from public.sources where project_id=$1 and register_code='S05'", [A])).rows[0].id;
});
afterAll(async () => p?.end());

function scripts(counter: { n: number }) {
  return {
    general_counsel: async () => {
      counter.n++;
      await new Promise((r) => setTimeout(r, 30));
      return {
        ...base,
        findings: [{ statement: "AAA's Form 1023-EZ was submitted October 8, 2026; determination not established.", evidence_class: "documented_historical", source_refs: [{ source_id: f07Source, locator: "email" }] }],
        proposed_tasks: [{ title: "Confirm IRS determination" }],
      };
    },
    strategist: async () => {
      counter.n++;
      await new Promise((r) => setTimeout(r, 30));
      return { ...base, proposed_decisions: [{ question: "AAA or separate owner nonprofit?", alternatives: [{ label: "AAA" }, { label: "Separate entity" }] }] };
    },
  };
}

describe("PgRunStore", () => {
  it("scope respects restricted classification for the requesting role", async () => {
    const store = new PgRunStore(p);
    const owner = await store.getEvidenceScope(A, "owner");
    const editor = await store.getEvidenceScope(A, "editor");
    expect(owner.sources.some((s) => s.register_code === "S03")).toBe(true);
    expect(editor.sources.some((s) => s.register_code === "S03")).toBe(false);
  });

  it("two workers racing on one run execute each job exactly once", async () => {
    const counter = { n: 0 };
    const store = new PgRunStore(p);
    const model = new FixtureModelClient(scripts(counter) as any);
    const w1 = new Orchestrator({ store, model, workerId: "w1", heartbeatMs: 10 });
    const w2 = new Orchestrator({ store, model, workerId: "w2", heartbeatMs: 10 });
    const [a, b] = await Promise.all([
      w1.startRun({ projectId: A, userId: OWNER, kind: "investigation", question: "Assess ownership structures", idempotencyKey: "race-1", roles: ["general_counsel", "strategist"] }),
      w1.startRun({ projectId: A, userId: OWNER, kind: "investigation", question: "Assess ownership structures", idempotencyKey: "race-1", roles: ["general_counsel", "strategist"] }),
    ]);
    expect(a.run.id).toBe(b.run.id);
    await Promise.all([w1.execute(a.run.id), w2.execute(a.run.id)]);
    expect(counter.n).toBe(2);
    const run = (await store.getRun(a.run.id))!;
    expect(run.state).toBe("completed");
    expect(run.live).toBe(false);
    const props = (await p.query("select target_table, state from public.proposals where run_id=$1 order by target_table", [a.run.id])).rows;
    expect(props.map((x) => x.target_table)).toEqual(["claims", "decisions", "tasks"]);
    const evs = (await p.query("select count(*)::int n from public.run_events where run_id=$1 and kind='job.completed'", [a.run.id])).rows[0].n;
    expect(evs).toBe(2);
    // Proposals are visible to members through RLS, but not writable by viewers.
    const vis = await as(p, VIEWER, async (c) => (await c.query("select count(*)::int n from public.proposals where run_id=$1", [a.run.id])).rows[0].n);
    expect(vis).toBe(3);
    const audit = (await p.query("select distinct actor_kind from public.audit_events where table_name='proposals' and project_id=$1", [A])).rows;
    expect(audit).toEqual([{ actor_kind: "agent" }]);
  });

  it("viewer cannot start a run", async () => {
    const store = new PgRunStore(p);
    const o = new Orchestrator({ store, model: new FixtureModelClient({}), workerId: "w" });
    await expect(o.startRun({ projectId: A, userId: VIEWER, kind: "brief", question: "q", idempotencyKey: "v" })).rejects.toThrow(/not authorized/);
  });
});
