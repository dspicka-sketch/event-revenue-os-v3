# AutoRev Plan 1: Discovery, Scheduled Sync and Weekly Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RevOS finds underplay candidates for Wax Poetic every day from Bay Shows data, refreshes every live show on a schedule, and emails each organization's admins a weekly digest of candidates, pace and attention items.

**Architecture:** Two bearer-protected cron routes are added to the existing Fastify app and triggered by Vercel Cron (the pattern Bay Shows already uses). A sweep reuses `syncEvent` per show; a pure digest builder renders the existing `OrgPulse`; an `automation_runs` table records every run so a missed or failed run is reported in the next digest. Email goes out through Resend from the server only.

**Tech Stack:** Node 22, TypeScript, Fastify 5, PostgreSQL (Supabase), Vitest, Vercel Functions and Vercel Cron, Resend HTTP API.

**Spec:** "AutoRev: Design", https://claude.ai/artifact/5FPZiMqAn5Sg9KTafX2UPF (approved by Daniel 2026-11-16: "All changes approved"). This plan covers build steps 1, 2 and 4 of that spec. Daniel moved discovery to the front on 2026-11-16, so Tasks 1A to 1D are built before the sync work. Steps 3 (announce pack) and 5 (tasks and stages) each get their own plan.

## Verified starting state (2026-11-16)

Read these before Task 1. Each was checked on the date above; re-check anything that matters before relying on it.

