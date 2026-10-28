# Session: claude/gemini-api-integration-1kmvul

- **Opened:** 2026-10-28
- **Project manager:** project-manager agent
- **Status:** READY TO MERGE (PM sign-off 2026-10-28). Live Gemini verification remains **BLOCKED**; key provisioning and merge to `main` are **AWAITING OWNER** (portfolio policy 3).

## Goal
Add a server-side Gemini API integration to RevOS: the Node/TypeScript equivalent of the Python
quickstart the user pasted (`google-genai` client, model `gemini-flash-latest`, `generate_content`,
print `response.text`), using the official `@google/genai` npm SDK, with the API key read from the
server environment variable `GEMINI_API_KEY` (never stored in the DB, never in client bundles, never
logged). First use: an optional plain-language "what's driving sales" summary per show, generated
only from figures `src/domain/` has already computed.

## Scope
- In:
  - New module `src/ai/` (Gemini client wrapper + prompt builder) — server-side only.
  - Dependency `@google/genai` (official Google SDK; free tier exists; third-party service).
  - Endpoint `/api/orgs/:orgId/events/:eventId/insight`, member-only (404 for non-members),
    returns `{ configured: false }` when `GEMINI_API_KEY` is unset. (Charter originally said GET;
    delivered as POST because each call may bill the provider — approved, see Decision Log.)
  - Input to the LLM: aggregate figures already computed by the domain layer (tickets, revenue in
    integer minor units with currency, pace, targets, channel attribution, attention flags). No
    patron names, emails, phones, barcodes, or raw vendor records.
  - The LLM never computes money or counts; its output is labeled "AI-generated narrative" in the
    UI and is never a source of truth.
  - Desktop panel on show detail (`src/web/`).
  - Tests with a fake Gemini client (no network).
  - Docs: DECISIONS (new D17), `docs/integrations.md`, `docs/STATUS.md`, `docs/ROADMAP.md`, and
    the CLAUDE.md layout table line for `src/ai/`.
- Out:
  - Any external write (Gemini is called only to generate text; nothing is written to any vendor).
  - Sending any vendor data to Gemini beyond aggregate figures.
  - Mobile UI (deferred; shares the same endpoint later).
  - Background jobs, scheduled generation, or caching generated text in the DB.
  - Any Gemini-derived number appearing in totals, targets, attribution, or reconciliation.

## Acceptance criteria
- [x] Portfolio-manager decision on E-002 recorded (new third-party service + new secret). — CONDITIONAL, C1–C7, `governance/portfolio.md` 2026-10-28.
- [x] `src/ai/` exists; `@google/genai` is the only new dependency; key read from `process.env.GEMINI_API_KEY`. — `src/ai/gemini.ts`, `src/ai/insightPrompt.ts`; `package.json` diff is one line; `createTextGeneratorFromEnv` reads `GEMINI_API_KEY` only.
- [x] `GEMINI_API_KEY` is never persisted, never sent to clients, never logged; `scripts/check-secrets.ts` passes. — No DB write; API carries `insight.available` / `configured` booleans and provider/model names only; log line is `{ kind }` only; secret scan clean (184 files); PM grep: no `GEMINI` string in `src/web`, `src/shared`, `src/domain`, `mobile`.
- [x] `/api/orgs/:orgId/events/:eventId/insight` enforces membership (404 for non-members) and returns `configured:false` without a key. — Route uses `orgFor`; tests in `test/api.test.ts` cover 404 for a non-member org, `configured:false` with `textGenerator: null`, and 502/429 with an action. Method is POST (approved deviation).
- [x] Prompt payload contains no patron PII; a test asserts the payload shape. — `test/ai.test.ts` "never includes patron data or record identifiers" (no `@`, no buyer names, no order IDs); fixture includes emails and names that must not appear; route test also asserts no `@` in the prompt the fake generator received.
- [x] LLM output is rendered as a labeled AI narrative; no number from the LLM is parsed into money or counts. — `InsightPanel` shows an "AI-generated" tag, "not a source of record" copy, and a "Figures sent to the model" details block; `text` is rendered as a string only.
- [x] Tests use a fake Gemini client; `npm run check` passes. — PM ran `npm run check`: typecheck OK, 79/79 non-DB tests passed (9 new in `test/ai.test.ts`), vite build OK, secret scan clean. The 41 DB-backed tests (incl. the 3 new route tests) were skipped in the PM's shell (no `TEST_DATABASE_URL`; PM may not guess DB credentials). Implementer reports 120/120 with local PostgreSQL 16; the 3 route tests were reviewed line by line by the PM. Mobile: PM ran typecheck OK and 6/6 tests.
- [x] Docs updated: D17, integrations.md (evidence level: fixture/unit only; live NOT verified), STATUS (gap + BLOCKED next step), ROADMAP, CLAUDE.md layout line. — All present; README and `.env.example` also updated.
- [x] Live verification explicitly marked BLOCKED in STATUS with the exact next step. — `docs/STATUS.md` BLOCKED section and next-action item 2; `docs/integrations.md` Gemini row "BLOCKED". **The gate itself is still open: awaiting owner to provision a key on a host that can reach `generativelanguage.googleapis.com` and press "Summarize with AI" once on a fixture show.**

