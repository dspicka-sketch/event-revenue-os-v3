// Database tests: migrations, RLS, integrity triggers and concurrency against real Postgres
// with a minimal Supabase auth/storage shim (tests/db/supabase-shim.sql).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { as, errorOf, pool, resetDb } from "./helpers";
import { draftContentHash } from "@/lib/domain/evidence";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const EDITOR = "00000000-0000-4000-8000-0000000000a2";
const VIEWER = "00000000-0000-4000-8000-0000000000a3";
const B_OWNER = "00000000-0000-4000-8000-0000000000b1";

let p: Pool;
let A: string;
let B: string;

beforeAll(async () => {
  resetDb();
  p = pool();
  A = await as(p, OWNER, async (c) => (await c.query("select public.create_project('Protect 104','mission') id")).rows[0].id, true);
  B = await as(p, B_OWNER, async (c) => (await c.query("select public.create_project('Other','other') id")).rows[0].id, true);
  await as(p, OWNER, async (c) => {
    await c.query("insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor'),($1,$3,'viewer')", [A, EDITOR, VIEWER]);
    await c.query("select public.seed_protect104_baseline($1)", [A]);
  }, true);
});
afterAll(async () => p?.end());

describe("test 1: access control", () => {
  it("anonymous requests read nothing", async () => {
    const e = await errorOf(as(p, null, (c) => c.query("select * from public.sources")));
    expect(e).toMatch(/permission denied/);
    const e2 = await errorOf(as(p, null, (c) => c.query("select * from public.agent_runs")));
    expect(e2).toMatch(/permission denied/);
  });

  it("a member of project B cannot read project A by changing the id", async () => {
    const n = await as(p, B_OWNER, async (c) => {
      const tables = ["sources", "claims", "tasks", "decisions", "agent_runs", "audit_events", "price_observations"];
      let total = 0;
      for (const t of tables) total += (await c.query(`select count(*)::int n from public.${t} where project_id = $1`, [A])).rows[0].n;
      return total;
    });
    expect(n).toBe(0);
    const ins = await errorOf(as(p, B_OWNER, (c) => c.query("insert into public.tasks (project_id, title) values ($1,'x')", [A])));
    expect(ins).toMatch(/row-level security/);
  });

  it("storage paths are scoped to project membership", async () => {
    await p.query("insert into storage.objects (bucket_id, name) values ('sources', $1)", [`${A}/doc/abc.pdf`]);
    const own = await as(p, VIEWER, async (c) => (await c.query("select count(*)::int n from storage.objects where name like $1", [`${A}/%`])).rows[0].n);
    const other = await as(p, B_OWNER, async (c) => (await c.query("select count(*)::int n from storage.objects where name like $1", [`${A}/%`])).rows[0].n);
    expect(own).toBe(1);
    expect(other).toBe(0);
    const up = await errorOf(as(p, B_OWNER, (c) => c.query("insert into storage.objects (bucket_id, name) values ('sources', $1)", [`${A}/evil.pdf`])));
    expect(up).toMatch(/row-level security/);
    const viewerUp = await errorOf(as(p, VIEWER, (c) => c.query("insert into storage.objects (bucket_id, name) values ('sources', $1)", [`${A}/v.pdf`])));
    expect(viewerUp).toMatch(/row-level security/);
  });

  it("viewers cannot mutate", async () => {
    const r = await as(p, VIEWER, (c) => c.query("update public.tasks set title = 'hacked' where project_id = $1", [A]));
    expect(r.rowCount).toBe(0);
    const e = await errorOf(as(p, VIEWER, (c) => c.query("insert into public.tasks (project_id, title) values ($1,'x')", [A])));
    expect(e).toMatch(/row-level security/);
  });

  it("editors cannot escalate membership or approve", async () => {
    const e = await errorOf(as(p, EDITOR, (c) => c.query("insert into public.project_members (project_id, user_id, role) values ($1,$2,'owner')", [A, B_OWNER])));
    expect(e).toMatch(/row-level security/);
    const r = await as(p, EDITOR, (c) => c.query("update public.project_members set role = 'owner' where project_id = $1 and user_id = $2", [A, EDITOR]));
    expect(r.rowCount).toBe(0);
  });

  it("restricted sources are owner-only; private stakeholders hidden from viewers", async () => {
    const viewerSees = await as(p, VIEWER, async (c) => (await c.query("select register_code from public.sources where project_id = $1 and register_code = 'S03'", [A])).rowCount);
    const ownerSees = await as(p, OWNER, async (c) => (await c.query("select register_code from public.sources where project_id = $1 and register_code = 'S03'", [A])).rowCount);
    expect(viewerSees).toBe(0);
    expect(ownerSees).toBe(1);
    await as(p, OWNER, (c) => c.query("insert into public.stakeholders (project_id, name, privacy, synthetic) values ($1,'Synthetic Person','private',true)", [A]), true);
    const v = await as(p, VIEWER, async (c) => (await c.query("select 1 from public.stakeholders where project_id = $1", [A])).rowCount);
    expect(v).toBe(0);
  });

  it("support cannot be asserted without a claim", async () => {
    const e = await errorOf(as(p, OWNER, (c) => c.query("insert into public.stakeholders (project_id, name, support_status) values ($1,'X','stated_support')", [A])));
    expect(e).toMatch(/check constraint/);
  });
});

