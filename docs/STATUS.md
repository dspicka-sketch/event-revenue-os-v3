# Status

_Last updated: 2026-10-21. Scope: desktop web app + mobile app on one backend (see ROADMAP.md). Live verification: BLOCKED._

## Discovery screen and preview environment, branch `claude/candidates-screen` (2026-11-25)

**Built and tested:**
- Desktop Discovery page (`/orgs/:orgId/discovery`): candidates with the anchor show in the venue timezone, room capacity, days out, score and reasons, stage, and a show-dismissed toggle. Admins change stage and dismiss or restore; viewers read only. It renders only what the discovery API returns.
- Short-lead flag (`leadTime` in `src/domain/discovery.ts`): a candidate under 30 days out is flagged, never hidden and never down-ranked (owner, 2026-11-20). Exposed as `daysUntilShow` and `shortLead` on the candidate.
- Verification: `npm run check` with `TEST_DATABASE_URL` on local PostgreSQL 16: 194 of 194 tests passed, typecheck and build clean, secret scan clean. Mobile unchanged and its checks not run.

**Discovery v0.3 filter (owner, 2026-11-25 and 2026-11-26):**
- Keep music, comedy and touring performing arts that suit a 60-seat house. Tribute acts stay in. Bills of several acts stay in, listed under the first act.
- `nonTouringFormat` drops karaoke and open mic, bar crawls, dance and party nights, themed nights, festivals and benefits, and kids' series. Comedy stays in, including a room's own comedy night.
- The act is read out of presenter billings ("Moe's Alley Presents: X"), support lines ("X w/ Y") and tour titles.
- The venue's own nights are excluded. Punk / Metal is excluded for small-room acts (owner confirmed 2026-11-26); a watchlist act always stays.
- v0.2 (2026-11-25) had also dropped tribute acts and bills of three or more acts as session calls; the owner reversed both.
- Verification: `npm run check` with `TEST_DATABASE_URL`: 200 of 200 tests passed.

**Preview environment (owner approved 2026-11-25):**
- New Supabase project `revos` (us-east-1). The app connects as its own role, `revos_app`; every table has row level security on with no policies, so Supabase's public data API cannot read them.
- Migrations 001 to 010 applied and the fixture organization seeded there. Vercel `DATABASE_URL` (production and preview) points at it through the transaction pooler.
- A live organization "Wax Poetic" exists for discovery. No ticketing or marketing source is connected to it.

**Not done:**
- The deal model and artist-fit rules from 2026-11-20 are not in the scoring. Ticket price (what fans will pay) is still open with the owner.
- No mobile Discovery screen.
- Vercel cron schedules run only on production deployments, and nothing is deployed to production. On previews the discovery job runs only when called by hand.
- On The Stage data path still unknown (D18 questions unanswered); Mailchimp and Resend keys not set.
- When the database is unreachable the API returns the raw database error text to the client. To fix.

## AutoRev (D19), branch `claude/autorev-sprint-1` (2026-11-16)

**Built and tested (no live run yet):**
- Underplay discovery rules (`src/domain/discovery.ts`): small-room acts and watchlist matches from area shows, one candidate per act, transparent score with reasons (`discovery v0.1`, unapproved).
- Read-only Bay Shows reader, watchlist and candidate pipeline tables (ten relationship stages plus dismissal), candidate API.
- Daily sync sweep over live shows, automation run log, Resend email sender, weekly digest text, sync-failure alert email.
- Three bearer-protected cron routes and their Vercel schedule.

**Verification actually performed (2026-11-16, cloud build environment):**

| Check | Result |
|---|---|
| `npm run check` with local PostgreSQL 16 | typecheck OK; **189/189 tests** (108 existing + 81 new); web build OK; secret/PII scan clean |
| Bay Shows REST read | **Live read OK**: two paged requests answered HTTP 200 with distinct rows |
| Eventbrite and Ticketmaster reachability | Both answered HTTP 401 without a key, so the network block recorded on 2026-10-21 did not occur in this environment |

**Not verified:** any deployed run; a real Resend send; a real Eventbrite read; Vercel actually invoking the schedules; the mobile and desktop clients (no UI was added for candidates). No security scan was run (no StackHawk key in the environment).

**Independent review (2026-11-16):** one fresh reviewer read the whole branch. No critical findings; cron authentication and tenant isolation held under probing. Five findings were fixed test-first (duplicate candidate for a watched act billed with extra words; excluded artist billed with a band name; discovery run left "running" on failure; undelivered sync alert answered 200; "no admin email" not recorded). Open, by decision: an event with two live mappings is swept twice; the same show from two sources counts as two area dates; non-Latin artist names are dropped and "(Live)" suffixes split an act; unexpected error text is passed through to admins; a retried digest can be sent twice; whether Vercel `schedules` send the `CRON_SECRET` bearer the way legacy `crons` do is unverified and is the first thing the live gate checks.

