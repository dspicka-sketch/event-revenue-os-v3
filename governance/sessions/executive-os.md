# Session: executive-os

- **Opened:** 2026-11-04
- **Project manager:** project-manager agent
- **Status:** ACTIVE (PR to `main` approved to open; merge is the owner's decision)

## Goal
Deliver Executive OS (Next.js app in `executive-os/`, separate from RevOS) features on this branch and open a pull request from `executive-os` into `main` for owner review.

## Scope
- In:
  - Google Calendar tools (bdfcf36, merge 86edd2f)
  - Read-only RevOS API client for the assistant (82007a0)
  - Sample calendar emails switched to example.com so the secret scan passes (0d73866)
  - Sponsor pipeline with Supabase migration `executive-os/supabase/migrations/0002_sponsor_deals.sql` (131b7d5)
  - Opening a PR `executive-os` -> `main`
- Out:
  - Merging to `main` (owner decides)
  - Running migration 0002 against any real Supabase project (needs owner approval)
  - Production deploys, secrets, paid provisioning
  - Any change to RevOS shared code (`src/shared/`, `src/domain/`)

## Acceptance criteria
- [x] `npm run check` passes (70 tests pass; 38 DB tests skipped, no TEST_DATABASE_URL)
- [x] Executive OS typechecks and builds
- [x] Dashboard run locally against local RevOS server with fixture data
- [ ] PR opened `executive-os` -> `main` with verification gaps stated in the description
- Known gaps (must be stated in PR, not waived): Claude agent not exercised (no ANTHROPIC_API_KEY); migration 0002 not run against a real Supabase project; DB tests skipped.

## Risks / dependencies on other sessions
- Executive OS imports `src/shared/apiTypes.ts` and `src/domain/money.ts` from RevOS, and `next.config` sets turbopack root to the repo root. Changes in RevOS sessions to these files can break Executive OS. Escalated as E-002.
- RevOS API client must stay read-only and must not touch vendor APIs directly.

## Decision Log
| Date | Decision | Subject | Rationale |
|------|----------|---------|-----------|
| 2026-11-04 | APPROVED | Open PR `executive-os` -> `main` | All listed work is in session scope; check/typecheck/build pass; opening a PR is not a merge. PR must list verification gaps. Merge remains owner's decision. |
| 2026-11-04 | ESCALATED | Executive OS dependency on RevOS shared code (`src/shared/apiTypes.ts`, `src/domain/money.ts`, turbopack root at repo root) | Cross-session coupling to shared code; portfolio-level decision on whether this coupling is accepted. Logged as E-002. Does not block opening the PR; should be resolved before merge. |
