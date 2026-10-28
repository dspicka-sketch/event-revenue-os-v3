# Session: claude/gemini-api-integration-1kmvul

- **Opened:** 2026-10-28
- **Project manager:** project-manager agent
- **Status:** BLOCKED (pending portfolio-manager decision on E-002; local, non-network work may proceed)

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
  - Endpoint `GET /api/orgs/:orgId/events/:eventId/insight`, member-only (404 for non-members),
    returns `{ configured: false }` when `GEMINI_API_KEY` is unset.
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
- [ ] Portfolio-manager decision on E-002 recorded (new third-party service + new secret).
- [ ] `src/ai/` exists; `@google/genai` is the only new dependency; key read from `process.env.GEMINI_API_KEY`.
- [ ] `GEMINI_API_KEY` is never persisted, never sent to clients, never logged; `scripts/check-secrets.ts` passes.
- [ ] `GET /api/orgs/:orgId/events/:eventId/insight` enforces membership (404 for non-members) and returns `configured:false` without a key.
- [ ] Prompt payload contains no patron PII; a test asserts the payload shape.
- [ ] LLM output is rendered as a labeled AI narrative; no number from the LLM is parsed into money or counts.
- [ ] Tests use a fake Gemini client; `npm run check` passes.
- [ ] Docs updated: D17, integrations.md (evidence level: fixture/unit only; live NOT verified), STATUS (gap + BLOCKED next step), ROADMAP, CLAUDE.md layout line.
- [ ] Live verification explicitly marked BLOCKED in STATUS with the exact next step (run once with a real key from an environment that can reach generativelanguage.googleapis.com).

## Risks / dependencies on other sessions
- **Escalation required:** new third-party service (Google Gemini) and new secret (`GEMINI_API_KEY`) — E-002.
- **Working tree already contains the dependency:** `package.json` / `package-lock.json` are modified
  (uncommitted) with `@google/genai ^2.31.0`. It must not be committed until E-002 is decided.
- **Live verification blocked:** this environment's network policy returns 403 for
  `generativelanguage.googleapis.com` and `ai.google.dev`. No live call can be claimed as verified.
- **Shared files touched:** `package.json`, `CLAUDE.md` (layout table), `src/server/` route
  registration, `src/shared/apiTypes.ts`. Other active sessions: none listed in `governance/portfolio.md`
  beyond merged ones, so conflict risk is low but these count as shared code.
- **Product-rule risk:** LLM text could appear to restate money figures. Mitigation: prompt uses
  pre-formatted strings from `src/domain/` money formatting, the panel is labeled, and nothing is
  parsed back.
- **Privacy risk:** accidental PII in the prompt. Mitigation: a typed, allow-listed payload builder
  plus a test asserting its keys.
- **Cost risk:** free tier only; no background jobs; generation is on-demand per request. Spend
  decisions remain with the human owner.

## Tasks
1. Await portfolio-manager decision on E-002 (dependency + secret). Do not commit `package.json` until then.
2. `src/ai/geminiClient.ts`: thin wrapper over `@google/genai` (`gemini-flash-latest`, `generateContent`, returns `response.text`); `isConfigured()` from `GEMINI_API_KEY`; injectable client for tests.
3. `src/ai/showInsightPrompt.ts`: allow-listed aggregate payload builder from domain show-card output; no PII fields.
4. Server route `GET /api/orgs/:orgId/events/:eventId/insight` with membership check and `configured:false` path; add contract type to `src/shared/apiTypes.ts`.
5. Tests: fake client, payload shape (no PII keys), 404 for non-members, `configured:false` without key.
6. Desktop panel on show detail, labeled "AI-generated narrative (not a source of truth)".
7. Docs: D17 in DECISIONS, integrations.md entry (evidence level, read-only, no live verification), STATUS, ROADMAP, CLAUDE.md layout line for `src/ai/`.
8. Run `npm run check`; request PM ready-to-merge review; owner decides on merge and on provisioning a real key.

## Decision Log
| Date | Decision | Subject | Rationale |
|------|----------|---------|-----------|
| 2026-10-28 | ESCALATED | E-002: add `@google/genai` dependency and `GEMINI_API_KEY` secret for Gemini integration | New third-party service and new secret are outside PM authority; portfolio-manager must decide (spend/secret provisioning ultimately with the human owner) |
| 2026-10-28 | APPROVED | Scope and design as recorded above (server-side only, aggregate inputs, no PII, labeled narrative, member-only endpoint, fake-client tests, mobile deferred) | Within session scope; respects money/privacy/access/integration rules in CLAUDE.md; conditional on E-002 approval before committing the dependency |
| 2026-10-28 | APPROVED | Live verification recorded as BLOCKED (network policy 403) | Rule: never invent live verification; STATUS must carry the exact next step |
| 2026-10-28 | CHANGES REQUESTED | Working tree already has `@google/genai` installed (uncommitted) | Keep it uncommitted until E-002 is resolved; revert `package.json`/`package-lock.json` if E-002 is rejected |
| 2026-10-28 | PORTFOLIO DECISION: CONDITIONAL | E-002 resolved by portfolio-manager: `@google/genai` ^2.31.0 dependency and `GEMINI_API_KEY` secret *name* in `.env.example`/docs approved with conditions C1–C7 (see `governance/portfolio.md` Decision Log, 2026-10-28). Key provisioning, any spend and merge to `main` remain AWAITING OWNER. | Owner-initiated integration; official Apache-2.0 SDK, server-side only, no client/DB impact, no branch overlap. The dependency may now be committed once C1 (minimal `package.json` diff) and C7 (`npm run check`) are met. Session status may move from BLOCKED to ACTIVE; live verification stays BLOCKED. |