- `main` is at `586b1e3` (2026-10-26). It has `api/index.ts` and `vercel.json` for a Vercel deploy, and migrations `001` to `008`.
- Vercel project `event-revenue-os-v3` exists (team `team_2HKL3uUkXsz4o0f5GsXkirLf`). Its three most recent deployments are READY previews of branches `executive-os` and `claude/on-the-stage-sprint-1`, not production.
- No Supabase project exists for RevOS. The Supabase organization "Bay Shows" is on the Pro plan and holds `waxpoetic-bay-ahows` and `igottix`.
- Unmerged branches that also edit `src/server/app.ts`: `claude/gemini-api-integration-1kmvul` (PR #5, PM signed off) and `claude/on-the-stage-sprint-1` (carries D17, D18 and the adopted sprint plan). Neither is on `main`.
- D18 (adopted 2026-10-28, on the On The Stage branch) makes On The Stage the critical path and keeps Eventbrite as the reference adapter and second-venue path. The adopted sprint plan puts "scheduled sync" in Sprint 3. This plan pulls scheduled sync forward on the Eventbrite path at the owner's direction.
- Bay Shows (`dspicka-sketch/waxpoetic-bay-ahows`, Supabase project `yrenzxspbaordqgtfano`) is live. On 2026-11-16 its `events` table held 682 upcoming shows from sources `ticketmaster`, `venue_site` and `manual`, last updated 11:31 UTC that day; 655 had a venue with a known capacity and 405 were at venues of 600 capacity or less. `venues` has `capacity` and `indie`. Its public feed `GET /api/events` returns at most 500 events and does not include venue capacity.
- The underplay rules come from Daniel's August 2026 underplay search and are restated in Task 1A. Twelve Gmail drafts were created in that search; their artist names are not stored anywhere in RevOS or Bay Shows.
- From this cloud workspace `www.eventbriteapi.com` answered HTTP 401 (reachable, no token). `docs/STATUS.md` on `main` still records the Eventbrite live read as network-blocked.

## Global Constraints

- Branch: `claude/autorev-sprint-1`, cut from `main`. Do not build on the unmerged Gemini or On The Stage branches.
- Governance (CLAUDE.md): open `governance/sessions/claude-autorev-sprint-1.md` with the project-manager agent at session start. Merges to `main`, production deploys, spend and secrets are decided by Daniel.
- `npm run check` must pass before every commit.
- DB tests need `TEST_DATABASE_URL`; without it they are skipped, never faked.
- Vendor integrations stay read-only. AutoRev's only outbound action is email to the organization's own admins.
- Fixture organizations are never synced by the sweep and never emailed.
- Money: integer minor units plus currency, formatted only through `src/domain/money.ts`. Missing means unknown, never zero.
- `verified` means a successful authorized live read. A scheduled read that succeeds is live; nothing fixture-based is called verified.
- Secrets live in the server environment only: `CRON_SECRET`, `RESEND_API_KEY`, `EVENTBRITE_TOKEN`. Never in Git, logs, chat or API responses.
- No patron names, emails, phones or barcodes in the digest. Aggregates only.
- Times are stored in UTC and shown in the venue timezone.
- Never claim a deployed URL, a passing test or a live read that was not actually observed. If blocked, mark BLOCKED with the exact next step.

## Review Focus

0. Bay Shows returns the same act at two venues, or the same show from two sources: one candidate per act, carrying the nearest-dated show, never two rows. (Task 1A)
1. Vercel Cron fires but `CRON_SECRET` is unset in the environment: both routes must answer 503 `not_configured`, never run open. (Task 5)
2. One show's sync fails mid-sweep (expired token, 429): the remaining shows still sync, and the failure is named in the sweep result and the next digest. (Tasks 2 and 4)
3. The sweep has not succeeded for more than 36 hours: the digest leads with a warning line saying so, with the last success time. (Task 4)
4. An organization has no admin with an email, or Resend rejects the send: the digest run is recorded as `failed` with the reason and the route answers 502, never 200. (Tasks 3 and 5)
5. A show whose performance date is unknown (`performance_start_utc` null): it is still swept and listed in the digest under "date unknown", never dropped. (Tasks 2 and 4)

---

### Task 1: Governance and decision record

**Files:**
- Create: `governance/sessions/claude-autorev-sprint-1.md` (from `governance/templates/session-charter.md`)
- Modify: `docs/DECISIONS.md` (append D19), `governance/escalations.md` (add E-004), `docs/ROADMAP.md` (note under "Deferred, by design")

**Interfaces:**
- Produces: decision id **D19** and escalation id **E-004**, referenced by later tasks' docs.

- [ ] **Step 1:** Create the branch `claude/autorev-sprint-1` from `main`. Confirm the next free ids by reading `docs/DECISIONS.md` and `governance/escalations.md` on `main` and on `origin/claude/on-the-stage-sprint-1` (which already uses D17, D18, E-002, E-003). Use D19 and E-004 unless a higher id exists.
- [ ] **Step 2:** Write the charter. Goal: this plan's Goal. Scope in: Tasks 1 to 7. Scope out: announce pack, discovery, booking steps, On The Stage, password reset, DB-backed throttle, mobile. Acceptance criteria: Task 7's checklist.
- [ ] **Step 3:** Append D19 to `docs/DECISIONS.md` with exactly these points: AutoRev is RevOS's automation layer; background sync is enabled for live connections only, daily; a weekly digest email goes to organization admins and is RevOS's first outbound action; vendor connectors remain read-only; every run is recorded in `automation_runs`; booking and show-day steps are approved in principle and not built in this plan; approved by the owner on 2026-11-16.
- [ ] **Step 4:** Add E-004 (OPEN) to `governance/escalations.md`: AutoRev reorders the adopted sprint plan (scheduled sync before the Sprint 1 gate) and edits `src/server/app.ts` and `vercel.json`, which unmerged PR #5 and the On The Stage branch also touch. Ask the portfolio-manager agent for a merge order.
- [ ] **Step 5:** Run `npm run check`. Expected: passes. Commit: `Governance: AutoRev charter, D19 and escalation E-004`.

### Task 1A: Discovery rules (pure)

**Files:**
- Create: `src/domain/discovery.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Produces:
  - `interface AreaShow { sourceEventId: string; headliner: string; support: string[]; venueName: string; city: string; venueCapacity: number | null; startsAt: string; genre: string | null; priceMin: number | null; status: "onsale" | "low" | "soldout" | "cancelled" | "postponed"; ticketUrl: string | null }`
  - `interface DiscoveryRules { maxVenueCapacity: number; windowDays: number; excludedVenues: string[]; excludedArtists: string[]; roomSeats: number }`
  - `const WAX_POETIC_RULES: DiscoveryRules = { maxVenueCapacity: 600, windowDays: 90, excludedVenues: ["hopmonk"], excludedArtists: ["jason isbell", "chris thile"], roomSeats: 60 }`
  - `interface Candidate { artistKey: string; artist: string; anchorShow: AreaShow; score: number; reasons: string[] }`
  - `selectCandidates(shows: AreaShow[], rules: DiscoveryRules, now: Date): Candidate[]`, sorted by score descending then anchor date ascending.

Rules: a show qualifies when its status is `onsale`, `low` or `soldout`, it starts within `windowDays` of `now`, its venue capacity is known and at most `maxVenueCapacity`, and neither its venue nor its headliner matches an exclusion (case-insensitive substring for venues, exact normalized name for artists). `artistKey` is the headliner lowercased with punctuation and repeated spaces removed. One candidate per `artistKey`, anchored on its soonest qualifying show. Score is a sum of plain signals, each adding a line to `reasons`: `soldout` +3 ("sold out at <venue>"), `low` +2 ("low tickets at <venue>"), venue capacity at most 300 +2 ("plays rooms of <capacity>"), more than one qualifying show in the window +1 ("<n> area dates"), `priceMin` of 30 or more +1 ("tickets from $<priceMin>"). The capacity ceiling of 600 and these weights are Claude's starting values; Daniel has not set them.

- [ ] **Step 1: Write the failing tests:** `drops shows at venues above the capacity ceiling`; `drops shows with unknown venue capacity`; `drops HopMonk shows and the excluded artists`; `drops cancelled and postponed shows`; `collapses one act with two dates into one candidate anchored on the sooner date and adds "2 area dates"`; `scores a sold-out 250-capacity show at 5 with both reasons`; `treats "The Deslondes" and "the deslondes" as one artist`.
- [ ] **Step 2:** Run `npx vitest run test/discovery.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `selectCandidates`. No I/O.
- [ ] **Step 4:** Run the test file. Expected: PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: `Underplay discovery rules (D19)`.

### Task 1B: Bay Shows reader

**Files:**
- Create: `src/providers/bayshows/client.ts`
- Modify: `docs/integrations.md`, `.env.example`
- Test: `test/bayshows.test.ts`

**Interfaces:**
- Produces: `fetchAreaShows(opts: { url: string; key: string; now: Date; windowDays: number; fetchImpl?: typeof fetch }): Promise<AreaShow[]>`. Read-only. It calls the Bay Shows Supabase REST endpoint `GET <url>/rest/v1/events?select=source_id,headliner,support,venue_name,city,starts_at,genre,price_min,status,ticket_url,venues(capacity)&starts_at=gte.<now>&starts_at=lte.<now+windowDays>` with the `apikey` header, following `Range` pagination until a short page. A non-2xx answer throws `ProviderError`.

- [ ] **Step 1:** Confirm against the Bay Shows repo's `supabase/migrations` that the `events` and `venues` row-level-security policies allow a public read with the publishable key, and read Supabase's current REST documentation for embedded selects and pagination. Record the evidence level in `docs/integrations.md`. If public read is not allowed, stop and mark BLOCKED: the alternative is a server-side key, which is a secret and Daniel's decision.
- [ ] **Step 2: Write the failing tests** with a fake `fetchImpl`: maps a row with an embedded venue to an `AreaShow` with `venueCapacity`; a row with no venue gives `venueCapacity: null`; follows pagination across two pages; a 500 answer throws `ProviderError`.
- [ ] **Step 3:** Run the test file. Expected: FAIL. Implement. Add `BAYSHOWS_SUPABASE_URL=` and `BAYSHOWS_SUPABASE_KEY=` to `.env.example`.
- [ ] **Step 4:** Run the test file. Expected: PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: `Read-only Bay Shows reader for discovery (D19)`.

### Task 1C: Candidate log

**Files:**
- Create: `src/db/migrations/009_discovery.sql`
- Modify: `src/db/repo.ts`
- Test: `test/discovery-log.test.ts`

**Interfaces:**
- Produces:
  - Table `discovery_candidates(id uuid pk, organization_id uuid not null references organizations on delete cascade, artist_key text not null, artist text not null, status text not null default 'scouting' check (status in ('scouting','contacted','followup','responded','booked','passed')), score int not null, reasons jsonb not null, anchor jsonb not null, first_seen_at timestamptz not null, last_seen_at timestamptz not null, status_changed_at timestamptz, notes text, unique (organization_id, artist_key))`. The six statuses are the ones Daniel's August tracker used.
  - `upsertCandidates(db, orgId: string, candidates: Candidate[], now: Date): Promise<{ added: number; refreshed: number }>`. A new `artist_key` is inserted as `scouting`. An existing row has `score`, `reasons`, `anchor` and `last_seen_at` refreshed; its `status` and `notes` are never changed.
  - `listCandidates(db, orgId: string, opts?: { status?: CandidateStatus; firstSeenSince?: Date }): Promise<CandidateRow[]>`
  - `setCandidateStatus(db, orgId: string, id: string, status: CandidateStatus, notes: string | null, now: Date): Promise<boolean>`

  The run-log migration in Task 3 becomes `010_automation_runs.sql`.

- [ ] **Step 1: Write the failing DB tests:** `a new act is added as scouting`; `a second run does not duplicate the act and refreshes its score`; `a contacted act keeps its status when it reappears`; `one organization cannot read or change another's candidates`.
- [ ] **Step 2:** Run the test file. Expected: FAIL. Implement the migration and functions.
- [ ] **Step 3:** Run the test file. Expected: PASS. Run `npm run check`.
- [ ] **Step 4:** Commit: `Discovery candidate log with pipeline statuses (D19)`.

### Task 1D: Discovery route, API and digest section

**Files:**
- Modify: `src/server/app.ts`, `src/shared/apiTypes.ts`, `api/index.ts`, `src/server/index.ts`
- Test: `test/api.test.ts`

**Interfaces:**
- Consumes: Tasks 1A to 1C. The cron bearer check is the one specified in Task 5; build that helper here and reuse it there.
- Produces:
  - `AppOptions` gains `cronSecret?: string`, `discoveryOrgId?: string` and `areaShowsSource?: (now: Date) => Promise<AreaShow[]>`.
  - `GET /api/cron/discovery` → 200 `{ added: number; refreshed: number; considered: number }`; 503 `not_configured` when the secret, the organization id or the source is missing.
  - `GET /api/orgs/:orgId/discovery?status=` (member) → `{ candidates: CandidateDto[] }`.
  - `PUT /api/orgs/:orgId/discovery/:id` (admin), body `{ status, notes? }` → 200, or 404 for another organization's id.
  - Task 4's `buildDigest` input gains `newCandidates: { artist: string; reasons: string[]; anchorVenue: string; anchorDate: string }[]`, rendered as a "New underplay candidates this week" block listing up to 10, or "No new candidates this week."

- [ ] **Step 1: Write the failing tests:** the cron route answers 503 unconfigured and 401 on a wrong bearer; with a fake source of three shows it adds the qualifying acts and reports the counts; a second call adds none; a viewer can list and cannot change status; an admin can set `contacted`; a non-member gets 404.
- [ ] **Step 2:** Run `npx vitest run test/api.test.ts`. Expected: new tests FAIL. Implement. `discoveryOrgId` comes from `REVOS_DISCOVERY_ORG_ID`; the source is built from the Bay Shows variables only when both are set.
- [ ] **Step 3:** Run the test file. Expected: PASS. Run `npm run check`.
- [ ] **Step 4:** Commit: `Daily discovery job and candidate API (D19)`.

### Task 2: Sync sweep

**Files:**
- Create: `src/sync/syncAll.ts`
- Modify: `src/db/repo.ts` (add `listSyncableEvents`)
- Test: `test/sync-all.test.ts`

**Interfaces:**
- Consumes: `syncEvent(db, orgId, eventId, …)` and `AdapterFactory` from `src/sync/syncEvent.ts`.
- Produces:
  - `listSyncableEvents(db: Queryable, now: Date): Promise<SyncableEvent[]>` where `SyncableEvent = { organizationId: string; eventId: string; name: string; performanceStartUtc: Date | null }`. Returns mapped events on `mode = 'live'` connections in non-fixture organizations whose `performance_start_utc` is null or later than `now` minus 7 days.
  - `syncAllEvents(db: Db, opts: { now: Date; adapterFactory?: AdapterFactory }): Promise<SweepResult>` where `SweepResult = { startedAt: string; finishedAt: string; attempted: number; succeeded: number; failures: { organizationId: string; eventId: string; name: string; kind: string; message: string }[] }`.

- [ ] **Step 1: Write the failing tests** in `test/sync-all.test.ts` using `describeDb` and `freshDb` from `test/helpers/db.ts`, following `test/sync.test.ts` for seeding:
  - `sweeps live upcoming events and skips fixture organizations`: seed one live org with one upcoming event and one fixture org; assert `attempted === 1`.
  - `includes an event with no performance date`: seed `performance_start_utc` null; assert it is attempted.
  - `skips an event that ended more than 7 days ago`.
  - `one failing event does not stop the others`: adapter factory throws `ProviderError("auth_failed", …)` for the first event; assert `attempted === 2`, `succeeded === 1`, `failures[0].kind === "auth_failed"`.
- [ ] **Step 2:** Run `npx vitest run test/sync-all.test.ts`. Expected: FAIL, `syncAllEvents` not found.
- [ ] **Step 3:** Implement `listSyncableEvents` and `syncAllEvents`. Events run sequentially. A `syncEvent` result with `ok: false` becomes a `failures` entry; a thrown error is caught and recorded with `kind: "unexpected"`.
- [ ] **Step 4:** Run the test file. Expected: PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: `Sync sweep over all live upcoming events (D19)`.

### Task 3: Run log and email sender

**Files:**
- Create: `src/db/migrations/010_automation_runs.sql`, `src/notify/email.ts`
- Modify: `src/db/repo.ts`, `.env.example`
- Test: `test/automation-runs.test.ts`, `test/email.test.ts`

**Interfaces:**
- Produces:
  - Table `automation_runs(id uuid pk, job text check (job in ('sync_sweep','weekly_digest','discovery')), organization_id uuid null references organizations, started_at timestamptz not null, finished_at timestamptz, status text check (status in ('running','succeeded','failed')), detail jsonb not null default '{}')`, indexed on `(job, started_at desc)`.
  - `startAutomationRun(db, job: AutomationJob, organizationId: string | null, now: Date): Promise<string>`
  - `finishAutomationRun(db, runId: string, status: "succeeded" | "failed", detail: unknown, now: Date): Promise<void>`
  - `lastSucceededRun(db, job: AutomationJob): Promise<{ finishedAt: Date } | null>`
  - `listOrgAdminEmails(db, orgId: string): Promise<string[]>` (admins whose user is not disabled)
  - `listLiveOrganizations(db): Promise<OrganizationRow[]>` (non-fixture)
  - `interface EmailSender { send(msg: { to: string[]; subject: string; text: string }): Promise<{ id: string }> }`
  - `resendSender(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): EmailSender`, posting to `https://api.resend.com/emails`. A non-2xx answer throws `ProviderError("email_failed", …)` carrying the status code and no key.

- [ ] **Step 1: Write the failing tests.** Run log (DB): start then finish a run and read it back with `lastSucceededRun`; a `failed` run is not returned by `lastSucceededRun`. Email (no DB, fake `fetchImpl`): a 200 answer returns the id; a 422 answer throws `email_failed`; the request carries `Authorization: Bearer <key>` and the error message does not contain the key.
- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Before writing `email.ts`, read Resend's current "Send Email" API reference and record the evidence level in `docs/integrations.md`, as CLAUDE.md requires for any vendor. Then implement the migration, repo functions and sender. Add `CRON_SECRET=`, `RESEND_API_KEY=` and `REVOS_DIGEST_FROM=` to `.env.example` with one-line comments.
- [ ] **Step 4:** Run both test files. Expected: PASS. Run `npm run check` (its secret scan must stay clean).
- [ ] **Step 5:** Commit: `Automation run log and Resend email sender (D19)`.

### Task 4: Digest builder

**Files:**
- Create: `src/domain/digest.ts`
- Test: `test/digest.test.ts`

**Interfaces:**
- Consumes: `OrgPulse`, `ShowCard`, `AttentionItem` from `src/domain/pulse.ts`; money formatting from `src/domain/money.ts`.
- Produces: `buildDigest(input: { organizationName: string; pulse: OrgPulse; lastSweepSucceededAt: Date | null; lastSweepFailures: SweepFailure[]; now: Date }): { subject: string; text: string }`, a pure function with no I/O. `SweepFailure = { name: string; kind: string; message: string }`.

Text layout, top to bottom: warning lines (if any); a one-line summary (upcoming shows, paid tickets in the last 7 days, upcoming gross per currency); then one block per show, soonest first, with name, date in venue timezone or "date unknown", paid tickets, gross, last 7 days against the prior 7, and each attention item's title; then "Data as of" with the last sweep time.

- [ ] **Step 1: Write the failing tests** using pulse fixtures built the way `test/pulse.test.ts` builds them:
  - `subject names the organization and the count needing attention`: expect `"Wax Poetic weekly digest: 1 of 2 shows need attention"`.
  - `leads with a warning when the last sweep is older than 36 hours`: first line of `text` starts with `"WARNING: automatic sync has not succeeded since "`.
  - `leads with a warning when there has never been a sweep`: first line is `"WARNING: automatic sync has never run."`.
  - `lists each sweep failure by show name and kind`.
  - `shows unknown gross as "unavailable", never as 0`.
  - `lists a show with no performance date under "date unknown"`.
  - `with no upcoming shows the body says "No upcoming shows."` and still includes the data-as-of line.
- [ ] **Step 2:** Run `npx vitest run test/digest.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `buildDigest`. Plain text only. No figure is computed here that `pulse` does not already carry.
- [ ] **Step 4:** Run the test file. Expected: PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: `Weekly digest text built from the shared pulse (D19)`.

### Task 5: Cron routes

**Files:**
- Modify: `src/server/app.ts` (options, auth exemption near the `/api/health` check, two routes), `api/index.ts` and `src/server/index.ts` (pass the new options from the environment)
- Test: `test/api.test.ts`

**Interfaces:**
- Consumes: `syncAllEvents`, `buildDigest`, `resendSender`, the Task 3 repo functions, and `loadEvents`, `showInput` and `buildOrgPulse` already inside `buildApp`.
- Produces: `AppOptions` gains `cronSecret?: string` and `emailSender?: EmailSender`. Routes:
  - `GET /api/cron/sync` → 200 with the `SweepResult`.
  - `GET /api/cron/digest` → 200 `{ sent: number; skipped: { organizationId: string; reason: string }[] }`.

Both routes skip session auth and require `Authorization: Bearer <cronSecret>`, compared with `crypto.timingSafeEqual`. Answers: 503 `{ error: "not_configured" }` when `cronSecret` is unset (and for digest when `emailSender` is unset); 401 on a wrong or missing bearer; 502 when the digest could not be sent to at least one organization. Each call writes an `automation_runs` row. When a sweep has failures and `emailSender` is set, the sync route also emails that organization's admins one alert listing the failed shows.

- [ ] **Step 1: Write the failing tests** in `test/api.test.ts`, following its existing `app.inject` style with a fake `emailSender` that records messages:
  - `cron routes answer 503 when no cron secret is configured`.
  - `cron routes answer 401 for a wrong bearer and for a session token`.
  - `GET /api/cron/sync runs the sweep and records a succeeded run`.
  - `a sweep with a failing show emails an alert naming the show`.
  - `GET /api/cron/digest sends one email per live organization to its admins only` (viewers get none, fixture organization gets none).
  - `digest answers 502 and records a failed run when the sender throws`.
  - `an organization with no admin email is reported in skipped with reason "no_admin_email"`.
- [ ] **Step 2:** Run `npx vitest run test/api.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the options, the exemption and both routes. In `api/index.ts` and `src/server/index.ts`, build `emailSender` only when both `RESEND_API_KEY` and `REVOS_DIGEST_FROM` are set.
- [ ] **Step 4:** Run `npx vitest run test/api.test.ts`. Expected: PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: `Protected cron routes for sync and weekly digest (D19)`.

### Task 6: Schedule and documentation

**Files:**
- Modify: `vercel.json`, `README.md`, `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/integrations.md`

- [ ] **Step 1:** Read Vercel's current Cron Jobs documentation and confirm: how `CRON_SECRET` is sent, the function duration limit on Daniel's plan, and how often a cron may run on that plan. Record what was read in `docs/DECISIONS.md` under D19.
- [ ] **Step 2:** Add to `vercel.json`:

```json
"crons": [
  { "path": "/api/cron/discovery", "schedule": "17 12 * * *" },
  { "path": "/api/cron/sync", "schedule": "23 11 * * *" },
  { "path": "/api/cron/digest", "schedule": "37 15 * * 1" }
]
```

  Discovery runs at 12:17 UTC, after Bay Shows' own imports at 11:00 and 11:30 UTC. Sync runs 11:23 UTC daily and the digest 15:37 UTC Mondays (early morning Pacific).
- [ ] **Step 3:** Update the docs: README "Scheduled jobs" section with the manual trigger `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/sync`; STATUS with what is built, exactly what was verified, and the live gate as BLOCKED on Task 7; ROADMAP moving background sync out of "Deferred"; integrations with a Resend entry and its evidence level.
- [ ] **Step 4:** Run `npm run check`. Commit: `Schedule AutoRev jobs on Vercel Cron and document them`.

### Task 7: Live gate (owner steps; nothing here is done by an agent without Daniel's explicit go-ahead)

Each line is a decision or action that CLAUDE.md reserves for the owner. Stop and ask before each one.

- [ ] **Database (spend).** Create a Supabase project for RevOS in the "Bay Shows" organization. Confirm the monthly cost with Supabase's cost tool before creating; a third project on the Pro plan is billed. Apply migrations with `npm run db:migrate`.
- [ ] **Discovery first.** Discovery needs the database, `CRON_SECRET`, the two Bay Shows variables and `REVOS_DISCOVERY_ORG_ID`, and nothing from Eventbrite. Create the Wax Poetic organization, trigger `/api/cron/discovery` once and review the first candidate list with Daniel before tuning the capacity ceiling or weights. Mark as `contacted` the acts already pitched in the August search; Daniel supplies those names from his Gmail drafts.
- [ ] **Eventbrite access.** For the 2026-11-28 show: the Eventbrite account that owns the event must supply a private token and its organization id. If that account belongs to the co-producer, she either issues the token herself or adds Daniel to her Eventbrite organization, and both agree that RevOS may read the sales. The event id is the number at the end of the event link.
- [ ] **Secrets.** Daniel sets `DATABASE_URL`, `EVENTBRITE_TOKEN`, `EVENTBRITE_ORGANIZATION_ID`, `EVENTBRITE_EVENT_ID`, `CRON_SECRET`, `RESEND_API_KEY` and `REVOS_DIGEST_FROM` in the Vercel project. The Resend sending domain must be verified first.
- [ ] **Register.** Run `npm run probe:eventbrite`, then `npm run setup:live "Wax Poetic"`, then `npm run user -- create` and `grant … admin` for Daniel.
- [ ] **Deploy.** PM sign-off, portfolio decision on E-004, then Daniel merges to `main`.
- [ ] **Verify.** Trigger `/api/cron/sync` once with curl and confirm a `succeeded` row in `automation_runs` and real figures on the show. Trigger `/api/cron/digest` and confirm the email arrives and its numbers match the desktop app. Record both in `docs/STATUS.md` as live-verified with the date.
- [ ] **Acceptance.** The Monday digest arrives on its own for two consecutive weeks, and a deliberately broken token produces an alert email and a warning in the next digest.

## Known gaps left open on purpose

- Agent contacts and outreach drafts are not built here. Verifying an agent takes web research (artist's own site first, cross-checked against a second source, never third-party booking directories), which RevOS code cannot do. That step is a separate scheduled research task that reads `scouting` candidates and leaves Gmail drafts; it gets its own short plan once the candidate list is live.
- The scoring weights and the 600-capacity ceiling are untested starting values. Ticket counts are not available from Bay Shows' sources, so "will they sell" is inferred, not measured.
- Bay Shows covers 60 miles around San Francisco. Daniel's rule is 100 miles from Sebastopol, so rooms north of that circle are missed until Bay Shows widens its area.

- If Vercel Cron itself stops firing the digest, nothing inside RevOS can report it. The 36-hour warning covers a stalled sync, not a missing digest.
- Wax Poetic's own sales stay on On The Stage. This plan proves AutoRev on Eventbrite; the On The Stage path remains Sprint 1 under D18.
- Vercel functions keep no memory between calls, so the in-memory sign-in throttle and Refresh cooldown noted in DECISIONS D10 are weaker when hosted. The DB-backed throttle stays in Sprint 3.
