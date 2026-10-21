# RevOS: technical report for product review

**Prepared for:** ChatGPT, acting as product-specification reviewer for Daniel Spicka
**Prepared by:** Claude Code (implementation agent)
**Date:** 2026-10-21
**Branch:** `claude/revos-implementation-lqwgz7` in `dspicka-sketch/event-revenue-os-v3`, 10 implementation commits, HEAD `fc2b86d` before this report's commit
**Push state:** pushed to GitHub on 2026-10-21 after write access was granted.

This report states what exists, how it works, what was verified and how, and what is assumed or blocked. Anything not listed as verified should be treated as unverified.

---

## 1. Executive summary

| Area | State |
|---|---|
| M1: Eventbrite → normalized orders → reconciled revenue → desktop dashboard | Code complete and tested on fixtures. **Live gate BLOCKED**: no credentials, and this environment's network policy denies `www.eventbriteapi.com`. |
| Scope update: desktop + mobile on one backend | Done. One API, database, auth system and domain module serve both clients. |
| Shared platform: auth, targets, pace, attention | Done (fixtures + tests) |
| Mobile client (Expo SDK 58 / React Native 0.88) | First version built; typechecked, unit-tested, bundles export for web and iOS. **Not run on a device or simulator.** |
| M2–M6 (Mailchimp, WordPress/GA4, Klaviyo, Airtable, Ticket Evolution) | Not started, by design. Shown as "planned" in the UI. |
| Tests | 61 root tests (unit + PostgreSQL-backed integration + HTTP API) and 6 mobile tests, all passing |
| Real revenue data processed so far | **None.** All data seen in either client is synthetic fixture data. |

---

## 2. Architecture

```
            ┌──────────────── Desktop web (React 19 + Vite) ─────────────┐
            │                                                             │
 Vendor ──► Adapter (read-only) ──► Normalize ──► PostgreSQL ──► Revenue/   ──► Fastify JSON API ──► both clients
 APIs       src/providers/*         (no PII)       (org-scoped)  Pulse rules     (bearer sessions)
                                                                  src/domain/
            └──────────────── Mobile (Expo / React Native) ──────────────┘
```

- **Language and runtime:** TypeScript (strict) on Node 22.
- **Server:** Fastify 5.
- **Database:** PostgreSQL 16 with forward-only SQL migrations and a migrator of about 40 lines. No ORM.
- **Desktop:** React 19 + Vite 7, with no UI library.
- **Mobile:** Expo SDK 58, Expo Router, React Native 0.88, `expo-secure-store`, `react-native-svg`.
- **Single source of calculation truth:** `src/domain/` (money, revenue, reconciliation, show cards and attention rules) is pure and I/O-free. The server uses it. The mobile app imports the same files through a Metro resolver alias, and TypeScript paths typecheck them with the app. API contract types live in `src/shared/apiTypes.ts` and are used by server, web and mobile. Neither client reimplements a revenue or alert rule.
- **The browser and the app never call vendor APIs** and never receive vendor secrets.
- **Code size:** about 5,800 lines of TS/TSX/SQL, of which about 1,050 are tests.

### 2.1 Data model (migrations `001_init.sql`, `002_auth_targets.sql`)

| Table | Purpose and key rules |
|---|---|
| `organizations` | Tenant. `is_fixture` isolates synthetic data. Default timezone America/Los_Angeles. |
| `source_connections` | Provider, account and mode (`live`/`fixture`). `secret_ref` holds the *name* of a server env var, never its value. Status: `not_configured`/`verifying`/`verified`/`stale`/`error`/`fixture`. DB CHECK constraints: a fixture connection can never be `verified`, and a live connection can never be `fixture`. Separate `last_attempt_at` / `last_success_at`. `proceeds_policy` is `unverified` by default. |
| `canonical_events` | One row = **one performance** (date/time), not a show title. |
| `source_event_mappings` | Vendor event ID → canonical event. Unique on (org, provider, account, source_event_id). |
| `orders` | Normalized order. Money is `bigint` minor units + `char(3)` currency + scale. NULL = unknown. Unique on (org, provider, account, source_id). Keeps transaction time, source update time, ingestion time, first/last seen sync, and a `missing_from_source` flag. |
| `order_lines` | One per ticket/attendee, with the same keying and provenance. |
| `sync_runs` | Every Refresh attempt: status, error kind/message, pages, requests, inserted/updated/missing counts. |
| `reconciliation_results` | JSON output of the revenue engine per successful sync, plus an optional manually entered source-report comparison. |
| `users`, `organization_members`, `sessions` | Auth (section 5). |
| `event_targets` | Manual plan values per show: paid tickets, gross after refunds, or organizer proceeds. Never added to actuals. |

