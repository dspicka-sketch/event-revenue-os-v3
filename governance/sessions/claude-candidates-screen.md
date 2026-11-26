# Session: claude/candidates-screen

- **Opened:** 2026-11-25
- **Project manager:** charter written by the session itself; the `project-manager` subagent was not available in the chat session that opened this branch. Needs PM review.
- **Status:** ACTIVE
- **Branched from:** `claude/autorev-sprint-1` at `57b4e08`. Inherits that branch's open escalation E-004 (merge order).

## Goal
Give the owner and a remote team member a working preview that shows real discovery data: a desktop Discovery screen over the existing candidate API, plus the short-lead flag the owner asked for on 2026-11-20.

## Scope
- In: Discovery page in `src/web/`, `leadTime` domain rule and its two API fields, tests, STATUS.
- Out: deal-model and fit scoring, ticket-price logic, mobile Discovery screen, On The Stage, production deploy, merge to `main`.

## Decisions taken in session (owner instructions, 2026-11-25)
- Owner approved a new Supabase database for RevOS and asked for the work to be automated with the fewest approvals.
- Short lead is a flag only: no filter, no ranking penalty.

## Acceptance criteria
- [x] `npm run check` passes with `TEST_DATABASE_URL` set.
- [x] Viewers cannot change a candidate (existing API rule; the page hides the controls).
- [ ] Discovery run against Bay Shows verified on the preview deployment.
