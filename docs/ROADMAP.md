# Roadmap

Updated 2026-10-28: the owner's ticketing platform is On The Stage (D18), so the On The Stage data path is the critical path and Eventbrite becomes the reference adapter. Earlier update 2026-10-21: marketing effectiveness is the lead (D13), and Prism.fm replaces Airtable for deals and budgets (D14). Earlier update 2026-10-20 covered two clients: a desktop web app and a mobile app, both on one backend. A milestone is complete only after its live-read gate passes, or after an explicit access blocker has been recorded. Fixture tests alone never complete a milestone.

| # | Milestone | Scope | Gate | Status |
|---|---|---|---|---|
| M0 | **On The Stage data path** (D18, proposed) | Answer from On The Stage (API / export / neither); CSV import core built format-agnostic; then either a read-only adapter or a report-import connector with imported-not-verified labeling; promo code as the attribution linkage | One real production's orders in RevOS with the buyer total reconciled against On The Stage's own report | **Sprint 1, in progress** (blocked on On The Stage's answer and a sample export) |
| M1 | Desktop: Eventbrite vertical slice (reference adapter, second-venue option) | Adapter, normalized store, reconciliation, show list/detail, Refresh | Real event reconciled against Eventbrite's report with zero unexplained difference | Built; **live gate BLOCKED** (no credentials; the cloud environment cannot reach Eventbrite) |
| M1.1 | Shared platform for both clients | Per-user auth + org roles, manual targets, daily sales pace, show-card/attention rules, `/pulse`, integrations page | Tests; same numbers in both clients | Done (fixture + tests) |
| M1.5 | Mobile client | Expo app: sign-in, org switcher, show cards, show detail (tickets, revenue, pace, targets, attention), Refresh, fixture labeling | Typecheck + tests; web export screenshot; on-device check by Daniel | In progress |
| M2 | **Marketing attribution: Eventbrite tracking links + Mailchimp** (lead differentiator, D13) | Capture tracking codes on tickets, show "what's driving sales" per show and channel, add Mailchimp campaign sends and clicks, auto-map campaign links to codes, 7-day window, unattributed share shown | Live read of tracking codes on one event, plus one Mailchimp campaign whose link carries an `aff` code | In progress (fixture) |
| M3 | Prism.fm | Deals, budgets, settlements, plan vs actual and break-even (D14) | Prism.fm API access granted, then a live read | **BLOCKED: no public API, access must be requested** |
| M4 | Klaviyo / Laylo | SMS and fan-engagement campaigns joined by the same tracking-link codes | Live read | Not started |
| M5 | WordPress + GA4 | Funnel from the event page to checkout; validate cross-domain tracking | Live read + validated tracking | Not started |
| M6 | Ticket Evolution | Resale reconciliation under a documented commercial arrangement | Live read; primary and resale reconcile without double counting | Not started (commercial access required) |
| — | Gemini AI summaries (D17) | Optional per-show plain-language summary of computed figures; server-side `@google/genai`, key in server env, aggregates only | One live summary on a fixture show with a real key | Built (desktop + API, fake-client tests); **live gate BLOCKED** (network policy) |
| — | Airtable | Optional planning fallback if Prism.fm access is not available | — | Deprioritized (D14) |

The original target vendors (On The Stage, Laylo, Prism.fm, Prolific 1) remain behind the same connector boundary. They can be added once access exists.

## Sprints to MVP (2026-10-28; PROPOSED pending portfolio escalation E-003)

MVP: a venue or promoter signs in on desktop and phone, sees their live shows reconciled against the ticketing platform's own report, and sees which marketing is driving sales from real promo or tracking codes and Mailchimp campaigns, on a hosted deployment they use daily.

| Sprint | Goal | Gate | Depends on |
|---|---|---|---|
| 0 | Access: On The Stage answers, Mailchimp key, rotated Gemini key, Prism.fm request sent, hosting decision | Items in hand | Daniel |
| 1 | On The Stage data path (M0): import core, then adapter or report-import connector | One production reconciled against On The Stage's report | On The Stage's answer, a sample export |
| 2 | Live marketing attribution (M2): promo codes on orders, one Mailchimp campaign, channels and spend; Gemini live check | "What's driving sales" names a real campaign; unattributed share honest | Sprint 1 |
| 3 | Hosted pilot: managed Postgres, HTTPS, DB-backed throttle, password reset, scheduled sync | Daniel uses the hosted URL daily for a week | Sprint 1 |
| 4 | Mobile on device: dev build or TestFlight, icon and splash | Shows checked from a phone in about 30 seconds | Sprint 3 |
| 5 | Second organization onboarded, all productions read, attention rules tuned | A second venue or promoter live | Sprints 2 to 4 |

Post-MVP, in order: Prism.fm (M3), Klaviyo or Laylo (M4), WordPress + GA4 (M5), Ticket Evolution (M6), push notifications, app-store distribution, ad-platform spend connectors.

## How each new integration reaches both clients

1. Adapter in `src/providers/<vendor>/` with health, bounded reads, normalization and sync result reporting.
2. Rules in `src/domain/`, plus extending `ShowCard`/attention when the mobile glance needs it.
3. API in `src/server/`, with types in `src/shared/apiTypes.ts`.
4. Desktop gets the detail, provenance and integration management. Mobile gets the summary on the show card plus attention items.

## Deferred, by design

- Background sync schedules (manual Refresh only until live data is verified)
- Push notifications for attention items (mobile). This needs a hosted backend and store builds.
- App-store distribution and a hosted deployment (need Daniel's confirmation and accounts)
- Multi-org self-service sign-up and SSO
