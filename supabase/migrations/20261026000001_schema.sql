-- Protect 104: core schema.
-- Every business record carries id, project_id, created_at, updated_at, row_version.
-- Timestamps are stored in UTC (timestamptz). Date-only deadlines are stored as `date`
-- together with the timezone they were stated in; they are never converted.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mission text not null,
  timezone text not null default 'America/Los_Angeles',
  stage text not null default 'baseline'
    check (stage in ('baseline','feasibility','structure_funding','authorized_execution','stewardship')),
  demo boolean not null default false,
  run_cost_cap_usd numeric(10,2),
  max_concurrent_specialists int not null default 3 check (max_concurrent_specialists between 1 and 7),
  max_tokens_per_run int not null default 400000 check (max_tokens_per_run > 0),
  max_steps_per_specialist int not null default 8 check (max_steps_per_specialist between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner','editor','viewer')),
  access_state text not null default 'active' check (access_state in ('invited','active','revoked')),
  invited_email text,
  display_timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (project_id, user_id)
);

-- Stage changes require evidence-backed criteria and sponsor signoff.
create table public.stage_transitions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_stage text not null,
  to_stage text not null,
  criteria_claim_ids uuid[] not null default '{}',
  signed_off_by uuid not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  register_code text,                       -- e.g. S01..S11 from the handoff register
  kind text not null check (kind in ('document','email','web_page','statute','user_instruction','dataset','other')),
  title text not null,
  source_date date,                         -- date the source itself carries
  retrieved_at timestamptz,                 -- when someone actually retrieved it
  retrieved_by text,                        -- reviewer identity (user id, or 'inherited:chatgpt-session')
  original_url text,
  provider_id text,                         -- e.g. library id; a lead, not proof of access
  access_classification text not null default 'confidential'
    check (access_classification in ('public','internal','confidential','restricted')),
  availability text not null default 'unavailable'
    check (availability in ('available','unavailable','pending_retrieval')),
  inherited boolean not null default false,
  retrieval_task text,
  coverage_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (project_id, register_code)
);

create table public.source_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  version_no int not null,
  storage_key text,                         -- private Storage key: <project_id>/<source_id>/<checksum>
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  original_filename text,
  extractor_version text,
  extraction_state text not null default 'queued'
    check (extraction_state in ('queued','running','succeeded','failed','not_applicable')),
  extraction_error text,
  extraction_attempts int not null default 0,
  ocr_used boolean not null default false,
  ocr_limitations text,
  extracted_text text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (source_id, version_no),
  -- Identical bytes in one project are stored once; re-upload returns the existing version.
  unique (project_id, checksum_sha256)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code text,                                -- e.g. F01..F11
  statement text not null,
  limits text,                              -- what the evidence does NOT establish
  topic text,
  evidence_class text not null
    check (evidence_class in ('verified_current','documented_historical','user_reported','proposed','inferred','unknown')),
  -- Verification workflow is tracked separately from evidence class.
  review_state text not null default 'proposed'
    check (review_state in ('proposed','accepted','rejected','needs_review','superseded')),
  origin text not null default 'user' check (origin in ('inherited','user','agent','import')),
  inherited_unverified boolean not null default false,
  verified_by text,
  verified_at timestamptz,
  next_check_at timestamptz,
  conflict_group text,
  supersedes_id uuid references public.claims(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (project_id, code),
  check (review_state <> 'accepted' or evidence_class <> 'unknown')
);

create table public.claim_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  source_version_id uuid references public.source_versions(id),
  locator text,                             -- page / section
  passage text check (passage is null or length(passage) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

-- ---------------------------------------------------------------------------
-- Work management
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  assigned_role text check (assigned_role in
    ('chief_of_staff','public_policy','fundraising','community_outreach','data_engineer','niva_liaison','strategist','general_counsel')),
  secondary_role text,
  assigned_user uuid,
  status text not null default 'open' check (status in ('open','in_progress','blocked','done','archived')),
  due_at timestamptz,
  due_date date,
  due_timezone text,
  deadline_kind text not null default 'unset'
    check (deadline_kind in ('unset','external_hard','external_soft','internal_target')),
  due_provenance text,                      -- where the deadline came from
  next_action text,
  blocked_reason text,
  completion_evidence text,
  origin text not null default 'user' check (origin in ('seed','user','agent','correction')),
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (deadline_kind = 'unset' or due_at is not null or due_date is not null),
  check (deadline_kind = 'unset' or due_provenance is not null),
  check (status <> 'blocked' or blocked_reason is not null)
);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

