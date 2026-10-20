# Status

_Last updated: 2026-10-20 (M1 in progress — live verification BLOCKED)_

## Completed (M1)

- Scaffold: TypeScript/Node 22, Fastify API, PostgreSQL migrations, React/Vite UI, lockfile, `.gitignore`, `.env.example` (placeholders only), README.
- Domain: integer minor-unit money, unknown ≠ zero, per-currency measures with complete/partial/unavailable status, and definitions for every measure.
- Eventbrite adapter (read-only): Bearer auth, explicit organization + event, bounded continuation pagination, retries for 429/5xx/timeout/network with `Retry-After`, and specific error classes (auth, forbidden, not_found, rate_limited, timeout, network, server, bad_response, limit_exceeded). The event's organization is checked against the configured account.
- Store: organizations, source connections (secret *reference* only), canonical events (one per performance), source event mappings, orders, order lines, sync runs, reconciliation results. Unique keys are (organization, provider, account, source ID), and every tenant query is scoped by organization.
- Sync: manual Refresh does a full bounded read, upserts, flags missing records and recomputes from stored rows. Last good data is retained and marked stale when a sync fails.
- Dashboard: event list (performance date in venue timezone, paid tickets, gross after refunds, proceeds, last-7-day paid tickets by transaction date, freshness) and show detail (ticket counts, revenue components with definitions, reconciliation table, exceptions, ticket classes, sync history, Refresh). The fixture banner is prominent, and the layout works at 390 px width without horizontal scroll.
- Fixtures: synthetic two-performance show. A second Refresh applies a full refund, a partial refund and a new order.

## Verification actually performed

| Check | Result |
|---|---|
| `npm test` (local PostgreSQL 16) | 44/44 passed: money (5), revenue rules (12), Eventbrite client (10), DB sync (11), HTTP API (6) |
| `npm run typecheck` | passes |
| `npm run build` + `npm run check:secrets` | no credential/PII patterns in 42 tracked files or the built bundle |
| Manual run | seeded fixture org, started server, refreshed via API, screenshotted list and detail at 1280 px and 390 px |

Acceptance gates covered by tests: duplicate sync, multi-page reads, multi-line orders, full/partial refunds and cancellations, missing fees, 401/403/429/timeout, failed sync after success, multiple performances, organizations and currencies, and the secret/PII scan.

## BLOCKED: live verification

- **No Eventbrite credentials** have been supplied to this environment.
- This cloud build environment's **network policy denies `www.eventbriteapi.com` and `www.eventbrite.com`**, so neither the official API reference nor the live API could be reached.
- As a result, everything in `docs/integrations.md` marked ASSUMED or SECONDHAND is unverified. That covers money-field semantics, status values, the attendee default filter, partial-refund behavior and fee ownership. Live connections show organizer proceeds as Unavailable until this is resolved.

## Unresolved gaps

- Real-source reconciliation (gate "zero unexplained difference") has not been done.
- Fee payer (buyer vs organizer) and refund fee treatment are not determined.
- Allocation/capacity (ticket classes) is not read; discounts are not separated; payouts are not connected.
- Access control is a single shared token (pilot only).
- No sales-pace chart yet. Only the last-7-days figure is shown, and the brief calls for full pace after M1.

## Next action for Daniel

Run M1 against the real event on **your own machine** (this cloud environment cannot reach Eventbrite):
1. `git pull` this branch, `npm ci`, then create a local `.env` from `.env.example`.
2. Add `EVENTBRITE_TOKEN`, `EVENTBRITE_ORGANIZATION_ID` and `EVENTBRITE_EVENT_ID` to `.env`. Never paste the token into chat.
3. `npm run setup:live -- "Venue name"`, then `npm start`, then press Refresh on the event.
4. Export Eventbrite's sales report for the same event with the filters described in the README, then run `npm run reconcile:compare`.

Alternatively, add `www.eventbriteapi.com` to this cloud environment's allowed domains and store the token as an environment secret, and Claude Code can run step 3 here.
