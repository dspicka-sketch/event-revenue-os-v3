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
| claude/gemini-api-integration-1kmvul | Server-side Gemini show-insight narrative (`src/ai/`, `@google/genai`, `GEMINI_API_KEY`), owner-initiated | ACTIVE — E-002 CONDITIONAL; live verification BLOCKED (network 403) | Medium: new third-party processor, new secret name, floating model alias; no client-bundle or DB impact | 2026-10-28 PfM: dependency + secret name CONDITIONAL; key provisioning and merge AWAITING OWNER |

## Decision Log
| Date | Session/branch | Decision | Subject | Rationale |
|------|----------------|----------|---------|-----------|
| 2026-10-26 | all | APPROVED | Merge order: revos → executive-os → governance | revos is largest; shared root files must be reconciled once, by the smaller branch |
| 2026-10-26 | revos, executive-os | CONDITIONAL | Charters required | Each branch's PM must add `governance/sessions/<branch>.md` on its next session |
| 2026-10-26 | all | AWAITING OWNER | Merges to main | Reserved for human owner per policy 3 |
| 2026-10-26 | all | APPROVED (owner) | Merge #1, #2, #3 in order | Owner instruction |
| 2026-10-28 | claude/gemini-api-integration-1kmvul | CONDITIONAL | E-002: add dependency `@google/genai` ^2.31.0 and secret name `GEMINI_API_KEY` to `.env.example` and docs | Integration itself is the owner's request (owner opened the branch with the quickstart). SDK is Google's official client, Apache-2.0, server-side only, no client-bundle impact; branch has no divergence from `main` and no other active sessions, so no merge-order conflict. PM-approved design (read-only toward Gemini, aggregate figures only, no PII, output labeled AI-generated and never parsed into money/counts, `configured:false` without a key) satisfies CLAUDE.md money/privacy/access/integration rules. Conditions: **C1** `package.json` commit is limited to the one dependency line plus `package-lock.json`; revert the incidental description re-encoding (`\u2014` → literal em dash) or commit it separately. **C2** `@google/genai` is imported only under `src/ai/` (server); a test or the secret-scan/check step must fail if `src/web/`, `mobile/` or `src/shared/` import it. **C3** `GEMINI_API_KEY` appears in `.env.example` with an empty value and in docs by name only; the DB, API responses and logs carry at most a boolean `configured`. **C4** `docs/integrations.md` records Gemini as an *outbound* third-party processor (aggregate figures only, read-only, evidence level: unit/fixture with fake client, live NOT verified) and `docs/STATUS.md` marks live verification BLOCKED with the exact next step. **C5** Generation is on-demand per authorized member request only: no background jobs, no scheduled calls, no automatic retry loops, no caching of generated text in the DB (spend containment). **C6** D17 records that `gemini-flash-latest` is a floating alias and that model output is never a source of truth. **C7** `npm run check` passes before the dependency commit; PM ready-to-merge sign-off still required. |
| 2026-10-28 | claude/gemini-api-integration-1kmvul | AWAITING OWNER | Provisioning a real `GEMINI_API_KEY` (including accepting Google's API terms), any spend beyond the free tier, and merge to `main` | Reserved for the human owner per standing policy 3. Recommendation: provision a key only in the server environment / secret manager of a host that can reach `generativelanguage.googleapis.com`, run the insight endpoint once against a fixture org to clear the BLOCKED live-verification item, then merge after PM sign-off. Nothing on the branch requires the key to work; without it the endpoint returns `configured:false`. |
