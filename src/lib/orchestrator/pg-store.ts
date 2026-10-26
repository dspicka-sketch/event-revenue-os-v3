import type { Pool, PoolClient } from "pg";
import type { RunStore, NewRun, RunPatch, JobFinish } from "./store";
import type { EvidenceScope, Job, JobState, MemberRole, ProposalInput, Run, RunState } from "./types";
import type { SpecialistKey } from "../domain/roles";

/**
 * Postgres-backed durable store used by the server worker. It connects with a privileged
 * credential, so every entry point is scoped by project id, and the engine checks
 * membership (getMemberRole) before acting for a user. Writes tag audit rows as 'agent'.
 */
export class PgRunStore implements RunStore {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.actor_kind', 'agent', true)");
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }

  async getMemberRole(projectId: string, userId: string): Promise<MemberRole | null> {
    const r = await this.pool.query(
      "select role from public.project_members where project_id = $1 and user_id = $2 and access_state = 'active'",
      [projectId, userId],
    );
    return (r.rows[0]?.role as MemberRole) ?? null;
  }

  async createRunIdempotent(n: NewRun) {
    return this.tx(async (c) => {
      const ins = await c.query(
        `insert into public.agent_runs
           (project_id, initiator, kind, question, idempotency_key, budget, input_snapshot, permission_context, project_version, prompt_version, model, live, usage)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (project_id, idempotency_key) do nothing
         returning *`,
        [n.project_id, n.initiator, n.kind, n.question, n.idempotency_key, n.budget, n.input_snapshot, n.permission_context,
          n.project_version, n.prompt_version, n.model, n.live,
          { tokensIn: 0, tokensOut: 0, costUsd: null, costBasis: "unknown", stoppedAtBudget: false }],
      );
      if (ins.rows[0]) return { run: toRun(ins.rows[0]), created: true };
      const ex = await c.query("select * from public.agent_runs where project_id = $1 and idempotency_key = $2", [n.project_id, n.idempotency_key]);
      return { run: toRun(ex.rows[0]), created: false };
    });
  }

  async getRun(id: string) {
    const r = await this.pool.query("select * from public.agent_runs where id = $1", [id]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  async patchRun(id: string, patch: RunPatch, expectState?: RunState[]) {
    const cols = Object.keys(patch) as (keyof RunPatch)[];
    if (!cols.length) return this.getRun(id);
    const sets = cols.map((k, i) => `${k} = $${i + 2}`);
    const vals = cols.map((k) => (k === "planned_roles" ? patch[k] : (patch[k] as unknown)));
    let sql = `update public.agent_runs set ${sets.join(", ")} where id = $1`;
    if (expectState) sql += ` and state = any($${cols.length + 2})`;
    sql += " returning *";
    return this.tx(async (c) => {
      const r = await c.query(sql, expectState ? [id, ...vals, expectState] : [id, ...vals]);
      return r.rows[0] ? toRun(r.rows[0]) : null;
    });
  }

  async insertJobs(runId: string, projectId: string, jobs: { role: SpecialistKey; task: string }[]) {
    await this.tx(async (c) => {
      for (const j of jobs) {
        await c.query(
          "insert into public.agent_jobs (project_id, run_id, role, task) values ($1,$2,$3,$4) on conflict (run_id, role) do nothing",
          [projectId, runId, j.role, j.task],
        );
      }
    });
  }

  async listJobs(runId: string) {
    const r = await this.pool.query("select * from public.agent_jobs where run_id = $1 order by created_at, role", [runId]);
    return r.rows.map(toJob);
  }

  async claimJob(runId: string, workerId: string, leaseMs: number) {
    return this.tx(async (c) => {
      const r = await c.query(
        `update public.agent_jobs j set state = 'running', attempt = attempt + 1, lease_owner = $2,
                lease_expires_at = now() + ($3 || ' milliseconds')::interval, started_at = coalesce(started_at, now())
          where j.id = (
            select id from public.agent_jobs
             where run_id = $1 and (state = 'queued' or (state = 'running' and lease_expires_at < now()))
             order by created_at, role
             for update skip locked
             limit 1)
          returning *`,
        [runId, workerId, String(leaseMs)],
      );
      return r.rows[0] ? toJob(r.rows[0]) : null;
    });
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    const r = await this.pool.query(
      `update public.agent_jobs set lease_expires_at = now() + ($3 || ' milliseconds')::interval
        where id = $1 and lease_owner = $2 and state = 'running'`,
      [jobId, workerId, String(leaseMs)],
    );
    return r.rowCount === 1;
  }

  async finishJob(jobId: string, workerId: string, patch: JobFinish, proposals: ProposalInput[]) {
    return this.tx(async (c) => {
      const cols = Object.keys(patch) as (keyof JobFinish)[];
      const sets = cols.map((k, i) => `${k} = $${i + 3}`);
      const r = await c.query(
        `update public.agent_jobs set ${[...sets, "lease_owner = null", "lease_expires_at = null", "finished_at = now()"].join(", ")}
          where id = $1 and lease_owner = $2 and state = 'running' returning project_id`,
        [jobId, workerId, ...cols.map((k) => patch[k] as unknown)],
      );
      if (r.rowCount !== 1) return false;
      const projectId = r.rows[0].project_id;
      for (const p of proposals) {
        await c.query(
          `insert into public.proposals (project_id, run_id, job_id, role, target_table, target_id, base_version, mutation, dedupe_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (project_id, dedupe_key) do nothing`,
          [projectId, p.run_id, p.job_id, p.role, p.target_table, p.target_id ?? null, p.base_version ?? null, p.mutation, p.dedupe_key],
        );
      }
      return true;
    });
  }

  async settleQueuedJobs(runId: string, state: JobState, error: string) {
    const r = await this.tx((c) =>
      c.query("update public.agent_jobs set state = $2, error = $3, finished_at = now() where run_id = $1 and state = 'queued'", [runId, state, error]),
    );
    return r.rowCount ?? 0;
  }

  async requeueJobs(runId: string, states: JobState[]) {
    const r = await this.tx((c) =>
      c.query("update public.agent_jobs set state = 'queued', error = null, finished_at = null where run_id = $1 and state = any($2)", [runId, states]),
    );
    return r.rowCount ?? 0;
  }

  async addEvent(runId: string, jobId: string | null, kind: string, payload: Record<string, unknown>) {
    await this.pool.query(
      "insert into public.run_events (project_id, run_id, job_id, kind, payload) select project_id, id, $2, $3, $4 from public.agent_runs where id = $1",
      [runId, jobId, kind, payload],
    );
  }

  async getEvidenceScope(projectId: string, role: MemberRole): Promise<EvidenceScope> {
    const sources = await this.pool.query(
      `select s.id, s.register_code, s.title, s.kind, s.source_date::text, s.availability, s.inherited, s.access_classification,
              (select v.extracted_text from public.source_versions v
                 where v.source_id = s.id and v.extraction_state = 'succeeded' order by v.version_no desc limit 1) as text
         from public.sources s
        where s.project_id = $1 and (s.access_classification <> 'restricted' or $2 = 'owner')
        order by s.register_code nulls last, s.created_at`,
      [projectId, role],
    );
    const claims = await this.pool.query(
      `select c.id, c.code, c.statement, c.evidence_class, c.review_state, c.limits, c.conflict_group,
              coalesce(array_agg(cs.source_id) filter (where cs.source_id is not null), '{}') as source_ids
         from public.claims c left join public.claim_sources cs on cs.claim_id = c.id
        where c.project_id = $1 and c.review_state in ('accepted','proposed','needs_review')
        group by c.id order by c.code nulls last, c.created_at`,
      [projectId],
    );
    const ver = await this.pool.query(
      `select coalesce(max(updated_at), 'epoch')::text as v, count(*) as n from (
         select updated_at from public.claims where project_id = $1
         union all select updated_at from public.sources where project_id = $1
         union all select updated_at from public.source_versions where project_id = $1) x`,
      [projectId],
    );
    return {
      sources: sources.rows,
      claims: claims.rows,
      projectVersion: `${ver.rows[0].v}#${ver.rows[0].n}`,
    };
  }

  async listResumableRuns(limit: number) {
    const r = await this.pool.query(
      `select r.id from public.agent_runs r
        where r.state = 'queued'
           or (r.state = 'running' and exists (
                select 1 from public.agent_jobs j where j.run_id = r.id
                  and (j.state = 'queued' or (j.state = 'running' and j.lease_expires_at < now()))))
        order by r.created_at limit $1`,
      [limit],
    );
    return r.rows.map((x) => x.id as string);
  }
}

function iso(v: unknown): string | null {
  return v ? new Date(v as string).toISOString() : null;
}

function toRun(r: any): Run {
  return { ...r, started_at: iso(r.started_at), finished_at: iso(r.finished_at), created_at: iso(r.created_at)! };
}

function toJob(r: any): Job {
  return { ...r, lease_expires_at: iso(r.lease_expires_at), cost_usd: r.cost_usd === null ? null : Number(r.cost_usd) };
}
