# Integration evidence

Status key: **CONFIRMED-DOC** = seen in an Eventbrite-published source · **SECONDHAND** = third-party documentation only · **ASSUMED** = implementation assumption, must be verified by a live read · **LIVE-VERIFIED** = observed in an authorized live read (none yet).

A fixture test passing is not live verification.

## Eventbrite (M1, read-only)

### Research conditions (2026-10-20)

- This build environment's network policy **blocks** `www.eventbrite.com` and `www.eventbriteapi.com`, so neither the official API reference (https://www.eventbrite.com/platform/api) nor the live API could be reached.
- Sources actually consulted:
  - Eventbrite's own (archived) Python SDK, `github.com/eventbrite/eventbrite-sdk-python`: `eventbrite/access_methods.py`, `client.py`, `utils.py`.
  - Web search results summarizing the API, from third parties (Fivetran, Alloy, Educative, Workato) and Eventbrite's API Terms of Use.
- **Before the first live run**, re-check every ASSUMED/SECONDHAND row below against the official reference.
- **`npm run probe:eventbrite`** (`src/providers/eventbrite/probe.ts`) answers most ASSUMED rows from real payloads: status values; `status` filter counts for orders and attendees; money object keys and integer check; cost fields present; fee shape (gross = base + fees + tax vs base + tax); whether order costs are pre- or post-refund on partially refunded orders; and whether the default attendee listing hides not-attending tickets. Update the rows below from its report and record the date.

### Authentication

| Item | Value | Status |
|---|---|---|
| Base URL | `https://www.eventbriteapi.com/v3/` | CONFIRMED-DOC (SDK `utils.py`) |
| Auth header | `Authorization: Bearer <token>` | CONFIRMED-DOC (SDK `client.py`) |
| Credential | Private token / OAuth token of a user with access to the organization | SECONDHAND |
| Storage | Server environment variable named by `source_connections.secret_ref`; never in DB, Git, logs or browser | Implementation |

### Endpoints used (GET only)

| Purpose | Endpoint | Status |
|---|---|---|
| Health/validation | `GET /users/me/` | CONFIRMED-DOC (SDK docstring references `/users/me/`) |
| Event (one performance) | `GET /events/:id/` | CONFIRMED-DOC (SDK `get_event`) |
| Orders | `GET /events/:id/orders/`, response key `orders`, paginated | CONFIRMED-DOC (SDK `get_event_orders`) |
| Order status filter | `status=all_not_deleted` (values: active, inactive, both, all_not_deleted) | SECONDHAND |
| Attendees (one per ticket) | `GET /events/:id/attendees/`, response key `attendees`, paginated | CONFIRMED-DOC (SDK `get_event_attendees`) |
| Attendees default status filter | No filter sent; assumed to return attending, not-attending and refunded records | ASSUMED |
| Ticket classes | `GET /events/:id/ticket_classes/` | CONFIRMED-DOC (not called in M1) |
| Organizations / org events | `/users/me/organizations/`, `/organizations/:id/events/` | SECONDHAND (not called in M1; event is selected explicitly by ID) |

### Pagination

- The response has a `pagination` object containing `has_more_items`, `continuation`, `page_number`, `page_count`, `page_size` and `object_count`. The next page is requested with `?continuation=<token>`. (SECONDHAND)
- Implementation: follow `continuation` when it is present, otherwise fall back to `page=N+1`. The client stops with an error after 200 pages (configurable) and on a repeated continuation token. It never truncates silently. Duplicate IDs across pages are deduplicated (the most recent `changed` wins).

### Rate limits and retries

- Eventbrite API Terms state 1,000 calls/hour per OAuth token. Third parties report 2,000/hour and 48,000/day. The conservative figure, 1,000/hour, is used for planning. (SECONDHAND, conflicting)
- Implementation: at most 500 requests per sync, a 15 s timeout per request, and up to 3 retries for 429, 5xx, timeouts and network errors. Retries honor `Retry-After`, otherwise use exponential backoff (1 s, 2 s, 4 s), with each wait capped at 30 s. 401, 403 and 404 are never retried. The pilot event is small: about 140 orders is roughly 3 order pages plus 8 attendee pages.
- Error body: `{ "error": "<CODE>", "error_description": "..." }`. Only the code is surfaced (codes such as `INVALID_AUTH`, `NOT_AUTHORIZED`, `HIT_RATE_LIMIT` are SECONDHAND/ASSUMED).

### Incremental sync

- `changed_since` exists on orders/attendees listings (SECONDHAND), but whether it reports refunds and deletions has not been verified. **M1 runs a full bounded read of the pilot event on every Refresh.** Orders absent from a later full read are flagged `missing_from_source`, excluded from totals and listed as exceptions. They are never deleted.

### Money semantics

