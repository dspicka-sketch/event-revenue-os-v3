# Protect 104 — repository instructions

Private project dashboard and multi-agent chief-of-staff system for moving 104 N. Main Street,
Sebastopol, CA into community nonprofit ownership. Read `docs/mission.md` before changing anything
user-facing.

## Scope and boundaries
- This repo is isolated. Never touch the C2C/vinyl-flip project, Wax Poetic website, or employer systems.
- The mission (F01) is approved. Everything in `UNRESOLVED_DECISIONS` (`src/lib/domain/roles.ts`) is
  NOT decided — never seed or present it as decided.
- Inherited findings (F02–F12) are source-backed summaries awaiting local retrieval. Keep
  `inherited_unverified = true` until someone retrieves the source into the project.
- General counsel is issue spotting only — not legal advice, privilege, or approval.
- No external send, publication, submission, payment or signature tools. Drafts + approval records only.
- Fixtures are synthetic and labeled SYNTHETIC. Never add real contacts, funders, amounts or deadlines.
  No confidential documents, emails or donor data in git.

## Evidence rules (enforced in code and DB)
- Evidence class (`verified_current|documented_historical|user_reported|proposed|inferred|unknown`)
  is separate from review state. Agents can never assign `verified_current`.
- Accepted claims need a source link (deferred trigger). Unknown money is `null` → "Not established".
- Financial math lives in `src/lib/domain/funding.ts` (integer cents), never in prompts.

## Commands
- `npm test` — unit + orchestration (fixture model; not live evidence)
- `npm run test:db` — RLS/integrity/concurrency against local Postgres (`scripts/db-reset-local.sh`)
- `node tests/e2e/journey.mjs` with `BASE_URL` — browser journey (390px + desktop)
- `npm run roles:sync` / `roles:check` — regenerate `.claude/agents/*`, `agent/instructions.md`, `docs/roles/*`
- `npx tsx scripts/build-demo-fixture.ts` — rebuild `fixtures/demo-snapshot.json` from the real seed
- `DEMO_MODE=1 npm run build && DEMO_MODE=1 npm start` — isolated demo

## Layout
- `supabase/migrations` schema, RLS, triggers, baseline seed function, import
- `src/lib/orchestrator` durable runs (Postgres leases/checkpoints), specialists, reconciliation
- `src/lib/domain` roles (single source of truth), evidence validation, funding math
- `src/app` Next.js 16 dashboard (`proxy.ts`, not middleware). Read `node_modules/next/dist/docs` before using Next APIs.
- `agent/` eve chief-of-staff front door (typed tools only, `defaultTools: false`)
- `.claude/agents` development-time reviewers — generated; their existence is not evidence of runtime agents.

## Workflow
Single integration owner (chief-of-staff dev agent). Edit the role spec, then `roles:sync`.
Run `npm test`, `npm run test:db`, `npx tsc --noEmit` before pushing.
