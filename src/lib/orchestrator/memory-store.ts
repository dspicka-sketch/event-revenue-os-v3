import { randomUUID } from "node:crypto";
import type { RunStore, NewRun, RunPatch, JobFinish } from "./store";
import type { EvidenceScope, Job, JobState, MemberRole, ProposalInput, Run, RunState } from "./types";
import type { SpecialistKey } from "../domain/roles";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory RunStore for orchestration tests and isolated demo mode. Not for live data. */
export class MemoryRunStore implements RunStore {
  runs = new Map<string, Run>();
  jobs = new Map<string, Job>();
  events: { run_id: string; job_id: string | null; kind: string; payload: Record<string, unknown>; seq: number }[] = [];
  proposals = new Map<string, ProposalInput & { project_id: string; state: string }>();
  members = new Map<string, MemberRole>(); // `${project}:${user}`
  scopes = new Map<string, EvidenceScope>();
  now: () => number = () => Date.now();
  private seq = 0;

  addMember(projectId: string, userId: string, role: MemberRole) {
    this.members.set(`${projectId}:${userId}`, role);
  }

  async getMemberRole(projectId: string, userId: string) {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }

  async createRunIdempotent(r: NewRun) {
    for (const run of this.runs.values()) {
      if (run.project_id === r.project_id && run.idempotency_key === r.idempotency_key) return { run: clone(run), created: false };
    }
    const run: Run = {
      id: randomUUID(),
      project_id: r.project_id,
      initiator: r.initiator,
      kind: r.kind,
      question: r.question,
      state: "queued",
      planned_roles: [],
      budget: r.budget,
      usage: { tokensIn: 0, tokensOut: 0, costUsd: null, costBasis: "unknown", stoppedAtBudget: false },
      idempotency_key: r.idempotency_key,
      cancel_requested: false,
      brief: null,
      error: null,
      live: r.live,
      model: r.model,
      prompt_version: r.prompt_version,
      input_snapshot: r.input_snapshot,
      permission_context: r.permission_context,
      started_at: null,
      finished_at: null,
      created_at: new Date(this.now()).toISOString(),
    };
    this.runs.set(run.id, run);
    return { run: clone(run), created: true };
  }

  async getRun(id: string) {
    const r = this.runs.get(id);
    return r ? clone(r) : null;
  }

  async patchRun(id: string, patch: RunPatch, expectState?: RunState[]) {
    const r = this.runs.get(id);
    if (!r) return null;
    if (expectState && !expectState.includes(r.state)) return null;
    Object.assign(r, clone(patch));
    return clone(r);
  }

  async insertJobs(runId: string, projectId: string, jobs: { role: SpecialistKey; task: string }[]) {
    const existing = new Set([...this.jobs.values()].filter((j) => j.run_id === runId).map((j) => j.role));
    for (const j of jobs) {
      if (existing.has(j.role)) continue;
      const job: Job = {
        id: randomUUID(),
        run_id: runId,
        project_id: projectId,
        role: j.role,
        task: j.task,
        state: "queued",
        attempt: 0,
        lease_owner: null,
        lease_expires_at: null,
        checkpoint: null,
        output: null,
        error: null,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: null,
        cost_basis: "unknown",
        steps: 0,
        model: null,
      };
      this.jobs.set(job.id, job);
    }
  }

  async listJobs(runId: string) {
    return [...this.jobs.values()].filter((j) => j.run_id === runId).map(clone);
  }

  async claimJob(runId: string, workerId: string, leaseMs: number) {
    const now = this.now();
    const job = [...this.jobs.values()].find(
      (j) =>
        j.run_id === runId &&
        (j.state === "queued" || (j.state === "running" && j.lease_expires_at !== null && Date.parse(j.lease_expires_at) < now)),
    );
    if (!job) return null;
    job.state = "running";
    job.attempt += 1;
    job.lease_owner = workerId;
    job.lease_expires_at = new Date(now + leaseMs).toISOString();
    return clone(job);
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    const j = this.jobs.get(jobId);
    if (!j || j.lease_owner !== workerId || j.state !== "running") return false;
    j.lease_expires_at = new Date(this.now() + leaseMs).toISOString();
    return true;
  }

  async finishJob(jobId: string, workerId: string, patch: JobFinish, proposals: ProposalInput[]) {
    const j = this.jobs.get(jobId);
    if (!j || j.lease_owner !== workerId || j.state !== "running") return false;
    Object.assign(j, clone(patch), { lease_owner: null, lease_expires_at: null });
    for (const p of proposals) {
      const key = `${j.project_id}:${p.dedupe_key}`;
      if (!this.proposals.has(key)) this.proposals.set(key, { ...clone(p), project_id: j.project_id, state: "pending" });
    }
    return true;
  }

  async settleQueuedJobs(runId: string, state: JobState, error: string) {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.run_id === runId && j.state === "queued") {
        j.state = state;
        j.error = error;
        n++;
      }
    }
    return n;
  }

  async requeueJobs(runId: string, states: JobState[]) {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.run_id === runId && states.includes(j.state)) {
        j.state = "queued";
        j.error = null;
        n++;
      }
    }
    return n;
  }

  async addEvent(runId: string, jobId: string | null, kind: string, payload: Record<string, unknown>) {
    this.events.push({ run_id: runId, job_id: jobId, kind, payload: clone(payload), seq: ++this.seq });
  }

  async getEvidenceScope(projectId: string, role: MemberRole): Promise<EvidenceScope> {
    const s = this.scopes.get(projectId) ?? { sources: [], claims: [], projectVersion: "empty" };
    return {
      ...clone(s),
      sources: s.sources.filter((x) => x.access_classification !== "restricted" || role === "owner").map(clone),
    };
  }

  async listResumableRuns(limit: number) {
    const now = this.now();
    return [...this.runs.values()]
      .filter((r) =>
        (r.state === "queued" || r.state === "running") &&
        [...this.jobs.values()].some(
          (j) => j.run_id === r.id && (j.state === "queued" || (j.state === "running" && j.lease_expires_at !== null && Date.parse(j.lease_expires_at) < now)),
        ) || r.state === "queued",
      )
      .slice(0, limit)
      .map((r) => r.id);
  }
}