| Field | Meaning used | Status |
|---|---|---|
| Money object | `{ currency, value, major_value, display }`; `value` is an integer in minor units | SECONDHAND; validated as integer at runtime (non-integer → error) |
| `costs.gross` | Total paid by the buyer | ASSUMED |
| `costs.base_price` | Ticket face value (possibly after discount) | ASSUMED |
| `costs.eventbrite_fee` | Eventbrite service fee | ASSUMED |
| `costs.payment_fee` | Payment processing fee | ASSUMED |
| `costs.tax` | Tax collected | ASSUMED |
| Fee payer | Depends on event/ticket-class settings (fees passed to buyer vs absorbed). **Not determined.** | ASSUMED |
| Refund amounts | No refund-amount field identified. Full refund: order status `refunded`. Ticket-level: attendee `refunded`/`cancelled` flags. Whether order `costs` are reduced after a partial refund: **unknown** | ASSUMED |
| Payouts | Not read in M1 | — |

Consequences in code:
- `organizer proceeds` stays **Unavailable** for live connections (`proceeds_policy = 'unverified'`) until reconciliation against Eventbrite's report documents fee ownership.
- Partial refunds are taken from ticket-line gross and flagged `partial_refund_line_level`, on the assumption that order costs show pre-refund values.
- Discounts and cash remitted are shown as Unavailable.

### Status mapping

| Order `status` | Normalized | Status |
|---|---|---|
| `placed` | completed | SECONDHAND |
| `refunded` | refunded | SECONDHAND |
| `deleted` / `cancelled` | cancelled | ASSUMED |
| `unpaid`, `pending`, `started`, `abandoned` | unpaid (never a sale) | ASSUMED |
| anything else | other → excluded, exception raised | — |

| Attendee | Normalized | Status |
|---|---|---|
| `cancelled: true` | cancelled | SECONDHAND |
| `refunded: true` | refunded | SECONDHAND |
| `status: Attending` / `Checked In` | active (zero gross → comp) | SECONDHAND |
| `status: Unpaid` | unpaid | ASSUMED |
| `Not Attending` without flags (e.g. transfer) | other → not counted, exception raised | ASSUMED |

### Multiple performances

Each Eventbrite series occurrence has its own event ID (`series_id` links them). RevOS maps **one Eventbrite event ID to one canonical event (performance)**. Shows that share a title are never merged.

### Privacy

Never read or stored: attendee `profile` (name, email, phone, address), barcodes, answers. Kept for audit only: IDs, statuses, ticket class, quantity, money components and timestamps.

## Eventbrite tracking links (M2, marketing linkage, D13)

| Item | Value | Status |
|---|---|---|
| Tracking link format | Event URL with `?aff=CODE`, created under Marketing → Tracking links in the event dashboard | SECONDHAND (Eventbrite help article via search) |
| Where the code appears in the API | `affiliate` on the **attendee** record ("the affiliate code if the ticket was purchased through an affiliate"). No order-level field found. | SECONDHAND (Workato connector docs). `probe:eventbrite` lists attendee keys so this can be confirmed live |
| Handling | Trimmed and accepted only if it matches `[A-Za-z0-9._~-]{1,100}`, otherwise treated as absent. An order with two different codes is "conflicting" and left unattributed | Implementation |

## Mailchimp (M2, read-only)

Research conditions: `mailchimp.com` is blocked by this environment's network policy. The official docs pages were read only through search-engine excerpts of `mailchimp.com/developer/marketing/api/...` pages.

| Item | Value | Status |
|---|---|---|
| Base URL | `https://<dc>.api.mailchimp.com/3.0/`, with `<dc>` taken from the API key suffix (`…-us21`) | DOC-EXCERPT |
| Auth | HTTP Basic with any username and the API key as password (OAuth bearer also documented) | DOC-EXCERPT |
| Account check | `GET /` returns `account_id`; RevOS refuses a key from a different account | ASSUMED field name |
| Campaign reports | `GET /reports?since_send_time=…&count=&offset=` returns `reports[]` with `id`, `campaign_title`, `subject_line`, `emails_sent`, `send_time`, `opens.unique_opens`, plus `total_items` | DOC-EXCERPT (field names partly ASSUMED) |
| Link clicks | `GET /reports/{campaign_id}/click-details` returns `urls_clicked[]` with `url`, `total_clicks`, `unique_clicks` (A/B campaigns only; multivariate campaigns are not supported by this endpoint) | DOC-EXCERPT |
| Pagination | `count` / `offset` with `total_items`; RevOS pages at 100, with a 50-page bound | DOC-EXCERPT (max count ASSUMED) |
| Not used | Mailchimp e-commerce "attributed revenue", list/member/email-activity endpoints (subscriber-level personal data) | Policy |
| Clicks semantics | Unique clicks are summed per distinct link to the same show; one person clicking two links counts twice. Labeled "per 100 clicks" | Implementation |

## Prism.fm (M3, deals/budgets/settlements, D14)

No public API documentation was found (search, 2026-10-21). Prism.fm advertises ticketing integrations (Eventbrite, Etix, See Tickets); third-party directories mention API-key access through a developer portal; consultancies build custom connections. **BLOCKED:** Daniel needs to ask Prism.fm for API access, documentation and terms. No endpoint will be written until those exist.
