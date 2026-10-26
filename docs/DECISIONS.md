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

## D13 — Product lead: "which marketing is working" (2026-10-21)
Daniel reviewed the first build and found that with only Eventbrite connected it mirrors Eventbrite's own organizer app. He chose **marketing effectiveness** as RevOS's lead differentiator, ahead of break-even and plan vs actual.
- **Linkage:** Eventbrite tracking-link codes (`?aff=CODE`), which Eventbrite stores against the purchase and reports on attendee records (field `affiliate`, SECONDHAND until the probe confirms it). This is an order-level, PII-free linkage, so it meets the brief's "actual supported order linkage" rule. It covers every channel (email, social, ads, partners), not only Mailchimp.
- **Rule:** one primary attribution per order: the order's tracking code. A code mapped to a campaign counts only if the order falls within 7 days after that campaign's send time. Orders outside the window or with conflicting codes are reported, not attributed. Orders with no code stay **unattributed** and are shown as such. Refunds reduce attributed revenue the same way they reduce sales.
- **Mailchimp adds** sends, opens and clicks per campaign, and maps campaigns to codes automatically by reading the `aff` parameter in each campaign's Eventbrite link URLs. Its own "attributed revenue" (e-commerce) figures are never used or summed.
- **Not claimed:** opens, membership and timing correlation are not attribution. Nothing claims incremental lift.

## D14 — Deal terms, budgets and settlements come from Prism.fm (2026-10-21)
RevOS will not model guarantees, door splits or "versus" deals itself. Those live in Prism.fm and will be read from it.
- Prism.fm has no public API documentation, so **access is BLOCKED**: Daniel needs to ask Prism.fm for API access and terms.
- Airtable is demoted from "the planning source" to an optional fallback, and manual targets (D12) stay until Prism.fm access exists.

## D15 — Buyers pay every fee; the house keeps face value, facility fee and rebate (2026-10-21)
Daniel confirmed that the ticket buyer typically pays the platform fee, processing fee, tax, facility fee and promoter rebate on top of the ticket price.
- **Line items:** RevOS itemizes each order as face value + facility fee + promoter rebate + platform fee + processing fee + tax = buyer total. A reconciliation row checks that the itemized lines add up to the buyer total, so any unrecognised fee shows as a difference.
- **Organizer proceeds ("house keeps"):** face value + facility fees + promoter rebates, net of refunds. Platform fee, processing fee and tax pass through to the platform, the payment processor and the tax authority. This is buyer total − platform − processing − tax, the same formula as before, now justified by documented fee ownership. Live Eventbrite connections created by `setup:live` therefore use `proceeds_policy = gross_minus_fees_and_tax`. `probe:eventbrite` reports whether real orders match the "buyer pays all" shape.
- **Source of facility fees and rebates:** organizer-defined fees, read from the source's itemized fee list and matched by name (facility / venue fee → facility fee, rebate → promoter rebate). If the source does not itemize fees, both lines are unavailable, never zero.
- **Open point:** if an organization is a promoter that does not keep the facility fee (it goes to a third-party venue), proceeds would include money the organization does not keep. Revisit with a per-organization setting once Prism.fm deal data shows who keeps what.

## D16 — Channels, a 7-day view, and entered spend for cost per ticket (2026-10-21)
"Which marketing is working" needs more than ticket volume.
- **Channels:** admins assign each tracking link a channel (email, social, paid ads, website, partner, other). Email campaigns are always email. Unassigned links are shown as "Unassigned", never guessed.
- **Time window:** every marketing view is available for all sales to date and for orders placed in the last 7 days.
- **Spend:** admins may enter what a source cost for a show (per tracking code, per currency). It is an expense input, never revenue, never added across currencies, and only shown in the to-date view, where cost per paid ticket = spend ÷ attributed paid tickets (integer minor units, rounded half up). A source with spend and no attributed sales still appears, with no cost per ticket. Ad-platform spend connectors (Meta, Google) would replace manual entry later; not on the roadmap yet.
- Entered spend is a deviation from "read-only integrations" only in that RevOS stores a number the user typed. Nothing is written to any vendor.

## Proposed (not done)
- A `financial_adjustments` table, deferred until a source exposes explicit refund/adjustment amounts. In M1, refunds come from order/line state.
