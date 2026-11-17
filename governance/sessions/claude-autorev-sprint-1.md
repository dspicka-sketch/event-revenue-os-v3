# Session: claude/autorev-sprint-1

- **Opened:** 2026-11-16
- **Project manager:** charter written by the session itself; the `project-manager` subagent was not available in the cloud session that opened this branch. Needs PM review before "ready to merge".
- **Status:** ACTIVE (E-004 OPEN)
- **Branched from:** `main` at `586b1e3`. Does not include the unmerged Gemini (PR #5) or On The Stage branches.

## Goal
AutoRev, RevOS's automation layer (D19): find underplay candidates for Wax Poetic every day from Bay Shows data and a watchlist, refresh every live show on a schedule, and email each organization's admins a weekly digest of candidates, pace and attention items.

## Scope
- In: discovery rules, Bay Shows reader, watchlist and candidate pipeline, sync sweep, automation run log, Resend email sender, digest text, three bearer-protected cron routes, Vercel Cron schedule, docs. Plan: `docs/superpowers/plans/2026-11-16-autorev-plan-1.md`.
- Out: announce pack, agent research and outreach drafts, RouteBuilder economics, national monthly report, booking and show-day task tracking, On The Stage, password reset, DB-backed throttle, mobile, web UI for discovery.

## Acceptance criteria
- [ ] `npm run check` passes with `TEST_DATABASE_URL` set (DB tests run, not skipped).
- [ ] Cron routes answer 503 when unconfigured and 401 on a wrong bearer.
- [ ] Fixture organizations are never swept and never emailed.
- [ ] A contacted candidate keeps its stage when it reappears.
- [ ] Live gate (plan Task 7) is recorded as BLOCKED on the owner's steps until done.

## Risks / dependencies on other sessions
- Edits `src/server/app.ts`, `vercel.json` and shared docs that PR #5 and `claude/on-the-stage-sprint-1` also edit. Merge order escalated as E-004.
- D19 widens what RevOS is (automation, an outbound digest email, a booking pipeline). The owner approved it on 2026-11-16; CLAUDE.md's "not a CRM, booking system or marketing sender" line is narrowed by D19 and should be reworded when this merges.
- Pulls scheduled sync ahead of the adopted sprint order (D18 puts it in Sprint 3).

## Decision Log
| Date | Decision | Subject | Rationale |
|------|----------|---------|-----------|
| 2026-11-16 | APPROVED (owner) | AutoRev design and plan 1; discovery first; one repo; Supabase for the database | Owner instruction in chat: "All changes approved", "Incorporate into AutoRev and let's go back to our build" |
| 2026-11-16 | APPROVED (owner) | Where the ChatGPT handoff v6.1 conflicts with existing records, flag it and use the session's judgment | Owner instruction: "Flag inconsistencies and defer to Claude" |