describe("baseline seed", () => {
  it("keeps price observations dated and separate; no agreed price", async () => {
    const rows = await as(p, OWNER, async (c) => (await c.query("select kind, amount_cents::int a, comparator, observed_on::text from public.price_observations where project_id = $1 order by observed_on nulls last", [A])).rows);
    expect(rows).toEqual([
      { kind: "broker_list", a: 105000000, comparator: "exact", observed_on: "2026-01-28" },
      { kind: "outbound_proposal", a: 80000000, comparator: "below", observed_on: "2026-09-05" },
      { kind: "user_reported", a: 80000000, comparator: "approximately", observed_on: null },
    ]);
    const e = await errorOf(as(p, OWNER, (c) => c.query("insert into public.price_observations (project_id, observed_on, kind, amount_cents, status_note) values ($1,'2026-10-01','agreed',75000000,'x')", [A])));
    expect(e).toMatch(/check constraint/);
  });

  it("inherited findings are not verified and cannot be marked verified_current", async () => {
    const r = await as(p, OWNER, async (c) => (await c.query("select code, evidence_class, review_state, inherited_unverified from public.claims where project_id=$1 and code='F07'", [A])).rows[0]);
    expect(r).toEqual({ code: "F07", evidence_class: "documented_historical", review_state: "needs_review", inherited_unverified: true });
    const e = await errorOf(as(p, OWNER, (c) => c.query("update public.claims set evidence_class='verified_current', verified_by='x', verified_at=now() where project_id=$1 and code='F07'", [A]), true));
    expect(e).toMatch(/inherited findings cannot be verified_current/);
  });

  it("all seeded decisions are open and all task dates are unset", async () => {
    const r = await as(p, OWNER, async (c) => (await c.query(
      "select (select count(*) from public.decisions where project_id=$1 and state <> 'open')::int d, (select count(*) from public.tasks where project_id=$1 and (due_at is not null or due_date is not null))::int t, (select count(*) from public.governance_options where project_id=$1 and state='selected')::int g",
      [A])).rows[0]);
    expect(r).toEqual({ d: 0, t: 0, g: 0 });
  });
});

describe("evidence integrity", () => {
  it("claims cannot be accepted without a source link", async () => {
    const e = await errorOf(as(p, EDITOR, (c) => c.query("insert into public.claims (project_id, statement, evidence_class, review_state) values ($1,'x','documented_historical','accepted')", [A]), true));
    expect(e).toMatch(/without a source link/);
  });

  it("test 2: identical upload is deduplicated; extraction failure stays visible and retryable", async () => {
    const checksum = "a".repeat(64);
    const src = await as(p, EDITOR, async (c) => {
      const s = (await c.query("insert into public.sources (project_id, kind, title, availability) values ($1,'document','Lease upload','available') returning id", [A])).rows[0].id;
      await c.query("insert into public.source_versions (project_id, source_id, version_no, checksum_sha256, mime_type, size_bytes) values ($1,$2,1,$3,'application/pdf',100)", [A, s, checksum]);
      return s;
    }, true);
    const dup = await errorOf(as(p, EDITOR, (c) => c.query("insert into public.source_versions (project_id, source_id, version_no, checksum_sha256, mime_type, size_bytes) values ($1,$2,2,$3,'application/pdf',100)", [A, src, checksum])));
    expect(dup).toMatch(/duplicate key/);
    await as(p, EDITOR, async (c) => {
      await c.query("update public.source_versions set extraction_state='failed', extraction_error='pdf parse error', extraction_attempts = extraction_attempts + 1 where source_id=$1", [src]);
      const r = (await c.query("select extraction_state, extraction_error, extraction_attempts from public.source_versions where source_id=$1", [src])).rows[0];
      expect(r).toEqual({ extraction_state: "failed", extraction_error: "pdf parse error", extraction_attempts: 1 });
      await c.query("update public.source_versions set extraction_state='queued' where source_id=$1", [src]);
    });
  });

  it("task dependency cycles are rejected", async () => {
    const e = await errorOf(as(p, EDITOR, async (c) => {
      const t1 = (await c.query("insert into public.tasks (project_id, title) values ($1,'a') returning id", [A])).rows[0].id;
      const t2 = (await c.query("insert into public.tasks (project_id, title) values ($1,'b') returning id", [A])).rows[0].id;
      await c.query("insert into public.task_dependencies (project_id, task_id, depends_on_id) values ($1,$2,$3)", [A, t1, t2]);
      await c.query("insert into public.task_dependencies (project_id, task_id, depends_on_id) values ($1,$2,$3)", [A, t2, t1]);
    }));
    expect(e).toMatch(/cycle/);
  });

  it("a deadline requires provenance; internal targets are labeled", async () => {
    const e = await errorOf(as(p, EDITOR, (c) => c.query("insert into public.tasks (project_id, title, due_date, deadline_kind) values ($1,'x','2026-12-01','external_hard')", [A])));
    expect(e).toMatch(/check constraint/);
    await as(p, EDITOR, (c) => c.query("insert into public.tasks (project_id, title, due_date, due_timezone, deadline_kind, due_provenance) values ($1,'x','2026-12-01','America/Los_Angeles','internal_target','Daniel set internal target')", [A]));
  });
});

