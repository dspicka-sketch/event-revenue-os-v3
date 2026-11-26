# Session: claude/candidates-screen

- **Opened:** 2026-11-25
- **Project manager:** project-manager agent (charter was first written by the session itself; reviewed and taken over by the PM on 2026-11-25)
- **Status:** ACTIVE (E-004 OPEN, inherited; E-005 raised, see Escalations)
- **Branched from:** `claude/autorev-sprint-1` at `57b4e08`. Stacked on that unmerged branch, so it cannot merge to `main` before it. One commit pushed: `9e0edee` "Discovery screen and short-lead flag".

## Goal
Give the owner and a remote team member a working preview that shows real, useful discovery data: a desktop Discovery screen over the existing candidate API, the short-lead flag the owner asked for on 2026-11-20, and a candidate list filtered to acts that are reasonable for a 60-seat seated listening room (discovery v0.2).

## Scope
- In:
  - Discovery page in `src/web/`, `leadTime` domain rule and its two API fields, tests, STATUS. (Done in `9e0edee`.)
  - Discovery v0.2 candidate filtering in `src/domain/discovery.ts` with tests and docs (added 2026-11-25 on owner instruction).
  - Preview environment for this branch: Supabase project `revos`, Vercel env vars, preview deployments, two accounts (owner admin, remote team member viewer). Owner-approved; see Decision Log.
- Out: deal-model and fit scoring, ticket-price logic, mobile Discovery screen, On The Stage, production deploy, merge to `main`, any change to the cron schedule or `vercel.json`, any external write to Bay Shows or another vendor.

### Discovery v0.2 rules (owner: "Keep comedy and any touring performing arts that are reasonable in a 60 seat house. Filter.")
- Keep: comedy and touring performing arts that suit a 60-seat house.
- Drop non-touring formats: karaoke, open mic, bar/pub crawls, themed dance/party/rave nights, kids' series, local multi-band bills.
- Drop the venue's own events.
- Presenter billings stay in (owner tuning in `57b4e08`); read the artist name out of billings such as "Moe's Alley Presents: X".
- Session judgment calls, not owner words, to be reported to the owner as reversible: drop tribute acts; treat Punk / Metal as not reasonable for a seated 60-seat listening room.

## Acceptance criteria
- [ ] `npm run check` passes with `TEST_DATABASE_URL` set (DB tests run, not skipped). Reported passing for `9e0edee` by the session; not re-run by the PM, and must be re-run after v0.2.
- [x] Viewers cannot change a candidate (existing API rule; the page hides the controls). Reported by the session.
- [ ] Every v0.2 exclusion rule has a test with a kept and a dropped example, including a presenter billing whose artist name is extracted and a comedy show that is kept.
- [ ] Rules live only in `src/domain/` (pure, no I/O); neither client re-implements them.
- [ ] The two judgment calls (tribute, Punk / Metal) are each a single, separately removable rule, and are listed for the owner in the session's report and in `docs/DECISIONS.md`.
- [ ] `docs/DECISIONS.md` and `docs/STATUS.md` record v0.2 before or with the code change.
- [ ] Discovery run against Bay Shows verified by hand on the preview deployment, and recorded as a manual run. The scheduled run stays recorded as unverified (Vercel Cron runs on production only).
- [ ] Viewer account checked on the preview: can read candidates, cannot change them, non-member organizations answer 404.
- [ ] No secret value in Git, logs, client bundle, chat or this file; the database stores only secret names.

## Risks / dependencies on other sessions
- Stacked on `claude/autorev-sprint-1`. Edits `src/domain/discovery.ts`, `src/server/autorev.ts` and `src/shared/apiTypes.ts`, which that branch created or also edits. Merge order is E-004 (OPEN); this branch now has to be added to it.
- Vercel env vars were set for the **production** target as well as preview, pointing at a database provisioned for the preview. Nothing is deployed to production today, but a later production deploy would pick these values up as they are, and the three cron schedules would start running against that database. Needs an explicit owner decision before any production deploy (E-005).
- "Fewest approvals" is read as applying to work inside this session's scope. It does not waive standing policy 3: production deploys, further spend, new secrets and merges to `main` still go to the owner.
- Paid Supabase project is a recurring cost; no budget or teardown date is recorded.
- A second person (remote viewer) now has access to a deployment holding real Bay Shows discovery data. Access depends on the membership check and on Vercel preview protection settings, neither verified by the PM.
- Filter rules work from event titles and genre labels; expect false drops. Dropped events are not visible on the page, so a wrong rule is hard for the owner to notice. Mitigation: per-rule tests and the reversible-rule criterion above; a "filtered out" count or list is a candidate follow-up, not in scope.
- Owner approvals below are recorded as relayed by the session from chat; the PM did not see the chat.
- Another process was editing `src/`, `test/` and `docs/` in this checkout during PM review, so the diff for v0.2 has not been reviewed. No "ready to merge" sign-off exists.

