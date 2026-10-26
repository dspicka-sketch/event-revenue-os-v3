# Architecture

```
Browser (iPhone/desktop) ──► Next.js 16 on Vercel ──► Supabase Postgres (RLS) + private Storage
                                │  pages/actions run as the signed-in user (anon key + cookie session)
                                │
                                ├─ /api/runs ──► Orchestrator ──► PgRunStore (DATABASE_URL, server only)
                                │                    │                └─ agent_runs / agent_jobs / run_events / proposals
                                │                    └─ ModelClient: Vercel AI Gateway (AGENT_MODEL) | Fixture (tests/demo)
                                └─ /api/worker/tick (Vercel Cron) resumes queued runs and expired leases
eve agent/ (optional chat front door) ── typed tools ──► same Orchestrator
```

## Decisions
1. **Project state lives in Postgres**, never in a transcript. Agents write *proposals*; only a
   person promotes them into claims/tasks/risks/decisions/drafts (`/review`).
2. **Durable execution = Postgres job queue with leases.** Each specialist is an `agent_jobs` row,
   claimed with `FOR UPDATE SKIP LOCKED`, heartbeated, and finished atomically together with its
   proposals (dedupe keys). Completed jobs are checkpoints and never re-run; expired leases are
   reclaimed by any worker; the cron tick resumes stalled runs. Runs survive the browser closing.
   *Why not eve for execution:* eve 0.83 is preview, requires Node ≥24, and its workflow durability
   would duplicate state the spec requires in Supabase. eve is used as the conversational chief
   front door (`agent/`) with `defaultTools: false` and typed tools that call this orchestrator.
   Each specialist step is bounded (tool steps, output tokens) so it fits in one function invocation.
3. **Dispatch** is deterministic keyword scoring over the shared role spec (max 4 specialists,
   concurrency 3); briefs use strategist + general counsel + data engineer. Specialists cannot spawn agents.
4. **Validation before publication** (`src/lib/domain/evidence.ts`): schema, cited source ids must be
   in the run's scope, agents cannot claim `verified_current`, eligibility/deadline/title/zoning
   statements need citations, and forbidden assertions (501(c)(3) approved, occupancy secure, seller
   accepted, NIVA endorsement, legal approval…) are rejected and turned into correction tasks.
5. **Reconciliation** is deterministic: disagreements (same `conflict_key`, different statements)
   are preserved and surfaced first; agreement is not evidence; at most three next actions.
6. **Limits enforced in code**: token cap with per-job reservation, optional cost cap, step cap,
   2 transient retries, cancellation checked before every model and tool call. Cost is shown as
   actual only when the gateway reports it, estimated if pricing env is set, otherwise unknown.
7. **Permissions server-side**: RLS on every table; owner/editor/viewer; restricted sources owner-only;
   decisions, approvals and stage transitions owner-only (triggers); approvals bind action, target,
   content hash, record version, scope and expiry; editing content invalidates; a credential with no
   user identity (the agent worker) can never approve. Audit trail is append-only.
8. **Tools exposed to specialists**: `search_sources`, `read_source` (wrapped as untrusted data, with
   embedded-instruction detection), `read_claims`, `submit_findings`. No shell, SQL, web, or send tools.
9. **Two agent layers** share `src/lib/domain/roles.ts`: runtime prompts, eve instructions and
   `.claude/agents/*` are generated from it; `roles:check` and a unit test fail on drift.
