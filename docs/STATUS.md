# Status

_Last updated: 2026-10-21. Scope: desktop web app + mobile app on one backend (see ROADMAP.md). Live verification: BLOCKED._

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
