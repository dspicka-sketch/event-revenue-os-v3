import type { SpecialistKey } from "../domain/roles";
import type { SpecialistOutput, ValidationIssue } from "../domain/evidence";

export type RunState =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";
export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped_budget";
export type MemberRole = "owner" | "editor" | "viewer";

export interface RunBudget {
  maxConcurrent: number;
  maxTokens: number;
  maxCostUsd: number | null;
  maxStepsPerSpecialist: number;
  /** reserved per job before it starts, so concurrent jobs cannot jointly overshoot */
  perJobTokenEstimate: number;
  maxTransientRetries: number;
}

export const DEFAULT_BUDGET: RunBudget = {
  maxConcurrent: 3,
  maxTokens: 400_000,
  maxCostUsd: null,
  maxStepsPerSpecialist: 8,
  perJobTokenEstimate: 40_000,
  maxTransientRetries: 2,
};

export interface Run {
  id: string;
  project_id: string;
  initiator: string;
  kind: "brief" | "investigation";
  question: string;
  state: RunState;
  planned_roles: SpecialistKey[];
  budget: RunBudget;
  usage: RunUsage;
  idempotency_key: string;
  cancel_requested: boolean;
  brief: Brief | null;
  error: string | null;
  live: boolean;
  model: string | null;
  prompt_version: string | null;
  input_snapshot: Record<string, unknown>;
  permission_context: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface RunUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  costBasis: "actual" | "estimated" | "unknown";
  stoppedAtBudget: boolean;
}

export interface Job {
  id: string;
  run_id: string;
  project_id: string;
  role: SpecialistKey;
  task: string;
  state: JobState;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  checkpoint: Record<string, unknown> | null;
  output: JobOutput | null;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
  cost_basis: "actual" | "estimated" | "unknown";
  steps: number;
  model: string | null;
}

export interface JobOutput {
  publishable: SpecialistOutput | null;
  issues: ValidationIssue[];
  toolCalls: { tool: string; input: unknown; at: string }[];
  injectionFlags: { sourceId: string; patterns: string[] }[];
}

export interface ProposalInput {
  run_id: string;
  job_id: string | null;
  role: string;
  target_table: "claims" | "tasks" | "risks" | "decisions" | "drafts";
  target_id?: string | null;
  base_version?: number | null;
  mutation: Record<string, unknown>;
  dedupe_key: string;
}

export interface EvidenceItem {
  id: string;
  register_code: string | null;
  title: string;
  kind: string;
  source_date: string | null;
  availability: string;
  inherited: boolean;
  access_classification: string;
  /** extracted text if retrieved and accessible to this run; else null */
  text: string | null;
}

export interface ClaimItem {
  id: string;
  code: string | null;
  statement: string;
  evidence_class: string;
  review_state: string;
  limits: string | null;
  conflict_group: string | null;
  source_ids: string[];
}

export interface EvidenceScope {
  sources: EvidenceItem[];
  claims: ClaimItem[];
  projectVersion: string;
}

export interface Brief {
  question: string;
  generated_at: string;
  what_changed: string[];
  supporting_evidence: { statement: string; evidence_class: string; source_ids: string[]; role: string }[];
  conflicts: { key: string; positions: { role: string; statement: string; evidence_class: string }[]; evidence_needed: string }[];
  risks: { title: string; likelihood: string; impact: string; role: string }[];
  decisions_needed: { question: string; alternatives: string[]; recommendation: string | null; owner: string | null; deadline: string }[];
  next_actions: { action: string; why: string; link: string | null }[];
  unknowns: string[];
  partial_failures: { role: string; state: string; error: string | null }[];
  validation_issues: { role: string; path: string; message: string }[];
  injection_flags: { sourceId: string; patterns: string[] }[];
  mode: "live" | "fixture";
  narrative: string | null;
}
