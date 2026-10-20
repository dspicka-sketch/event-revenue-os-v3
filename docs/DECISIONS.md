# Decisions

## D1 — Stack (2026-10-20)
The repository was effectively empty: a one-file git-instructions note `Evrevos3`, kept as is, and an empty `.gitignore`. Choices:
- **Node 22 + TypeScript (strict)**: brief default; one language for server and UI.
- **Fastify 5**: small, typed, built-in request injection for tests.
- **PostgreSQL 16 + plain SQL migrations** with a ~40-line forward-only migrator (`src/db/migrate.ts`). There is no ORM, which keeps money columns and unique keys explicit and reviewable.
- **React 19 + Vite 7**: brief default. No component library or router dependency (two pages).
- **Vitest 3**: DB tests run against a real PostgreSQL (`TEST_DATABASE_URL`) and are skipped, not faked, when it is absent.
- npm with `package-lock.json`. No hosting provider was chosen and nothing was provisioned.

## D2 — Money representation
Money is stored as integer minor units (`bigint`) plus an ISO 4217 currency, with scale taken from `Intl`. `pg` int8 values are parsed to JS numbers with a safe-integer guard (event revenue is far below 2^53). NULL means unknown. `MeasureSum` tracks how many inputs were known or unknown, so every measure is complete, partial or unavailable.

## D3 — Order-level money is authoritative; lines give counts
Headline money uses order-level `costs`, counted once per order. Ticket lines (attendees) supply counts, ticket classes and line-level refunds. A reconciliation row checks Σ order gross = Σ ticket gross for orders without refunds. Mismatches are flagged and the order value is used.

## D4 — Full bounded re-read on every Refresh
Incremental semantics (`changed_since`) are unverified for refunds and deletions, so each Refresh reads the whole pilot event. Upserts are keyed by `(organization, provider, account, source_id)`. Records not seen in a full read are flagged `missing_from_source` and are never deleted.

## D5 — Organizer proceeds gated by `proceeds_policy`
`unverified` (the default for live connections) shows proceeds as Unavailable. `gross_minus_fees_and_tax` derives proceeds as gross − platform fee − payment fee − tax, net of refunds, and marks them partial whenever refunds exist. The fixture organization uses the derived policy as an explicitly labeled fixture assumption so the code path is exercised.

## D6 — Fixture isolation
Fixture data exists only in organizations with `is_fixture = true`. The repository refuses to attach a fixture connection to a live organization and vice versa. A DB CHECK makes it impossible for a fixture connection to be `verified`; it uses the extra status `fixture` instead. The UI shows a striped "FIXTURE DATA" banner. The fixture transport serves data through the real Eventbrite client, so pagination and normalization are exercised.

## D7 — Connection status
States: not_configured / verifying / verified / stale / error, plus `fixture` (D6). `verified` is set only by a successful **live** read. When a sync fails after an earlier success the connection becomes `stale`, the last good reconciliation is still shown, and it is labeled stale. Last attempt and last success are stored separately.

## D8 — Pilot access gate
There is a single shared bearer token (`REVOS_ACCESS_TOKEN`), required whenever the server listens beyond loopback. All tenant queries take `organization_id`. Real per-user auth and org membership are deferred until a hosted deployment is planned.

## Proposed (not done)
- A `financial_adjustments` table, deferred until a source exposes explicit refund/adjustment amounts. In M1, refunds come from order/line state.