describe("test 14: decisions, versions and audit", () => {
  it("editors cannot record decisions; owners can; stale versions fail; audit captures actor and version", async () => {
    const d = await as(p, OWNER, async (c) => (await c.query("select id, row_version from public.decisions where project_id=$1 order by created_at limit 1", [A])).rows[0]);
    const e = await errorOf(as(p, EDITOR, (c) => c.query("update public.decisions set state='accepted', rationale='r' where id=$1", [d.id])));
    expect(e).toMatch(/only a project owner/);
    await as(p, OWNER, (c) => c.query("update public.decisions set state='deferred', rationale='need counsel input', row_version=$2 where id=$1", [d.id, d.row_version]), true);
    // A second writer holding the old version must not overwrite.
    const stale = await errorOf(as(p, OWNER, (c) => c.query("update public.decisions set state='accepted', rationale='x', row_version=$2 where id=$1", [d.id, d.row_version])));
    expect(stale).toMatch(/stale_version/);
    const audit = await as(p, OWNER, async (c) => (await c.query("select actor, record_version, after->>'state' st from public.audit_events where record_id=$1 and action='update'", [d.id])).rows);
    expect(audit).toEqual([{ actor: OWNER, record_version: d.row_version + 1, st: "deferred" }]);
    const imm = await errorOf(p.query("delete from public.audit_events where record_id=$1", [d.id]));
    expect(imm).toMatch(/append-only/);
  });

  it("stage advancement needs owner signoff with accepted evidence", async () => {
    const e = await errorOf(as(p, OWNER, (c) => c.query("update public.projects set stage='feasibility' where id=$1", [A])));
    expect(e).toMatch(/signed-off stage transition/);
    const f01 = (await p.query("select id from public.claims where project_id=$1 and code='F01'", [A])).rows[0].id;
    const ed = await errorOf(as(p, EDITOR, (c) => c.query("insert into public.stage_transitions (project_id, from_stage, to_stage, criteria_claim_ids, signed_off_by, rationale) values ($1,'baseline','feasibility',$2,$3,'r')", [A, [f01], EDITOR])));
    expect(ed).toMatch(/row-level security|owner/);
    await as(p, OWNER, async (c) => {
      await c.query("insert into public.stage_transitions (project_id, from_stage, to_stage, criteria_claim_ids, signed_off_by, rationale) values ($1,'baseline','feasibility',$2,$3,'r')", [A, [f01], OWNER]);
      expect((await c.query("select stage from public.projects where id=$1", [A])).rows[0].stage).toBe("feasibility");
    });
  });
});

describe("test 13: approvals bind exact content", () => {
  it("editing approved content invalidates approval; scope cannot widen; no identity cannot approve", async () => {
    const { draft, approval } = await as(p, EDITOR, async (c) => {
      const d = (await c.query("insert into public.drafts (project_id, kind, title, audience, body, content_hash) values ($1,'email','Broker follow-up','Paul Schwartz','Draft body','x') returning id, content_hash, row_version", [A])).rows[0];
      expect(d.content_hash).toBe(draftContentHash("Broker follow-up", "Paul Schwartz", "Draft body"));
      const a = (await c.query("insert into public.approvals (project_id, action_kind, target, record_table, record_id, record_version, content_hash, scope, requested_by_role) values ($1,'external_send','Paul Schwartz','drafts',$2,$3,$4,'send this exact email once','chief_of_staff') returning id", [A, d.id, d.row_version, d.content_hash])).rows[0];
      return { draft: d, approval: a };
    }, true);
    // Editors cannot approve.
    const ed = await as(p, EDITOR, (c) => c.query("update public.approvals set state='approved' where id=$1", [approval.id]));
    expect(ed.rowCount).toBe(0);
    // A privileged backend without a user identity (e.g. an agent worker) cannot approve.
    const svc = await errorOf(p.query("update public.approvals set state='approved' where id=$1", [approval.id]));
    expect(svc).toMatch(/agents cannot approve/);
    // Widening scope is rejected.
    const widen = await errorOf(as(p, OWNER, (c) => c.query("update public.approvals set scope='send any email' where id=$1", [approval.id])));
    expect(widen).toMatch(/immutable/);
    await as(p, OWNER, (c) => c.query("update public.approvals set state='approved' where id=$1", [approval.id]), true);
    await as(p, OWNER, (c) => c.query("update public.drafts set state='approved' where id=$1", [draft.id]), true);
    // Edit the content: approval invalidated, draft back to draft.
    await as(p, EDITOR, (c) => c.query("update public.drafts set body='Changed body' where id=$1", [draft.id]), true);
    const after = (await p.query("select (select state from public.approvals where id=$1) a, (select state from public.drafts where id=$2) d", [approval.id, draft.id])).rows[0];
    expect(after).toEqual({ a: "invalidated", d: "draft" });
  });
});
