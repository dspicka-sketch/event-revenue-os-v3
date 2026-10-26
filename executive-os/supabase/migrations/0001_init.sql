create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  due_date date,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'open' check (status in ('open','waiting','done')),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table if not exists email_triage (
  message_id text primary key,
  thread_id text not null,
  sender text not null,
  subject text not null,
  snippet text,
  received_at timestamptz,
  category text not null check (category in ('urgent','reply','fyi','ignore')),
  summary text,
  draft_id text,
  triaged_at timestamptz not null default now()
);

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

-- Server-side access only (service role); no public policies.
alter table tasks enable row level security;
alter table email_triage enable row level security;
alter table briefings enable row level security;
alter table activity enable row level security;
