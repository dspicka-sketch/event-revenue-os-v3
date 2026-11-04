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
| executive-os | Executive OS assistant agent + dashboard (25 files) | IN REVIEW (follow-up PR) | Medium: unchecked cross-package imports | E-002 CONDITIONAL 2026-11-04 |
| claude/project-portfolio-managers-eynpup | PM / portfolio-manager governance | MERGED (#3) | — | Governance section appended to CLAUDE.md |

## Decision Log
| Date | Session/branch | Decision | Subject | Rationale |
|------|----------------|----------|---------|-----------|
| 2026-10-26 | all | APPROVED | Merge order: revos → executive-os → governance | revos is largest; shared root files must be reconciled once, by the smaller branch |
| 2026-10-26 | revos, executive-os | CONDITIONAL | Charters required | Each branch's PM must add `governance/sessions/<branch>.md` on its next session |
| 2026-10-26 | all | AWAITING OWNER | Merges to main | Reserved for human owner per policy 3 |
| 2026-10-26 | all | APPROVED (owner) | Merge #1, #2, #3 in order | Owner instruction |
| 2026-11-04 | executive-os | CONDITIONAL | E-002: Executive OS coupling to src/shared + src/domain/money.ts and repo-root turbopack/outputFileTracingRoot | Accepted: mirrors mobile/, honours CLAUDE.md single-source money/contract rule; data access is HTTP-only. Conditions before merge-ready: C1 imports limited to type-only src/shared/apiTypes.ts and pure (no I/O) src/domain modules, no src/server, src/db, src/providers, src/auth, src/sync; C2 root `npm run check` (or CI) also runs `cd executive-os && npx tsc --noEmit && npm run build` so RevOS changes to shared files break the build; C3 record the coupling and root setting in docs/DECISIONS.md and docs/STATUS.md. Merge to main AWAITING OWNER |
