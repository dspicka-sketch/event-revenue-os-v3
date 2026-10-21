# RevOS

RevOS links the systems a live-event business already uses (ticketing, marketing, website, planning, resale), normalizes their records, and shows a revenue dashboard you can trust. It does not replace any of them. It never sends campaigns, changes inventory or writes to vendor systems.

Two clients share one backend, database, set of integrations, authentication and set of revenue calculations:

- **Desktop web app** (`src/web/`): detailed analysis, reconciliation and integration management.
- **Mobile app** (`mobile/`, Expo/React Native): a 30-second view of every show's tickets, revenue, pace, targets and items needing attention.

See [`docs/STATUS.md`](docs/STATUS.md) for exactly what is verified, [`docs/ROADMAP.md`](docs/ROADMAP.md) for milestones, and [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Stack

Node.js 22 + TypeScript, Fastify (server API), PostgreSQL 16 (plain SQL migrations), React 19 + Vite (UI), Vitest (tests). The reasons are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

```
src/domain/        Money, revenue, show-card and attention rules (pure; shared by server, web and mobile)
src/shared/        API contract types shared by server, web and mobile
src/auth/          Users, org memberships, sessions
src/providers/     Vendor adapters (Eventbrite: client, normalization, fixtures)
src/db/            Migrations, connection pool, repository (all queries scoped to an organization)
src/sync/          Manual sync: bounded full read → upsert → recompute
src/server/        HTTP API (the browser talks only to this)
src/web/           Desktop web client
mobile/            Mobile client (Expo); see mobile/README.md
scripts/           Fixture seed, live setup, CLI sync, report comparison, secret scan
test/              Unit and database-backed tests
```

## Run locally

Prerequisites: Node 22+, and PostgreSQL 16 running locally.

```bash
npm ci
cp .env.example .env            # then edit DATABASE_URL / TEST_DATABASE_URL
createdb revos_dev && createdb revos_test   # or create them however you prefer
npm run db:migrate
npm run seed:fixture            # optional: FIXTURE organization + demo account (password printed once)
npm run build                   # builds the UI into dist/web
npm start                       # http://127.0.0.1:8787
```

During development, run `npm run dev`: API on :8787 and UI with hot reload on http://127.0.0.1:5173.

### Tests and checks

```bash
npm run check                   # typecheck + tests + build + secret/PII scan (DB tests need TEST_DATABASE_URL)
npm run check:mobile            # mobile typecheck + tests
```

## Live setup (Eventbrite, read-only)

1. In Eventbrite, signed in as a user who can see the pilot event, find the API keys page in your account settings (usually under *Developer links*; this menu path is from memory and wasn't checked) and copy your **private token**. Don't paste it into chat, email or any tracked file.
2. Put these in your local `.env` file (git-ignored), or in your host's secret manager:
   - `EVENTBRITE_TOKEN`: the private token
   - `EVENTBRITE_ORGANIZATION_ID`: the Eventbrite organization that owns the event
   - `EVENTBRITE_EVENT_ID`: the pilot performance's event ID (the number in the event URL)
3. `npm run setup:live -- "Your Venue Name"` registers the organization, the connection and the event. The database stores only the *name* of the secret variable (`EVENTBRITE_TOKEN`), never its value.
4. Start the server, open the live organization, open the event and press **Refresh**. You can also run `npm run sync -- <orgId> <eventId>`.
5. **Reconcile against Eventbrite's own report.** In Eventbrite's sales report for the same event, set the filters: all dates, the same currency, completed orders only, and fees shown separately. Copy the figures (in cents) into a JSON file such as:
   ```json
   { "currency": "USD", "filters": "Sales report, all dates, completed orders, fees separate, exported 2026-10-21",
     "grossSales": 1234500, "refunds": 0, "platformFees": 45600, "paymentFees": 23400, "tax": 0, "paidTickets": 410 }
   ```
   Then run `npm run reconcile:compare -- <orgId> <eventId> report.json`. The result appears in the event's reconciliation table. Any unexplained difference must be investigated before the connection counts as reconciled.

Only after step 5 shows zero unexplained difference should fee ownership be recorded and `proceeds_policy` changed from `unverified`. Until then, organizer proceeds stay **Unavailable** on live data, by design.

## Accounts and access

There is no public sign-up. Create accounts from the command line:

```bash
npm run user -- create you@example.com --name "Your Name"   # prints a one-time password
npm run user -- grant you@example.com <organizationId> admin  # or viewer
npm run user -- reset-password you@example.com
```

The same account signs in on desktop and mobile. **Admins** can set targets and test connections. **Viewers** can read data and run Refresh. People who aren't members of an organization can't see it at all.

The server listens on 127.0.0.1 by default. To let a phone reach it on your local network, run it with `HOST=0.0.0.0`. Before exposing it beyond a trusted network, put it behind HTTPS (a reverse proxy) — see `docs/DECISIONS.md` D10 for what remains before public hosting.

## Mobile app

See [`mobile/README.md`](mobile/README.md). Short version: `cd mobile && npm ci && npx expo start`, then open it in Expo Go or a development build and sign in with your RevOS account and server address.