## Portfolio conditions C1–C7 (PM verification, 2026-10-28)
| Cond. | Requirement | Evidence | Met |
|---|---|---|---|
| C1 | `package.json` commit limited to the one dependency line + lockfile; description re-encoding reverted | `git show 0f5b18a -- package.json` is a single added line; description untouched | Yes |
| C2 | `@google/genai` imported only under `src/ai/`; a test fails otherwise | `test/ai.test.ts` "dependency boundary" scans `src`, `mobile/src`, `api`, `scripts`; PM repo-wide grep (excluding node_modules/lockfile) finds the import only in `src/ai/` and the test file | Yes |
| C3 | `GEMINI_API_KEY` in `.env.example` with empty value and in docs by name only; DB/API/logs carry at most a boolean | `.env.example` has `GEMINI_API_KEY=` and `GEMINI_MODEL=`; API types `InsightAvailability`/`ShowInsightResponse` carry booleans + provider/model names; log is `{ kind }` | Yes |
| C4 | integrations.md records Gemini as outbound processor, evidence unit/fixture, live NOT verified; STATUS marks BLOCKED with exact next step | integrations.md "Gemini API (AI summaries, D17; outbound third-party processor)" section; STATUS BLOCKED entry + verification table "Live Gemini call: NOT performed" | Yes |
| C5 | On-demand only; no background jobs, schedules, automatic retries, or DB caching of generated text | POST per member request; `retryOptions.attempts: 1`; 20 s timeout; bounded in-memory `Map` (200 entries) keyed by prompt hash, nothing persisted | Yes |
| C6 | D17 records `gemini-flash-latest` is a floating alias and output is never a source of truth | D17 "Model" and "Figures in, words out" bullets | Yes |
| C7 | `npm run check` passes before the dependency commit; PM sign-off required | PM run green for non-DB subset + build + scan; DB subset reported 120/120 by implementer (see AC 7); PM sign-off below | Yes (with the DB-subset caveat recorded) |

## Risks / dependencies on other sessions
- **Escalation required:** new third-party service (Google Gemini) and new secret (`GEMINI_API_KEY`) — E-002 (resolved CONDITIONAL).
- **Live verification blocked:** this environment's network policy returns 403 for
  `generativelanguage.googleapis.com` and `ai.google.dev`. No live call can be claimed as verified.
- **Shared files touched:** `package.json`, `CLAUDE.md` (layout table), `src/server/app.ts` route
  registration, `src/shared/apiTypes.ts` (additive: `insight` on `EventDetailResponse`). No other
  active sessions in `governance/portfolio.md`; mobile typecheck confirms the additive type change is safe.
- **Product-rule risk:** LLM text could appear to restate money figures. Mitigation: prompt uses
  pre-formatted strings from `src/domain/` money formatting, the panel is labeled, and nothing is
  parsed back.
- **Privacy risk:** accidental PII in the prompt. Mitigation: allow-listed prompt builder plus tests
  asserting no emails, names or record IDs appear.
- **Cost risk:** free tier only; no background jobs; one attempt per request; in-memory reuse for
  identical figures. Spend decisions remain with the human owner.
- **Residual notes (non-blocking):** the 502 body forwards the SDK `ApiError` message text to the
  client; these messages do not contain the key, but if a future SDK echoes request details the
  message should be mapped to a fixed string. The dependency-boundary test scans `mobile/src`, not
  the `mobile/` root; today the root holds only config files.

