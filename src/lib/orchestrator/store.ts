import type { EvidenceScope, Job, JobState, MemberRole, ProposalInput, Run, RunState } from "./types";
import type { SpecialistKey } from "../domain/roles";

export interface NewRun {
  project_id: string;
  initiator: string;
  kind: Run["kind"];
  question: string;
  idempotency_key: string;
  budget: Run["budget"];
  input_snapshot: Record<string, unknown>;
  permission_context: Record<string, unknown>;
  project_version: string;
  prompt_version: string;
  model: string | null;
  live: boolean;
}

export type RunPatch = Partial<
  Pick<Run, "state" | "planned_roles" | "usage" | "brief" | "error" | "started_at" | "finished_at" | "cancel_requested">
>;

export type JobFinish = Partial<
  Pick<Job, "state" | "output" | "error" | "tokens_in" | "tokens_out" | "cost_usd" | "cost_basis" | "steps" | "model" | "checkpoint">
>;

/**
 * Durable store for runs, jobs, events and proposals. Project state lives here, never in
 * a model transcript. Implementations: PgRunStore (production) and MemoryRunStore (tests/demo).
 */
export interface RunStore {
  getMemberRole(projectId: string, userId: string): Promise<MemberRole | null>;
  createRunIdempotent(r: NewRun): Promise<{ run: Run; created: boolean }>;
  getRun(runId: string): Promise<Run | null>;
  patchRun(runId: string, patch: RunPatch, expectState?: RunState[]): Promise<Run | null>;
  insertJobs(runId: string, projectId: string, jobs: { role: SpecialistKey; task: string }[]): Promise<void>;
  listJobs(runId: string): Promise<Job[]>;
  /** Atomically lease one queued job (or a running job whose lease expired). */
  claimJob(runId: string, workerId: string, leaseMs: number): Promise<Job | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  /** Finish a job and insert its proposals atomically; no-op unless workerId holds the lease. */
  finishJob(jobId: string, workerId: string, patch: JobFinish, proposals: ProposalInput[]): Promise<boolean>;
  /** Mark queued jobs with a terminal state (cancel / budget). */
  settleQueuedJobs(runId: string, state: JobState, error: string): Promise<number>;
  /** Re-queue jobs in the given states (retry). */
  requeueJobs(runId: string, states: JobState[]): Promise<number>;
  addEvent(runId: string, jobId: string | null, kind: string, payload: Record<string, unknown>): Promise<void>;
  getEvidenceScope(projectId: string, role: MemberRole): Promise<EvidenceScope>;
  /** Runs that need a worker: queued, or running with a queued/expired job. */
  listResumableRuns(limit: number): Promise<string[]>;
}