create table public.risks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  likelihood text not null default 'unknown' check (likelihood in ('unknown','low','medium','high')),
  impact text not null default 'unknown' check (impact in ('unknown','low','medium','high','severe')),
  mitigation text,
  owner_role text,
  owner_user uuid,
  review_date date,
  status text not null default 'open' check (status in ('open','mitigating','closed','archived')),
  claim_ids uuid[] not null default '{}',
  task_ids uuid[] not null default '{}',
  origin text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  question text not null,
  recommendation text,
  alternatives jsonb not null default '[]',   -- [{label, implications, cost_note}]
  implications text,
  owner text,
  deadline_date date,
  deadline_kind text not null default 'unset'
    check (deadline_kind in ('unset','external_hard','external_soft','internal_target')),
  state text not null default 'open' check (state in ('open','accepted','rejected','deferred')),
  chosen_alternative text,
  decided_by uuid,
  decided_at timestamptz,
  rationale text,
  claim_ids uuid[] not null default '{}',
  origin text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (state = 'open' or (decided_by is not null and decided_at is not null and rationale is not null))
);

-- ---------------------------------------------------------------------------
-- Property
-- ---------------------------------------------------------------------------
create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  observed_on date,                         -- null when the observation is undated
  observed_on_note text,
  kind text not null check (kind in ('broker_list','outbound_proposal','user_reported','appraisal','agreed')),
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  comparator text not null default 'exact' check (comparator in ('exact','below','above','approximately')),
  status_note text not null,
  claim_id uuid references public.claims(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  -- an "agreed" price requires a supporting claim; it is never seeded.
  check (kind <> 'agreed' or claim_id is not null)
);

create table public.property_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  area text not null check (area in ('ownership','apn','title','leases','condition','zoning','other')),
  item text not null,
  status text not null default 'not_established'
    check (status in ('not_established','in_progress','established','disputed')),
  claim_ids uuid[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

-- ---------------------------------------------------------------------------
-- Governance options (nothing is selected without a decision record)
-- ---------------------------------------------------------------------------
create table public.governance_options (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  dimension text not null check (dimension in ('owner_entity','protection_duration','protected_uses','board_design','enforcement','financing')),
  label text not null,
  description text,
  tradeoffs text,
  state text not null default 'under_review' check (state in ('under_review','rejected','selected')),
  decision_id uuid references public.decisions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (state <> 'selected' or decision_id is not null)
);

-- ---------------------------------------------------------------------------
-- Stakeholders
-- ---------------------------------------------------------------------------
create table public.stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  entity text,
  role text,
  privacy text not null default 'private' check (privacy in ('private','internal','public')),
  consent_state text not null default 'unknown' check (consent_state in ('unknown','not_asked','granted','declined')),
  relationship text,
  support_status text not null default 'unknown'
    check (support_status in ('unknown','stated_support','stated_concern','declined')),
  support_claim_id uuid references public.claims(id),
  source_note text,
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  -- Support is never inferred: a stated position needs a supporting claim.
  check (support_status = 'unknown' or support_claim_id is not null)
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stakeholder_id uuid not null references public.stakeholders(id) on delete cascade,
  occurred_on date,
  kind text not null check (kind in ('email','call','meeting','text','other')),
  status text not null check (status in ('draft','sent_recorded','received')),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (status = 'draft' or occurred_on is not null)
);

-- ---------------------------------------------------------------------------
-- Funding and finance (all money in integer cents; null = not established)
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  funder text,
  eligibility_claim_id uuid references public.claims(id),
  geography text,
  uses text,
  deadline_date date,
  deadline_timezone text,
  deadline_kind text not null default 'unset' check (deadline_kind in ('unset','external_hard','external_soft','internal_target')),
  stage text not null default 'identified' check (stage in ('identified','qualifying','qualified','applied','declined','awarded','withdrawn')),
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (stage not in ('qualified','applied','awarded') or eligibility_claim_id is not null)
);

create table public.funding_commitments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id),
  funder text not null,
  stage text not null check (stage in ('prospect','application','conditional_pledge','binding_commitment')),
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  restriction text,                          -- purpose restriction; null = unrestricted not established
  restricted_to text check (restricted_to in ('acquisition','operating','capital_repair','program','unrestricted')),
  expires_on date,
  agreement_source_id uuid references public.sources(id),
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (stage <> 'binding_commitment' or agreement_source_id is not null or synthetic)
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  commitment_id uuid references public.funding_commitments(id),
  amount_cents bigint not null check (amount_cents > 0),
  received_on date not null,
  source_id uuid references public.sources(id),
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