## Tasks
1. [x] Await portfolio-manager decision on E-002. — CONDITIONAL received; dependency committed afterwards (commit `0f5b18a`).
2. [x] `src/ai/gemini.ts` (named `gemini.ts`, not `geminiClient.ts`): wrapper over `@google/genai`, `isConfigured` expressed as `createTextGeneratorFromEnv() === null`; injectable client for tests.
3. [x] `src/ai/insightPrompt.ts` (named `insightPrompt.ts`, not `showInsightPrompt.ts`): aggregate prompt builder, no PII.
4. [x] Server route `POST /api/orgs/:orgId/events/:eventId/insight` with membership check and `configured:false` path; `InsightAvailability` + `ShowInsightResponse` in `src/shared/apiTypes.ts`.
5. [x] Tests: fake client, payload privacy, 404 for non-members, `configured:false` without key, provider failure mapping, dependency boundary.
6. [x] Desktop `InsightPanel` on show detail, labeled AI-generated / not a source of record, hidden when unavailable.
7. [x] Docs: D17, integrations.md, STATUS, ROADMAP, CLAUDE.md layout line, README, `.env.example`.
8. [x] `npm run check` + mobile checks; PM ready-to-merge review (this file). Remaining for owner: provision key, run live gate once, merge.

## Commits on this branch (since `586b1e3` on `main`)
- `0f5b18a` Add server-side Gemini text generation (D17) — `src/ai/*`, `test/ai.test.ts`, `package.json` (+1 line), `package-lock.json`
- `c6f9c24` Offer "Summarize with AI" on a show (API + desktop) — `src/server/app.ts`, `src/shared/apiTypes.ts`, `src/web/*`, `test/api.test.ts`
- `237b2ed` Document the Gemini integration (D17) and its blocked live gate — docs, README, CLAUDE.md, `.env.example`
- `e1b3776` Governance: charter, escalation E-002 and portfolio decision for the Gemini session — `governance/*` only

## Decision Log
| Date | Decision | Subject | Rationale |
|------|----------|---------|-----------|
| 2026-10-28 | ESCALATED | E-002: add `@google/genai` dependency and `GEMINI_API_KEY` secret for Gemini integration | New third-party service and new secret are outside PM authority; portfolio-manager must decide (spend/secret provisioning ultimately with the human owner) |
| 2026-10-28 | APPROVED | Scope and design as recorded above (server-side only, aggregate inputs, no PII, labeled narrative, member-only endpoint, fake-client tests, mobile deferred) | Within session scope; respects money/privacy/access/integration rules in CLAUDE.md; conditional on E-002 approval before committing the dependency |
| 2026-10-28 | APPROVED | Live verification recorded as BLOCKED (network policy 403) | Rule: never invent live verification; STATUS must carry the exact next step |
| 2026-10-28 | CHANGES REQUESTED | Working tree already has `@google/genai` installed (uncommitted) | Keep it uncommitted until E-002 is resolved; revert `package.json`/`package-lock.json` if E-002 is rejected |
| 2026-10-28 | PORTFOLIO DECISION: CONDITIONAL | E-002 resolved by portfolio-manager: `@google/genai` ^2.31.0 dependency and `GEMINI_API_KEY` secret *name* in `.env.example`/docs approved with conditions C1–C7 (see `governance/portfolio.md` Decision Log, 2026-10-28). Key provisioning, any spend and merge to `main` remain AWAITING OWNER. | Owner-initiated integration; official Apache-2.0 SDK, server-side only, no client/DB impact, no branch overlap. The dependency may now be committed once C1 (minimal `package.json` diff) and C7 (`npm run check`) are met. Session status may move from BLOCKED to ACTIVE; live verification stays BLOCKED. |
| 2026-10-28 | APPROVED | Deviation: insight endpoint is `POST`, not `GET` as chartered; module names `gemini.ts` / `insightPrompt.ts` instead of the task-list names | POST is the correct semantics for a call that may bill a provider and is not idempotent in cost; same path, same membership check, same `configured:false` contract. File names are cosmetic. Within session scope, no shared contract affected |
| 2026-10-28 | APPROVED | Bounded in-memory reuse of generated text keyed by a SHA-256 of provider+model+prompt (200 entries, lost on restart) | Consistent with C5 (nothing generated stored in the DB) and the charter's "out" item (DB caching); it reduces spend on repeated clicks and reports `cached: true` to the user |
| 2026-10-28 | APPROVED — READY TO MERGE | Branch `claude/gemini-api-integration-1kmvul`: code at `237b2ed` (3 commits) plus governance commit `e1b3776`; this charter update is uncommitted at sign-off time | All 9 acceptance criteria met and C1–C7 verified (table above). PM independently ran: `npm run check` (typecheck, 79 non-DB tests incl. 9 new, vite build, secret scan clean), mobile typecheck + 6/6 tests, repo-wide grep for SDK/secret-name boundaries, and reviewed the full diff. Caveat recorded: the 41 DB-backed tests (incl. 3 new route tests) were skipped in the PM's shell; the implementer reports 120/120 against local PostgreSQL 16 and the PM reviewed those tests by reading. Live Gemini gate remains BLOCKED and is the owner's step; merge to `main` is the owner's decision per portfolio policy 3 |
