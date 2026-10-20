# RevOS

RevOS links the systems a live-event business already uses (ticketing, marketing, website, planning, resale), normalizes their records, and shows a revenue dashboard you can trust. It does not replace any of them. It never sends campaigns, changes inventory or writes to vendor systems.

**Current milestone: M1.** One vertical slice: Eventbrite → stored normalized orders → reconciled event revenue → private dashboard. See [`docs/STATUS.md`](docs/STATUS.md) for exactly what is verified and what is not.

## Stack

Node.js 22 + TypeScript, Fastify (server API), PostgreSQL 16 (plain SQL migrations), React 19 + Vite (UI), Vitest (tests). The reasons are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

```
src/domain/        Money and revenue rules (pure: no I/O, no vendor or UI code)
src/providers/     Vendor adapters (Eventbrite: client, normalization, fixtures)
src/db/            Migrations, connection pool, repository (all queries scoped to an organization)
src/sync/          Manual sync: bounded full read → upsert → recompute
src/server/        HTTP API (the browser talks only to this)
src/web/           Dashboard UI
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
npm run seed:fixture            # optional: isolated FIXTURE organization with synthetic data
npm run build                   # builds the UI into dist/web
npm start                       # http://127.0.0.1:8787
```

During development, run `npm run dev`: API on :8787 and UI with hot reload on http://127.0.0.1:5173.

### Tests and checks

```bash
npm test                        # unit and DB tests (DB tests are skipped if TEST_DATABASE_URL is unset)
npm run typecheck
npm run build && npm run check:secrets   # scan Git-tracked files and the built bundle for credentials/PII
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

## Access control

The server listens on 127.0.0.1 by default. To listen on any other address you must set `REVOS_ACCESS_TOKEN`; the server refuses to start without it. The UI then asks for that token and keeps it only for the current browser tab. This is a pilot gate, not multi-user auth. Put real authentication in front of any hosted deployment before it shows real data.