## Escalations
| ID | To | Subject | Status |
|----|----|---------|--------|
| E-004 | portfolio-manager, owner | Merge order (inherited). Add: `claude/candidates-screen` is stacked on `claude/autorev-sprint-1` and must merge after it or as part of it. | OPEN |
| E-005 | portfolio-manager | Register owner-approved items outside PM authority: paid Supabase project `revos`; five Vercel env vars (secrets) on production and preview targets; preview deployments; two user accounts. Rule on whether production-target values may stay set before a production database decision. Add this branch and `claude/autorev-sprint-1` to the Active sessions table in `governance/portfolio.md`. | OPEN. Row not yet written to `governance/escalations.md`: the PM was limited to this file for this review; the session must add it. |

## Decision Log
| Date | Decision | Subject | Rationale |
|------|----------|---------|-----------|
| 2026-11-20 | APPROVED (owner) | Short-lead flag on candidates | Owner request; flag only, no filter, no ranking penalty |
| 2026-11-25 | APPROVED (owner, as relayed) | New paid Supabase project `revos` for the preview database | Owner instruction in chat. Spend is an owner decision (policy 3); outside PM authority, registered under E-005 |
| 2026-11-25 | APPROVED (owner, as relayed) | Vercel env vars DATABASE_URL, CRON_SECRET, BAYSHOWS_SUPABASE_URL, BAYSHOWS_SUPABASE_KEY, REVOS_DISCOVERY_ORG_ID on production and preview targets | Owner instruction in chat. Secrets are an owner decision; outside PM authority, registered under E-005 |
| 2026-11-25 | APPROVED (owner, as relayed) | Preview deployments of this branch; accounts for the owner (admin) and a remote team member (viewer) | Owner instruction in chat. No production deploy, no merge to `main` |
| 2026-11-25 | APPROVED | PM review of the self-written charter | Goal and scope match commit `9e0edee`; charter restructured to the template, risks and decision log added, `npm run check` criterion reopened for re-run after v0.2 |
| 2026-11-25 | APPROVED (owner) | Scope addition: discovery v0.2 candidate filtering | Owner instruction: "Keep comedy and any touring performing arts that are reasonable in a 60 seat house. Filter." Larger than a minor scope change, so it rests on the owner's instruction, not on PM authority; reported to the portfolio-manager under E-005 |
| 2026-11-25 | APPROVED | v0.2 approach: pure rules in `src/domain/discovery.ts`; drop non-touring formats and the venue's own events; extract the artist from presenter billings | Follows the owner's words and the earlier "promoter billings stay in" tuning; stays on this branch's files; domain-only per CLAUDE.md |
| 2026-11-25 | APPROVED (conditional) | Tribute-act and Punk / Metal exclusions | Session judgment, not owner words. Allowed on condition that each is a separately removable rule and both are reported to the owner as reversible |
| 2026-11-25 | APPROVED | Verify discovery on the preview by a manual run | Vercel Cron runs on production only. The manual run counts for this session's criterion; the schedule stays unverified and must not be reported as verified |
| 2026-11-25 | REJECTED | Reading "fewest approvals" as covering production deploy, merge to `main`, further spend or new secrets | Standing policy 3 and CLAUDE.md reserve these for the owner, case by case |
| 2026-11-25 | ESCALATED | E-004: add this branch to the merge-order question | Stacked on an unmerged branch and edits files it shares |
| 2026-11-25 | ESCALATED | E-005: paid service, secrets on the production target, accounts, portfolio register | PM must escalate paid services, secrets and anything production-facing even when the owner has already decided |

## Owner decisions, 2026-11-26 (as given in chat)
- Punk / Metal stays excluded: confirmed.
- Tribute acts: include. The v0.2 tribute rule is removed.
- Bills of three or more acts: include. The v0.2 shared-bill rule is removed; a bill is listed under its first act.
- Method bumped to discovery v0.3. `npm run check` with `TEST_DATABASE_URL`: 200 of 200 passed.
