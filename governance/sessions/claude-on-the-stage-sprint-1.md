# Session: claude/on-the-stage-sprint-1

- **Opened:** 2026-10-28
- **Project manager:** project-manager agent
- **Status:** ACTIVE (E-003 OPEN; the live/real-export half of the sprint is BLOCKED on the owner and On The Stage support, see Risks)
- **Branched from:** `claude/gemini-api-integration-1kmvul` (PR #5, PM signed off, unmerged). This branch therefore carries the Gemini commits; they are not part of this session's scope or review.

## Goal
Start the owner's "Sprint 1 = On The Stage data path". The owner's real ticketing platform is **On The
Stage** (he has a login, no API key). This session (a) records the product-direction change as a
proposed decision D18 and re-sequences the roadmap into a sprint plan to MVP, (b) documents what is and
is not known about On The Stage's data access, with the exact questions for their support team, and
(c) builds the format-agnostic, pure, fully tested core of a report-import path
(`src/providers/onthestage/`: CSV parser + normalizer to the existing `NormalizedOrder` /
`NormalizedLine`), so that the moment a real export or an API answer arrives, the remaining work is
wiring, not modelling.

Research conditions (recorded so nobody later mistakes them for verification): On The Stage's site is
blocked from this environment. Secondary web sources found no public API or developer docs; they
describe promo codes with prefilled links (closest analogue to tracking links), Google Analytics and
Meta Pixel integrations, and third-party listings mentioning Mailchimp and Zapier. None of this is
verified against the vendor's own documentation.

## Scope
- In:
  - `docs/DECISIONS.md`: new **D18** (On The Stage is the owner's ticketing platform; it moves ahead of
    Eventbrite, which stays as the reference adapter and a second-venue option; attribution linkage
    becomes the On The Stage promo code per order if exported; fallback is a report-import connector
    whose data is labeled *imported*, never *verified*, if no API exists). Written as **PROPOSED** until
    E-003 is resolved.
  - `docs/ROADMAP.md`: re-sequence into a sprint plan to MVP with Sprint 1 = On The Stage data path
    (marked proposed pending E-003). `docs/STATUS.md`: next actions for the owner (export a sample
    report, send the three questions to On The Stage support). `docs/integrations.md`: new On The
    Stage section with research conditions, evidence level, and the three support questions.
  - `src/providers/onthestage/`: small CSV parser (RFC 4180 quoting, header row, no dependencies) and a
    normalizer mapping export rows to `NormalizedOrder` / `NormalizedLine` through an explicit,
    documented column mapping. Rules: money parsed from decimal strings to integer minor units with
    currency (no floats), unknown column or blank cell = `null` (never zero), promo code -> `trackingCode`,
    fees itemized only when their columns exist, order-level charges counted once per order, statuses
    mapped to the existing `OrderStatus` / `LineStatus` with unknown source statuses preserved in
    `sourceStatus`. Pure functions, no I/O.
  - Tests for parser and normalizer against an **ASSUMED sample layout**, clearly marked as assumed in
    file names, fixture comments and docs. Fixture rows contain no real patron data.
  - Governance: this charter; E-003 in `governance/escalations.md`.
- Out:
  - Inventing or guessing any On The Stage endpoint, auth scheme or export format as fact; any claim of
    live or verified data.
  - DB schema changes (including a future `import` connection mode: today `connections.mode` is
    `CHECK (mode IN ('live','fixture'))` in `src/db/migrations/001_init.sql`, so an import mode is a
    migration and an escalation, flagged in E-003 part B, not done here).
  - API routes, sync wiring, desktop UI, mobile. These wait for the real export headers or the API
    answer, both of which need the owner.
  - Changes to the Eventbrite or Mailchimp adapters, `src/domain/`, `src/shared/apiTypes.ts`.
  - Review or re-sign-off of the inherited Gemini commits.

## Acceptance criteria
- [ ] E-003 logged OPEN in `governance/escalations.md`; D18 and the roadmap re-sequence are labeled
      PROPOSED until the portfolio-manager resolves it.
- [ ] D18 text states: On The Stage first, Eventbrite retained as reference adapter / second-venue
      option, linkage = promo code per order (only if the export or API provides it), report-import
      fallback is *imported* not *verified*, and the open questions that gate it.
- [ ] `docs/integrations.md` On The Stage section records the research conditions (vendor site
      unreachable, secondary sources only), evidence level "none: no live or vendor-doc evidence", and
      the three support questions: (1) is there an API or data export endpoint, and under what terms and
      auth; (2) does the order/sales export include the promo code (and prefilled-link code) per order
      and per ticket, plus itemized fees, discounts, refunds and tax; (3) what report exports exist
      (names, columns, date basis: sale date vs performance date, timezone, currency).
- [ ] `src/providers/onthestage/` contains only pure modules (no `fetch`, no `pg`, no `fs` in
      non-test code); imports nothing from `src/server/`, `src/db/`, `src/web/`.
- [ ] Column mapping is a single exported, documented table/object; every money column is parsed from a
      decimal string into integer minor units with an explicit currency; a malformed amount yields `null`
      plus a reported issue, never `0` or a float.
- [ ] Missing optional columns yield `null` fields (not zero); fee fields are only populated when the
      corresponding column exists; no proceeds/net figure is derived (no `proceeds_policy` for this
      source yet).
- [ ] Promo code maps to `NormalizedLine.trackingCode` (cleaned the same way as existing codes); rows
      without a code stay `trackingCode: null`.
- [ ] Order-level charges are not multiplied across ticket lines; a test proves one order with several
      lines totals once.
- [ ] Every fixture, test name and doc mention of the layout says ASSUMED; no test or doc calls
      anything live, verified or confirmed.
- [ ] `npm run check` passes (typecheck, tests, build, secret scan). No `mobile/` changes, so mobile
      checks are not required.
- [ ] `docs/STATUS.md` lists the owner's next actions (sample export, support questions) and marks the
      On The Stage live/real-format gate BLOCKED with the exact next step.
- [ ] Diff reviewed by the PM; commits small and separable (docs/governance vs. provider code).

## Risks / dependencies on other sessions
- **Whole sprint depends on external answers.** Whether On The Stage exposes an API, what its exports
  contain, and whether a promo code is present per order are unknown. Until the owner exports a sample
  report or support answers, the normalizer's column mapping is a hypothesis. Mitigation: the mapping is
  one explicit object, the parser is format-agnostic, and everything is labeled ASSUMED.
- **Owner dependency.** The owner must (1) export a sample report from his account and (2) send the
  three questions to On The Stage support. No agent can do either (login belongs to the owner; the
  vendor site is unreachable from here). Status of those items: BLOCKED, owner's step.
- **Attribution rule risk.** CLAUDE.md allows one primary attribution per order via a supported order
  linkage. A promo code is only a valid linkage if it is recorded on the order by the vendor; a code
  the buyer typed from a printed flyer is still a legitimate order linkage, but prefilled-link vs.
  typed cannot be distinguished unless the export says so. D18 must state this limitation.
- **"Imported" is a new data-trust label.** Fixture and live exist today; imported data is neither.
  Introducing it properly needs a schema change (connection mode) and client labeling in both
  clients: flagged in E-003 part B, deferred.
- **Cross-session / shared.** D18 re-orders milestones and demotes the Eventbrite live gate (M1) from
  first priority; `docs/ROADMAP.md`, `docs/DECISIONS.md` are shared documents read by every session.
  Escalated (E-003 part A). No other active branch edits these docs today per `governance/portfolio.md`.
- **Branch lineage.** Built on the unmerged Gemini branch (PR #5). If PR #5 is rebased or changed before
  merge, this branch must be rebased too. If PR #5 is merged first, this branch's PR will show only its
  own commits. Decision on merge order belongs to the portfolio-manager / owner.
- **Scope creep risk.** Temptation to add an `import` route or UI once the parser exists. Not in this
  session; any such request goes back through this charter.

## Tasks
1. [ ] Governance: this charter; append E-003 (OPEN) to `governance/escalations.md`. (PM, this step)
2. [ ] Docs: D18 (PROPOSED), ROADMAP sprint plan to MVP (PROPOSED), integrations.md On The Stage section
       with research conditions and three support questions, STATUS next actions + BLOCKED gate.
3. [ ] `src/providers/onthestage/csv.ts`: dependency-free RFC 4180 parser (quotes, escaped quotes,
       CRLF, header row, ragged-row reporting). Tests.
4. [ ] `src/providers/onthestage/mapping.ts`: explicit, documented column mapping (ASSUMED layout),
       with required vs optional columns, money columns + currency column, status vocab, promo-code
       column, date columns with their basis (sale date) and timezone assumption.
5. [ ] `src/providers/onthestage/normalize.ts`: rows -> `NormalizedOrder[]` + `NormalizedLine[]` +
       issues list. Decimal-string -> minor units (no floats), null for unknown, fees only when columns
       exist, promo code -> `trackingCode`, order-level charges once per order, UTC conversion from the
       documented timezone assumption.
6. [ ] `src/providers/onthestage/fixtures.ts` (or test-local fixture): ASSUMED sample with synthetic,
       non-personal rows (no names, emails, phones, barcodes).
7. [ ] Tests covering: parser edge cases; happy path; missing optional columns -> null; malformed
       money -> null + issue; multi-line order counted once; unknown status preserved; promo code
       cleaning; no float arithmetic (minor units only); currency carried, never mixed.
8. [ ] `npm run check`; PM diff review; update this charter (AC checkboxes, decision log); commits:
       governance -> docs -> provider code -> tests (or docs+governance together).
9. [ ] Await E-003 resolution before removing the PROPOSED label from D18/ROADMAP; await owner's sample
       export / support answer before any route, schema or UI work (new charter or charter amendment).

## Decision Log
| Date | Decision | Subject | Rationale |
|------|----------|---------|-----------|
| 2026-10-28 | ESCALATED | E-003 part A: D18 product-direction change (On The Stage ahead of Eventbrite; Eventbrite demoted to reference adapter / second venue; attribution linkage becomes the promo code per order; report-import fallback labeled imported, never verified) and the resulting ROADMAP re-sequence into a sprint plan to MVP | Re-orders milestones and demotes the M1 Eventbrite live gate; touches shared docs every session reads; architectural (a second ticketing source and a new data-trust class). Outside PM authority |
| 2026-10-28 | ESCALATED | E-003 part B (flag only, no work this session): a future `import` connection mode requires a schema migration (`connections.mode` CHECK in `001_init.sql`), new status semantics ("imported" is neither live/verified nor fixture) and labeling in both clients | Schema/data-model change is cross-session; raised now so the portfolio-manager can shape it before anyone builds it |
| 2026-10-28 | APPROVED | Build the pure, format-agnostic core under `src/providers/onthestage/` (CSV parser, documented ASSUMED column mapping, normalizer to existing `NormalizedOrder`/`NormalizedLine`, tests), in parallel with E-003 | New folder only; no schema, route, UI, shared-type or domain change; follows CLAUDE.md money/counting/data-trust rules; isolated and cheap to discard if E-003 is rejected. Within PM authority |
| 2026-10-28 | APPROVED | Draft D18 and the ROADMAP sprint plan now, labeled PROPOSED pending E-003; add the On The Stage section to integrations.md and the owner next actions to STATUS | CLAUDE.md requires recording a proposed deviation in DECISIONS before a large change; the integrations/STATUS entries document research conditions and BLOCKED items, which is required regardless of the portfolio outcome |
| 2026-10-28 | REJECTED | Any API route, sync wiring, `import` connection mode, desktop or mobile UI for On The Stage in this session | Depends on real export headers or the vendor's API answer, both owner-gated; building against an assumed layout beyond the pure core would create code that claims more than is known |
| 2026-10-28 | RESOLVED by portfolio-manager: CONDITIONAL | E-003 resolution: Part A APPROVED with conditions A1–A6 (D18 and ROADMAP re-sequence adopted; PROPOSED label becomes "Adopted 2026-10-28 (E-003)"; Eventbrite retained as reference adapter; promo code is a supported linkage only when the vendor records it on the order; CLAUDE.md attribution sentence amended only after a real export/API answer confirms the code; Zapier or any intermediary is a fresh escalation). Part B PRE-APPROVED IN PRINCIPLE with conditions B1–B8, subject to a migration review submitted as amendment E-003-B when built (not a fresh escalation; waits for real export headers or the API answer). Merge order: PR #5 first, then this branch; do not rebase PR #5. AWAITING OWNER: On The Stage's answers, a de-identified sample export, any vendor terms/paid tier, merge to `main` | Full text and rationale in `governance/portfolio.md` Decision Log (2026-10-28) and the E-003 row in `governance/escalations.md`. PM next steps: relabel D18/ROADMAP per A1–A2, keep integrations.md evidence level "none" per A5, record the owner asks in STATUS, finish the pure provider core within the charter's existing scope |
