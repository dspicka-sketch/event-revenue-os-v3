# Portfolio Register

## Standing policies
1. Every session has a project-manager and a file in `governance/sessions/`.
2. Nothing merges to `main` without PM "ready to merge" sign-off; cross-session or shared
   changes also need portfolio-manager approval.
3. Production deploys, spend, secrets, and legal commitments require the human owner.

## Active sessions
| Branch | Goal | Status | Risk | Last decision |
|--------|------|--------|------|---------------|
| claude/revos-implementation-lqwgz7 | RevOS app implementation (107 files, marketing/spend boards) | MERGED (#1) | — | Merged first |
| executive-os | Executive OS assistant agent + dashboard (25 files) | MERGED (#2) | — | Moved to executive-os/ to resolve root conflicts |
| claude/project-portfolio-managers-eynpup | PM / portfolio-manager governance | MERGED (#3) | — | Governance section appended to CLAUDE.md |

## Decision Log
| Date | Session/branch | Decision | Subject | Rationale |
|------|----------------|----------|---------|-----------|
| 2026-10-26 | all | APPROVED | Merge order: revos → executive-os → governance | revos is largest; shared root files must be reconciled once, by the smaller branch |
| 2026-10-26 | revos, executive-os | CONDITIONAL | Charters required | Each branch's PM must add `governance/sessions/<branch>.md` on its next session |
| 2026-10-26 | all | AWAITING OWNER | Merges to main | Reserved for human owner per policy 3 |
| 2026-10-26 | all | APPROVED (owner) | Merge #1, #2, #3 in order | Owner instruction |
