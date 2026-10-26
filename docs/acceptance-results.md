# Acceptance results — 2026-10-26

Environment: cloud dev container, Node 22, local Postgres 16 with a Supabase auth/storage shim
(`tests/db/supabase-shim.sql`), Chromium via Playwright. **No live Supabase, Vercel or model
provider was used.** Deterministic tests prove control flow and policy; they are not evidence of
live model behaviour.

Totals: 63/63 vitest tests (unit 25, orchestration 17, DB 21) · 22/22 browser journey steps (demo mode)
· `tsc --noEmit` clean for app and `agent/` · `next build` succeeds.

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Anon/cross-project/viewer/editor escalation blocked; Storage path scoping | PASS (DB) | `tests/db/rls.test.ts` "access control" |
| 2 | Duplicate upload deduped; extraction failure visible and retryable | PASS (DB constraint + route); upload route not exercised against live Storage | `rls.test.ts` test 2, `api/sources/upload` |
| 3 | $1,050,000 and below-$800,000 kept dated; agreed price unknown | PASS (DB + browser) | `rls.test.ts` baseline; journey "property" |
| 4 | 1023-EZ → filing-confirmed finding + determination task, never "approved" | PASS (fixture) | `engine.test.ts` test 4 |
| 5 | Unsigned lease: terms vs execution; no "occupancy secure" | PASS (fixture) | `engine.test.ts` test 5 |
| 6 | Unsupported eligibility / invented source rejected + correction task | PASS | `engine.test.ts` test 6, `evidence.test.ts` |
| 7 | PDF prompt injection: no action, flagged, data only; no send tool exists | PASS (fixture) | `engine.test.ts` test 7 |
| 8 | Disagreement preserved, conflict surfaced, no overwrite | PASS | `engine.test.ts` test 8 |
| 9 | Resume after worker death, idempotent double submit, cancellation | PASS (memory + real Postgres race) | `engine.test.ts` test 9, `pg-orchestrator.test.ts` |
| 10 | Partial failure; retry only failed job | PASS | `engine.test.ts` test 10 |
| 11 | Budget cap stops at boundary; usage honest (cost unknown) | PASS | `engine.test.ts` test 11 |
| 12 | $100k binding / $40k received → $40k cash + $60k remaining; conditional separate; unknown gap | PASS (unit + browser) | `funding.test.ts`, journey "funding" |
| 13 | External send → draft + approval request; edit invalidates; no self/agent approval | PASS (DB + fixture) | `rls.test.ts` test 13, `engine.test.ts` test 13 |
| 14 | Decision needs owner; stale version rejected; audit has actor + version | PASS (DB) | `rls.test.ts` test 14 |
| 15 | 390px + desktop: open source, edit task, run brief, review decision, keyboard, states | PASS in DEMO mode | `tests/e2e/journey.mjs`; live login not tested |
| 16 | Export/reimport round trip; no signed URLs/secrets | PASS (DB) | `tests/db/export.test.ts` |
| 17 | Real end-to-end run with configured model and source | **NOT RUN — blocked** | see below |

## Blockers (not live-tested)
1. **Model provider:** this container's egress proxy rejects `ai-gateway.vercel.sh`, and no
   `AGENT_MODEL`/gateway credential is configured. `GatewayModelClient` is type-checked but has
   never executed. Test 17 remains open.
2. **Supabase:** no dedicated project exists. Existing projects in the account belong to other apps
   and were not touched. Migrations were validated only on local Postgres 16 with a shim (Supabase
   runs Postgres 17); Storage policies and Auth OTP flow are untested against Supabase.
3. **Vercel:** no project created or deployed; no preview URL. Cron schedule is daily (Hobby-safe).
4. **eve:** `agent/` type-checks against eve 0.83.2, but `eve info/build` could not complete here
   (needs Node 24 and gateway model metadata, which is blocked). It is not mounted in Next.js yet.
5. **Extraction:** PDF text via `unpdf`; no OCR (image pages fail visibly); DOCX has no extractor.
