-- Sponsor pipeline. Amounts are integer minor units (cents) with a currency;
-- null means the amount is not known yet, never zero.
create table if not exists sponsor_deals (
  id uuid primary key default gen_random_uuid(),
  sponsor text not null,
  contact text,
  event_name text,
  tier text,
  stage text not null default 'lead'
    check (stage in ('lead','pitched','negotiating','verbal','signed','lost')),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  next_step text,
  next_step_due date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sponsor_deals enable row level security;