Composite foreign keys `(id, organization_id)` prevent cross-org references at the database level.

---

## 3. Financial rules: how each brief requirement is implemented

| Brief rule | Implementation |
|---|---|
| Integer minor units, currency + scale, no floats | `src/domain/money.ts`. Values are asserted to be safe integers. Scale comes from `Intl` (USD 2, JPY 0, BHD 3). pg `int8` is parsed with a safe-integer guard. Formatting uses integer math. |
| Never add currencies | Every measure is computed per currency, and multi-currency events render one row per currency. A test asserts that USD and CAD stay separate. |
| Missing = unknown, not zero | A `MeasureSum` counts known and unknown inputs. Each measure is `complete`, `partial` (lower bound plus count of unknowns) or `unavailable` (no number shown). |
| Keep components distinct | Measures: gross buyer payments, refunds, gross after refunds, ticket face value, platform fees, payment fees, tax, discounts (always Unavailable: no source field), organizer proceeds, cash remitted (Unavailable: payouts not connected). |
| Don't call gross "net revenue" | Labels say "Gross buyer payments" / "Gross after refunds… before fees and tax". Every measure has a definition shown beside it on desktop. |
| Organizer proceeds only after fee ownership is documented | `proceeds_policy = 'unverified'` (default for live) shows proceeds as Unavailable. `gross_minus_fees_and_tax` derives gross − platform fee − payment fee − tax, net of refunds, and marks the result **partial** whenever refunds exist, because fee treatment on refunds is unverified. The fixture org uses the derived policy, labeled as a fixture assumption. |
| One order's lines must not multiply order-level totals | Money comes from **order-level** costs, counted once per order. Lines supply counts. A reconciliation row checks Σ order gross = Σ ticket gross for orders without refunds. Mismatches are flagged and the order value is kept. |
| Canceled/unpaid excluded; partial refunds explicit | Order status mapping is in section 4.3. A full refund moves the order's gross to refunds. A line-level refund inside a completed order subtracts the line gross and raises the `partial_refund_line_level` exception, because whether Eventbrite reduces order-level costs after a partial refund is **unknown**. A refunded order with active lines is flagged. |
| Ticket counts: paid / refunded-canceled / comp / allocated | Paid (active, non-zero price), comp (active, zero price), refunded, cancelled and unpaid are all counted separately. **Allocation/capacity is not read yet** (ticket classes endpoint not called). |
| Transaction time and performance date both kept; UTC stored, venue tz displayed | Both are stored. Daily pace buckets by venue-local sale date. UI labels say "sale date" vs "performance date". |
| Plan/budget never counted as sales | Targets are a separate table, compared and never summed. "Behind" is a labeled run-rate comparison (last 7 days' average vs needed per remaining day), explicitly "not a forecast". |
| Retain last good data after failure, label stale | Failed syncs never touch stored records or the last reconciliation. The connection becomes `stale` and both clients show a Stale label plus an actionable message. |

---

## 4. Eventbrite adapter

### 4.1 Evidence levels
`docs/integrations.md` records every endpoint and semantic as **CONFIRMED-DOC**, **SECONDHAND** or **ASSUMED**. The official API reference and API host were unreachable from this environment. The confirmed items come from Eventbrite's own archived Python SDK on GitHub:
- Base URL `https://www.eventbriteapi.com/v3/`
- `Authorization: Bearer <token>`
- `GET /events/:id/`, `/events/:id/orders/`, `/events/:id/attendees/`, `/users/me/`

Everything else (pagination field names, status values, money object semantics, rate-limit numbers) is secondhand or assumed.

### 4.2 Behavior
- Only GET requests are issued. The fixture transport throws on anything else.
- **Bounds:** 15 s timeout per request, 500 requests per sync, 200 pages per listing. Exceeding a bound is an error, never a silent truncation.
- **Pagination:** follows `continuation`, falling back to `page=N+1`. A repeated continuation token is an error, and duplicate IDs across pages are de-duplicated.
- **Retries:** at most 3, only for 429, 5xx, timeouts and network errors. They honor `Retry-After`, otherwise back off 1 s / 2 s / 4 s, capped at 30 s. 401, 403 and 404 are never retried.
- **Error kinds** each map to plain-language actions: `auth`, `forbidden`, `not_found`, `rate_limited`, `timeout`, `network`, `server`, `bad_response`, `limit_exceeded`, `not_configured`.
- Refuses an event whose `organization_id` differs from the configured account.
- **Full bounded re-read on every Refresh.** `changed_since` is not trusted for refunds or deletions. Orders absent from a later full read are flagged `missing_from_source`, excluded and listed. They are never deleted.
- **PII:** attendee profile, name, email, phone, address and barcodes are never read into normalized records or stored.

### 4.3 Status mapping (ASSUMED unless noted)
- **Orders:** `placed`→completed (secondhand), `refunded`→refunded (secondhand), `deleted`/`cancelled`→cancelled, `unpaid`/`pending`/`started`/`abandoned`→unpaid, anything else→`other` (excluded and flagged).
- **Attendees:** `cancelled`→cancelled, `refunded`→refunded, `Attending`/`Checked In`→active, `Unpaid`→unpaid, `Not Attending` without flags→`other` (flagged).

---

## 5. Authentication and access (shared by both clients)

- **Accounts:** no public sign-up. The CLI `npm run user -- create|grant|reset-password` prints a one-time generated password.
- **Passwords:** Node's built-in scrypt (N=16384, r=8, p=1, 16-byte salt).
- **Sessions:** a random 256-bit bearer token is returned once. Only its SHA-256 is stored. Lifetimes are web 14 days, mobile 30 days, CLI 1 day. Logout revokes. Bearer tokens (not cookies) are used so one mechanism serves browser and native, with no CSRF surface.
- **Roles:** `admin` (set targets, test connections) and `viewer` (read, Refresh).
- **Org scoping:** every `/api/orgs/:orgId/*` route checks membership. Non-members get **404**, so an org's existence is not revealed. Every repository query also filters by `organization_id`.
- **Sign-in throttle:** 10 failures per email+IP per 15 minutes, held in memory. Unknown email and wrong password take the same time and return the same error.
- **Token storage:** web uses `localStorage`; mobile uses the iOS Keychain / Android Keystore via `expo-secure-store`.
- **CORS:** off by default. `REVOS_CORS_ORIGINS` is an allowlist used only for the mobile web preview; native apps don't need it.

### API
| Method | Path | Role |
|---|---|---|
| GET | `/api/health` | public |
| POST | `/api/auth/login`, `/api/auth/logout` | public / session |
| GET | `/api/me` | session (user + orgs + role) |
| GET | `/api/orgs/:orgId/pulse` | viewer: show cards + summary (mobile home, desktop tiles) |
| GET | `/api/orgs/:orgId/events`, `/events/:eventId` | viewer: full revenue, reconciliation, exceptions, sync history, card |
| POST | `/api/orgs/:orgId/events/:eventId/refresh` | viewer: runs the read-only sync |
| PUT / DELETE | `/api/orgs/:orgId/events/:eventId/targets[/:measure]` | admin |
| GET | `/api/orgs/:orgId/connections` | viewer: status, whether a credential is present (boolean only), planned connectors |
| POST | `/api/orgs/:orgId/connections/:id/test` | admin: credential check, does not set `verified` |

---

## 6. Clients

**Desktop (detailed analysis, reconciliation, integration management)**
- **Shows list:** summary tiles (upcoming shows, paid tickets last 7 days, upcoming gross per currency, shows needing attention), then per show: date, paid tickets, gross after refunds, proceeds (with status tag), target progress, last 7 days, top attention item, freshness.
- **Show detail:** connection/freshness panel; needs-attention list; targets with admin editor (decimal string → minor units, no floats); 14-day pace chart (single series, hover tooltip, table view); per-currency counts and revenue components with definitions; reconciliation table (internal order-vs-line check plus optional source-report comparison); exceptions; ticket-class breakdown; sync history; Refresh.
- **Integrations:** status, last attempt and last success, whether the credential is present (boolean only), proceeds rule, Test connection, and planned connectors M2–M6.
- **Fixture organizations** show a striped "FIXTURE DATA" banner. Live organizations show a "LIVE" strip.

**Mobile (a 30-second glance for venue owners, promoters and talent buyers)**
- **Sign-in:** with a server address; warns about unencrypted non-local `http://`.
- **Shows:** summary card, then show cards sorted tonight → upcoming soonest → unscheduled → past. Each card shows timing ("In 24 days"), paid tickets, compact gross sales, last 7 days vs prior 7, first target meter, 14-day pace bars, top attention item and "updated N ago", plus Fixture/Stale pills.
- **Show detail:** full attention list, pace chart, all targets, revenue summary (identical figures to desktop), freshness, Refresh from source.
- **Account:** org list with LIVE/FIXTURE and role, sign out. Target and integration management is deliberately desktop-only.

---

## 7. Verification performed (exact)

| Check | Method | Result |
|---|---|---|
| Unit + integration tests | `npm run check` against local PostgreSQL 16 | **61/61 pass** (money 6, revenue 12, pulse 8, Eventbrite client 10, DB sync 11, HTTP API 14); typecheck, build and secret/PII scan clean |
| Mobile | `npm run typecheck`, `vitest` | pass; 6/6 |
| Mobile bundling | `expo export --platform web` and `--platform ios` | both build; iOS output is Hermes bytecode (2.7 MB) including the shared domain modules |
| Desktop UI | Playwright/Chromium at 1280 px and 390 px | sign-in → list → detail (tooltip) → integrations (test connection) work; no horizontal overflow |
| Mobile UI | Expo web export in Playwright at 390×844, light and dark | sign-in → shows → detail → Refresh → account work; figures identical to desktop for the same show ($13,898.85 gross after refunds; $12,445.00 proceeds, partial) |
| Secrets/PII | scanner over tracked files + built bundle | clean |

### Acceptance gates (from the brief)
| Gate | Status |
|---|---|
| Same source synced twice → no duplicates | **Pass** (DB test) |
| Multi-page response, limits honored | **Pass** (continuation pages counted; page bound errors) |
| Multiple lines in one order → order-level once | **Pass** |
| Partial/full refund or cancellation | **Pass**, with ambiguity flagged as designed |
| Missing fees/costs/payout → unknown/partial | **Pass** |
| 401/403, 429, timeout → specific state, bounded retries | **Pass** |
| Failed sync after success → last good retained, stale | **Pass** (DB + API tests) |
| Multiple performances/accounts/currencies | **Pass** for performances, orgs and currencies. Two accounts *within one org* is covered only by key design, not a dedicated test. |
| Real-source reconciliation, zero unexplained difference | **BLOCKED** (no credentials or network) |
| Secret/privacy inspection | **Pass** (automated heuristic scan; not a manual audit) |
| Later: resale overlap, campaign attribution | Not started (M6, M2) |

---

## 8. Known limitations and risks (for the reviewer to challenge)

**Data correctness (highest priority to verify live)**
1. **Attendee default filter:** the attendees request sends no status filter. If Eventbrite's default excludes refunded or not-attending attendees, refund and ticket counts would be understated.
2. **Order status values and the `status=all_not_deleted` parameter** are secondhand or assumed.
3. **Partial refunds:** the implementation assumes order-level `costs` are pre-refund. If Eventbrite reduces them, refunds would be double-subtracted for partially refunded orders. This is flagged on every such order.
4. **Fee ownership and refund fee treatment** are unknown. That is why live proceeds are Unavailable.
5. **Product risk:** a community thread reports aggressive Eventbrite rate limiting and claims reduced API support. This is unverified, but it matters for an Eventbrite-first pilot.

**Engineering**
6. **Refresh has no per-user rate limit.** A viewer can trigger repeated syncs and spend the vendor quota. Only "one running sync per event" is enforced, and that check isn't atomic across server processes.
7. **The login throttle is in-process memory.** It doesn't survive restarts or scale across instances.
8. **No security headers / CSP yet.** The web session token in `localStorage` is exposed to any XSS.
9. **No HTTPS termination or hosting.** The server is for local or trusted-network use only.
10. **A crashed sync stays "running" for up to 10 minutes** before another can start.
11. **Orders with no `created` timestamp** are left out of daily pace (they still count in totals).
12. **Mobile has not run on a device.** Hermes `Intl` time-zone support is assumed; the iOS bundle compiled, but runtime behavior is unverified. Icons and splash are template defaults.
13. **Expo and Eventbrite docs could not be fetched.** Mobile APIs were validated against installed type definitions and real bundle exports.

**Fixed during this session** (listed for transparency):
- A phone-width overflow on desktop.
- An `Intl` option conflict that blanked the page.
- Test-database reset missing `users`.
- A compact-money rounding edge case ($999,950 shown as "1000K").
- Two different definitions both labeled "last 7 days" on desktop, now unified on venue-local sale days.

---

## 9. Decisions and deviations (see `docs/DECISIONS.md`)

- **D9:** scope adds a mobile app sharing the whole backend. Order: finish the desktop M1 slice → mobile → M2–M6.
- **D10:** per-user accounts replaced the single pilot access token (`REVOS_ACCESS_TOKEN` removed). This is a breaking change to the run instructions; the README is updated.
- **D11:** Expo chosen over PWA, Capacitor, Flutter or native. The deciding factor was sharing the TypeScript domain code with no reimplementation.
- **D12:** targets are manual until Airtable (M5), and "behind" is a run-rate comparison only.
- **Proposed, not done:** a `financial_adjustments` table, deferred until a source exposes explicit refund/adjustment amounts.

---

## 10. Questions for the product owner / reviewer

1. **Proceeds definition for Eventbrite:** should organizer proceeds be gross − Eventbrite fee − payment fee − tax regardless of who pays fees, or does Daniel want "fees passed to buyer" vs "absorbed" shown separately once the live read reveals settings?
2. **"Needs attention" thresholds:** is 24 hours without a refresh the right staleness alert, given there are no background schedules yet? Should behind-target require some minimum number of days left before it fires?
3. **Who sees proceeds:** should viewers (e.g. talent buyers) see organizer proceeds, or only tickets and gross?
4. **Which target metric is primary** for the mobile card: paid tickets or gross?
5. **Hosting:** where should the pilot backend live, so the phone app can be used away from the local network? This needs a paid-service decision.

---

## 11. Next actions

1. ~~Fix GitHub write access~~ Done 2026-10-21; branch pushed.
2. **Daniel:** run the live Eventbrite read and reconcile against Eventbrite's sales report (README → Live setup), or allow `www.eventbriteapi.com` in the cloud environment and add the token as a secret.
3. **Daniel:** open the mobile app on a phone via Expo Go (`mobile/README.md`) and report anything that looks wrong.
4. **Claude, after the live read:** resolve risks 1–4 from real payloads, update `docs/integrations.md` evidence levels, then add a refresh rate limit and security headers (risks 6 and 8) before any hosting.
5. **Then M2 (Mailchimp):** reporting alongside sales, with attribution only if an order linkage is supported.