**BLOCKED on the owner (live gate):**
1. Approve and create a Supabase project for RevOS (billed on the Pro plan; confirm cost first), then `npm run db:migrate`.
2. Set `DATABASE_URL`, `CRON_SECRET`, `BAYSHOWS_SUPABASE_URL`, `BAYSHOWS_SUPABASE_KEY`, `REVOS_DISCOVERY_ORG_ID`, `RESEND_API_KEY`, `REVOS_DIGEST_FROM` on the Vercel project. The Resend sending domain must be verified first.
3. Create the Wax Poetic organization and an admin user; run `npm run watchlist:seed -- <orgId>`.
4. For live sales data: an Eventbrite token from the account that owns the event, or the On The Stage path (D18).
5. PM review, a portfolio decision on E-004 (merge order with PR #5 and the On The Stage branch), then merge.

## Completed

### M1: Desktop Eventbrite slice (code complete; live gate blocked)
- Read-only Eventbrite adapter: Bearer auth, explicit org + event, bounded continuation pagination, retries for 429/5xx/timeout with `Retry-After`, specific error kinds, and an org-ownership check.
- Normalized store keyed by (org, provider, account, source ID). Full re-read on Refresh, missing records flagged, last good data kept and labeled stale.
- Money/revenue engine: integer minor units, unknown ≠ zero, per-currency measures with status and definitions, order-level charges counted once, refunds and partial refunds flagged, and proceeds gated by documented fee ownership.
- Desktop: show list, show detail (counts, revenue components, reconciliation table, exceptions, ticket classes, sync history, Refresh) and the fixture banner.

### M1.1: Shared platform for both clients
- Per-user accounts, org roles (admin/viewer) and hashed bearer sessions (web 14 d, mobile 30 d). Non-members get 404. Sign-in is throttled and the `npm run user` CLI manages accounts. This replaces the old single access token.
- Daily net sales by venue-local sale date, in the shared revenue engine.
- Shared show-card and attention rules (`src/domain/pulse.ts`): phase/days until, 14-day pace, manual targets with a run-rate "behind" check, and attention items (not configured, stale, sync error, no data, not refreshed in 24 h, reconciliation difference, records to review, behind target, multiple currencies, partial counts).
- API: `/api/auth/login|logout`, `/api/me`, `/api/orgs/:id/pulse`, targets PUT/DELETE (admin), connections list and test (admin), plus an opt-in CORS allowlist (`REVOS_CORS_ORIGINS`).
- Desktop additions: sign-in, Shows/Integrations navigation, summary tiles, target and attention columns, a needs-attention panel, a target editor (money parsed as a decimal string into minor units), a 14-day pace chart with tooltip and table view, and an integrations page (status, whether a credential is present — never its value, test connection, planned connectors).

### M1.5: Mobile client (Expo SDK 58 / React Native 0.88), in progress
- Sign-in with server address, session stored in the OS secure store, org switching.
- Shows screen: summary (upcoming shows, sold in last 7 days, upcoming gross, shows needing attention) and show cards (when, tickets, gross, last 7 days vs prior 7, first target meter, 14-day pace bars, top attention item, freshness, fixture/stale pills).
- Show screen: attention list, tickets and pace chart, targets, revenue summary (same figures as desktop), data freshness and Refresh from source.
- Account screen: org list with role and FIXTURE/LIVE labels, sign out.
- Shared code: `@revos/domain` and `@revos/shared` resolve to `../src`, so no revenue logic is duplicated.

### Hardening (2026-10-21, after the technical report)
- Only one sync can run per show (enforced by a database unique index). Runs left over from a crash are closed as `abandoned` after 10 minutes. Refresh has a 60-second cooldown per show (HTTP 429 + `Retry-After`).
- Every response gets security headers: a strict CSP (no inline script or style), nosniff, no-referrer, and a ban on framing. API responses are never cached (`no-store`). Checked in a real browser: no CSP violations across the desktop flow.
- Orders without a transaction time now raise `missing_transaction_time` instead of silently dropping out of pace figures.
- `npm run probe:eventbrite`: a read-only, PII-free diagnostic for the first live run (see integrations.md).
- The desktop "last 7 days" figure now has one definition (venue-local sale days through today), matching mobile.

### M2: "Which marketing is working" (2026-10-21, fixture; live gate pending)
After reviewing the demo, Daniel chose marketing effectiveness as RevOS's lead (D13). Deal terms come from Prism.fm (D14, BLOCKED on API access).
- **Linkage:** the Eventbrite tracking-link code (`aff`) is captured per ticket. Attribution engine `src/domain/marketing.ts`: one source per order; email campaigns only within 7 days of sending; conflicting codes and orders without a code stay unattributed and visible; refunds reduce credited revenue.
- **Mailchimp connector:** read-only, campaign aggregates only. It reads sends, opens and link clicks, maps campaigns to shows and tracking codes automatically from their Eventbrite link URLs, and never reads subscriber data or Mailchimp's own "attributed revenue".
- **One Refresh** updates the show and the organization's Mailchimp sources.
- **Desktop:** "What's driving sales" is the first panel on a show (source, type, paid tickets, share, orders, gross, orders per 100 clicks, untracked row, late-use and no-order notes), and the show list has a "Top driver" column. Admins can name tracking links.
- **Mobile:** show cards lead with "Driving sales" (top 3); the show screen lists every source.
- **Attention rules:** "most sales aren't linked to marketing" and "recent campaign with no linked orders".

### Buyer-paid line items (D15, 2026-10-21)
- Each show itemizes face value, facility fee, promoter rebate, platform fee, processing fee and tax, with a buyer-total check. The house keeps face + facility + rebate.
- Facility fee and rebate come from the source's itemized fee list (Eventbrite `fee_components`, ASSUMED) and show as unavailable when it isn't itemized.
- The fixture now carries a $2.00 facility fee, a $1.00 rebate and 8.75% tax per ticket.

### Channels, 7-day view, spend (D16, 2026-10-21)
- Each tracking link can carry a channel; boards and show panels show a channel split.
- Both apps have a "Last 7 days / To date" toggle.
- Admins can enter spend per source per show; the To date view shows cost per paid ticket, and sources with spend but no sales still appear.
- Fixture: Facebook ads $300 / $150, plus a TikTok promo with $120 spend and no sales.

## Verification actually performed (2026-10-21)

| Check | Result |
|---|---|
| `npm run check` (local PostgreSQL 16) | typecheck OK; **108/108 tests** passed (money 7, revenue 13, fees 6, pulse 12, marketing 12, marketing sync 4, Mailchimp 6, Eventbrite client 10, probe 4, DB sync 15, HTTP API 19); web build OK; secret/PII scan clean |
| Mobile `npm run typecheck` / `npm test` | OK / 6/6 passed |
| `npx expo export --platform web` and `--platform ios` | Both bundles built (iOS Hermes bytecode, 2.7 MB), including the shared domain modules |
| Desktop manual run (Playwright, 1280 px and 390 px) | sign-in → shows → show detail (pace tooltip) → integrations (test connection). No horizontal overflow at 390 px after fixing a hidden-header overflow bug |
| Mobile web preview (Playwright, 390×844, light + dark) | sign-in → shows → show detail → Refresh → account. Figures identical to desktop for the same show |

Not verified: the app on a physical iPhone or Android phone, or in a simulator. The build environment has neither.

## BLOCKED

- **Live Eventbrite read:** no credentials were supplied, and this cloud environment's network policy denies `www.eventbriteapi.com` / `www.eventbrite.com`. Every ASSUMED/SECONDHAND item in `docs/integrations.md` is still unverified, and live organizer proceeds stay Unavailable by design.
- **Expo docs:** `docs.expo.dev` is also denied here. Mobile APIs were checked against the installed package type definitions (tsc) and real bundle exports instead.

## Unresolved gaps

- Real-source reconciliation (zero unexplained difference) not done; fee payer and refund fee treatment unknown.
- Capacity/allocation, discounts and payouts are not read.
- Public hosting needs HTTPS, a shared login throttle and password reset by email.
- Mobile: on-device test, app icon/splash, push notifications and store distribution are not done.

## Next actions for Daniel
0. **Ask Prism.fm for API access** (documentation, auth and terms) for deals, budgets and settlements. This blocks M3.

1. **Run the live Eventbrite read** on your own machine. Start with `npm run probe:eventbrite` and send the developer the `reports/eventbrite-probe-*.md` file it writes (it contains no customer data). Then follow README → Live setup. Alternatively, allow `www.eventbriteapi.com` in this environment's network settings and add the token as an environment secret.
2. **Try the mobile app** on your phone: `HOST=0.0.0.0 npm start` at the repo root, then `cd mobile && npx expo start` and open it in Expo Go.
