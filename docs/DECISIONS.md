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

## D8 — Pilot access gate (superseded by D10)
There was a single shared bearer token (`REVOS_ACCESS_TOKEN`), required whenever the server listened beyond loopback. All tenant queries take `organization_id`. Replaced on 2026-10-20 by per-user accounts (D10).

## D9 — Scope update: desktop + mobile on one backend (2026-10-20)
Daniel added a mobile app for venue owners, promoters and talent buyers, alongside the desktop web app. Both share the backend, database, integrations, authentication and revenue calculations. Order: finish the desktop Eventbrite milestone, add the mobile client, then continue M2–M6.

## D10 — Authentication shared by both clients
- Users, `organization_members` (roles `admin` and `viewer`), and `sessions` storing the SHA-256 hash of a random 256-bit bearer token. Web sessions last 14 days and mobile sessions 30 days. Logout revokes.
- Passwords are hashed with Node's built-in scrypt. There is no public sign-up: accounts come from `npm run user`, which prints a one-time generated password.
- Bearer tokens, not cookies, so one mechanism serves the browser and native apps, with no CSRF surface. The web client keeps the token in `localStorage`, and mobile uses the OS secure store.
- Non-members get 404 for an organization's routes. Setting targets and testing connections are admin-only. Refresh is allowed for viewers (it is read-only toward vendors).
- Sign-in throttle: 10 failures per email+IP per 15 minutes, held in memory. Unknown emails and wrong passwords cost the same time and return the same error.
- Still needed before public hosting: HTTPS termination, a persistent or shared throttle, and password reset by email.

## D11 — Mobile framework: Expo (React Native) + TypeScript
Inspected first: the stack is TypeScript end to end, revenue rules are pure modules in `src/domain/`, the server is a JSON API, and the desktop is React 19.
- **Chosen: Expo (React Native).** It is the same language and the same React model. It imports `src/domain` and `src/shared` directly (Metro resolver maps the `.js` import suffixes to `.ts`), so both apps are guaranteed to share calculations and types. It gives native iOS/Android builds, OS secure storage for the session token, and a later path to push notifications for attention items. Expo's web target also gives a browser preview for screenshots in CI.
- **Considered: installable PWA in the existing Vite app.** It is cheapest, but has weaker home-screen and app feel, unreliable iOS push, and no secure token store. Rejected because the brief asks for an organizer *app*.
- **Considered: Capacitor wrapper of the web UI.** Rejected because the desktop UI is dense and analytical, while mobile needs a different information design. Wrapping would give neither a native feel nor a separate design.
- **Considered: Flutter / native Swift+Kotlin.** Rejected because a second language would mean re-implementing money rules, against the shared-calculation requirement.
- `mobile/` is its own npm package (Expo needs its own dependency tree) inside this repository. No workspace hoisting, to avoid React Native version conflicts with the web's React DOM.

## D12 — Targets are manual plan values until M5
`event_targets` stores per-show targets for paid tickets, gross after refunds or organizer proceeds, with `source = 'manual'`. They are compared against actuals and never added to them. A proceeds target is not judged while proceeds are unavailable. "Behind target" is a simple run-rate comparison: the last 7 days' average against what is needed per remaining day. It is labeled as not a forecast. Airtable (M5) becomes the source where it has the value.

## Proposed (not done)
- A `financial_adjustments` table, deferred until a source exposes explicit refund/adjustment amounts. In M1, refunds come from order/line state.
