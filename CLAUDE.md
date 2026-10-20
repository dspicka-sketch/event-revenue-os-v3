# RevOS: instructions for Claude Code

RevOS is a connective revenue layer for live-event businesses. It links the systems a venue or promoter already uses (ticketing, email, website, SMS, planning, resale), normalizes their records, and shows trustworthy revenue. It is **not** a ticketing platform, CRM, booking system or marketing sender. Product owner: Daniel Spicka.

## Products (one backend)

| Client | For | Location |
|---|---|---|
| Desktop web app | Detailed analysis, reconciliation, integration management | `src/web/` (React + Vite) |
| Mobile app | Venue owners, promoters, talent buyers checking shows in about 30 seconds: show cards, tickets, revenue, pace, targets, items needing attention | `mobile/` (Expo / React Native) |

Both clients share the **same** server API (`src/server/`), database, integrations, authentication (bearer sessions from `/api/auth/login`) and revenue calculations (`src/domain/`). Never re-implement a revenue rule, attention rule or money format in a client. Add it to `src/domain/`, expose it through the API, and have both clients render it. API contract types live in `src/shared/apiTypes.ts`.

## Layout

```
src/domain/     Pure money, revenue, reconciliation and show-card/attention rules (no I/O)
src/providers/  Vendor adapters (read-only). One folder per vendor.
src/db/         SQL migrations (forward-only), pool, repository. Every tenant query takes organization_id.
src/auth/       Users, memberships (admin/viewer), sessions, password hashing
src/sync/       Manual sync orchestration
src/server/     Fastify API: the only thing clients talk to
src/shared/     API contract types shared by server, web and mobile
src/web/        Desktop client
mobile/         Mobile client (separate package; imports ../src/domain and ../src/shared)
docs/           STATUS.md, ROADMAP.md, DECISIONS.md, integrations.md
```

## Commands

- Root: `npm ci`, `npm run dev`, `npm start`, `npm test`, `npm run check` (typecheck + tests + build + secret scan; must pass before every commit)
- DB tests need `TEST_DATABASE_URL` (local PostgreSQL 16). Without it they are skipped, never faked.
- Mobile: `cd mobile && npm ci && npm run typecheck && npm test`; run with `npx expo start`
- Accounts: `npm run user -- create|grant|reset-password`; fixture demo: `npm run seed:fixture`

## Non-negotiable rules

- **Money:** integer minor units plus currency. No floats in totals, and never add currencies together. Missing means unknown, never zero. Keep gross, discounts, refunds, tax, buyer fees, organizer fees, reseller deductions, proceeds and payouts distinct. Never call gross buyer payments "net revenue". Do not derive organizer proceeds until fee ownership for the source is documented (`proceeds_policy`).
- **Counting:** order-level charges are counted once per order. Allocation is not a sale. Plan and target values are never added to actuals. Resale under outright purchase counts the contracted proceeds, not later turnover. Unmatched cross-source records are flagged, not merged.
- **Time:** store UTC and display in the venue timezone (default America/Los_Angeles). State whether a view uses sale date or performance date. One canonical event = one performance.
- **Data trust:** keep last good data after a failure and label it stale. `verified` means a successful authorized **live** read; fixtures can never be verified. Fixture data lives only in fixture organizations and is always visibly labeled in both clients.
- **Integrations:** read-only. No campaigns, inventory changes or external writes. Check the vendor's current official docs before writing an adapter and record evidence levels in `docs/integrations.md`. Never invent an endpoint, and never count a fixture test as live verification.
- **Secrets and privacy:** secrets live in the server environment or a secret manager. The DB stores only the secret's *name*. Nothing secret goes in Git, logs, client bundles or chat. Don't copy patron names, emails, phones or barcodes. Clients never call vendor APIs.
- **Access:** every tenant route checks organization membership. Non-members get 404. Admin-only actions are setting targets and testing connections.
- **Attribution (later):** at most one primary attribution per order, using a supported order linkage. Do not sum vendors' proprietary attributed-revenue figures.

## Working rules

- Small, reviewable commits. Run `npm run check` before committing (and mobile checks when `mobile/` changes).
- Keep `docs/STATUS.md` (done, exact verification, gaps, next action), `docs/ROADMAP.md`, `docs/DECISIONS.md` and `docs/integrations.md` current.
- Record a proposed deviation in DECISIONS before making a large change.
- Ask before paid provisioning, production migrations, app-store submission or any external write. Local work and read-only verification may proceed.
- Never invent passing tests, deployed URLs or live verification. If blocked on access, mark it BLOCKED and state the exact next step.