create table public.financial_scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft','base','rejected','archived')),
  capital_target_cents bigint,               -- null = not established
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

create table public.financial_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scenario_id uuid not null references public.financial_scenarios(id) on delete cascade,
  label text not null,
  line_kind text not null check (line_kind in ('source','use','income','expense')),
  category text,
  boundary text not null check (boundary in ('property','operator','program')),
  period text not null default 'one_time',
  amount_cents bigint,                       -- null = not established
  assumption text,
  assumption_state text not null default 'proposed' check (assumption_state in ('proposed','accepted','rejected')),
  source_claim_id uuid references public.claims(id),
  -- intra-project transfer (e.g. operator rent paid to property) to eliminate in combined views
  internal_transfer_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

-- ---------------------------------------------------------------------------
-- Agent runtime records
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  initiator uuid not null,
  kind text not null check (kind in ('brief','investigation')),
  question text not null,
  input_snapshot jsonb not null default '{}',
  project_version text,
  permission_context jsonb not null default '{}',
  state text not null default 'queued'
    check (state in ('queued','running','waiting_for_input','waiting_for_approval','partial','completed','failed','cancelled')),
  planned_roles text[] not null default '{}',
  budget jsonb not null default '{}',
  usage jsonb not null default '{}',
  prompt_version text,
  model text,
  idempotency_key text not null,
  cancel_requested boolean not null default false,
  brief jsonb,
  error text,
  live boolean not null default false,       -- true only when a real model provider executed
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (project_id, idempotency_key)
);

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  role text not null,
  task text not null,
  state text not null default 'queued'
    check (state in ('queued','running','completed','failed','cancelled','skipped_budget')),
  attempt int not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  checkpoint jsonb,
  output jsonb,
  error text,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric(10,4),
  cost_basis text not null default 'unknown' check (cost_basis in ('actual','estimated','unknown')),
  steps int not null default 0,
  model text,
  prompt_version text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (run_id, role)
);

create table public.run_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  job_id uuid references public.agent_jobs(id) on delete cascade,
  seq bigint generated always as identity,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete cascade,
  job_id uuid references public.agent_jobs(id) on delete cascade,
  role text,
  target_table text not null check (target_table in ('claims','tasks','risks','decisions','drafts')),
  target_id uuid,
  base_version int,
  mutation jsonb not null,
  state text not null default 'pending' check (state in ('pending','applied','rejected','invalid')),
  validation_errors jsonb,
  dedupe_key text not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (project_id, dedupe_key)
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('email','inquiry','memo','listening_guide','other')),
  title text not null,
  audience text,                             -- intended recipients (never auto-sent)
  body text not null,
  content_hash text not null,
  contains_confidential boolean not null default false,
  state text not null default 'draft' check (state in ('draft','approved','invalidated','archived')),
  origin text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  action_kind text not null check (action_kind in
    ('external_send','invitation','publication','grant_submission','financial_commitment','paid_service','signature','binding_representation','decision')),
  target text not null,                      -- recipient / target description
  record_table text not null,
  record_id uuid not null,
  record_version int not null,
  content_hash text not null,
  scope text not null,
  requested_by_role text,                    -- agent role, if an agent requested it
  requested_by_user uuid,
  state text not null default 'requested'
    check (state in ('requested','approved','rejected','invalidated','expired')),
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  check (state <> 'approved' or (approved_by is not null and approved_at is not null and expires_at is not null))
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null,
  state text not null default 'not_configured'
    check (state in ('not_configured','configured_unverified','connected','error','disabled')),
  scopes text[] not null default '{}',
  verified_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version int not null default 1,
  unique (project_id, provider),
  check (state <> 'connected' or verified_at is not null)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  actor uuid,
  actor_kind text not null default 'user',
  action text not null,
  table_name text not null,
  record_id uuid,
  record_version int,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index on public.project_members (user_id);
create index on public.claims (project_id, review_state);
create index on public.claims (project_id, conflict_group);
create index on public.claim_sources (claim_id);
create index on public.tasks (project_id, status);
create index on public.risks (project_id, status);
create index on public.decisions (project_id, state);
create index on public.agent_runs (project_id, created_at desc);
create index on public.agent_jobs (run_id, state);
create index on public.agent_jobs (state, lease_expires_at);
create index on public.run_events (run_id, seq);
create index on public.proposals (project_id, state);
create index on public.audit_events (project_id, created_at desc);
create index on public.receipts (commitment_id);
