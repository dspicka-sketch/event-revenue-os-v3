import { getDb } from "@/lib/data/context";
import { computeFundingPosition, operatingView, sourcesAndUses, type FinancialLine } from "@/lib/domain/funding";
import { DateOnly, Empty, Money, PageHead, Pill, StatePill, Unset } from "@/components/ui";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export default async function Funding() {
  const db = await getDb();
  const [opps, commitments, receipts, scenarios, lines] = await Promise.all([
    db.list("opportunities"),
    db.list("funding_commitments"),
    db.list("receipts"),
    db.list("financial_scenarios"),
    db.list("financial_lines"),
  ]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const scenario = scenarios.find((s) => s.status === "base") ?? scenarios[0];
  const pos = computeFundingPosition(
    commitments.map((c) => ({ id: c.id, funder: c.funder, stage: c.stage, amount_cents: n(c.amount_cents), restricted_to: c.restricted_to, expires_on: c.expires_on ? String(c.expires_on).slice(0, 10) : null })),
    receipts.map((r) => ({ id: r.id, commitment_id: r.commitment_id, amount_cents: Number(r.amount_cents), received_on: String(r.received_on).slice(0, 10) })),
    scenario ? n(scenario.capital_target_cents) : null,
    today,
  );
  const scLines: FinancialLine[] = lines
    .filter((l) => l.scenario_id === scenario?.id)
    .map((l) => ({ ...l, amount_cents: n(l.amount_cents) }) as FinancialLine);
  const su = sourcesAndUses(scLines);
  const combined = operatingView(scLines, "combined", "annual");
  const anySynthetic = [...commitments, ...receipts, ...opps].some((x) => x.synthetic);

  return (
    <div className="stack">
      <PageHead title="Funding" sub="Prospects, applications, conditional pledges, binding commitments and receipts — shown separately. Totals are computed by code." />
      {anySynthetic ? <div className="notice warn">Records labeled SYNTHETIC are demo fixtures, not real funders or amounts.</div> : null}

      <div className="grid three">
        <section className="card"><h2>Cash received</h2><p style={{ fontSize: "1.4rem" }}><Money cents={pos.cashReceivedCents} /></p></section>
        <section className="card"><h2>Remaining binding commitments</h2><p style={{ fontSize: "1.4rem" }}><Money cents={pos.remainingCommittedCents} /></p>{pos.securedIncomplete ? <p className="small notice warn">A binding commitment has no established amount; secured total is a floor.</p> : null}</section>
        <section className="card"><h2>Gap to capital target</h2><p style={{ fontSize: "1.4rem" }}>{pos.gapCents === null ? <Unset label="Unknown" /> : <Money cents={pos.gapCents} />}</p><p className="small muted">Target: <Money cents={pos.capitalTargetCents} /></p></section>
      </div>
      <section className="card">
        <h2>Not counted as secured</h2>
        <p>Conditional pledges: <Money cents={pos.conditionalPledgesCents} />{pos.conditionalIncomplete ? " (+ pledges of unknown amount)" : ""} · Applications: {pos.applicationsCount} · Prospects: {pos.prospectsCount}</p>
        {pos.expiredCommitmentIds.length ? <p className="notice warn">{pos.expiredCommitmentIds.length} commitment(s) expired and are excluded.</p> : null}
        <h3>By restriction</h3>
        <ul>
          {Object.entries(pos.byRestriction).map(([k, v]) => (
            <li key={k}>{k.replaceAll("_", " ")}: cash <Money cents={v.cashCents} /> · remaining committed <Money cents={v.remainingCommittedCents} /></li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Commitments and pipeline</h2>
        {commitments.length ? (
          <table className="data cards">
            <thead><tr><th>Funder</th><th>Stage</th><th>Amount</th><th>Restriction</th><th>Expires</th><th>Received</th></tr></thead>
            <tbody>
              {commitments.map((c) => (
                <tr key={c.id}>
                  <td data-label="Funder">{c.funder} {c.synthetic ? <Pill tone="warn">SYNTHETIC</Pill> : null}</td>
                  <td data-label="Stage"><StatePill state={c.stage} /></td>
                  <td data-label="Amount"><Money cents={c.amount_cents} /></td>
                  <td data-label="Restriction">{c.restriction ?? <Unset />}</td>
                  <td data-label="Expires"><DateOnly value={c.expires_on} /></td>
                  <td data-label="Received"><Money cents={receipts.filter((r) => r.commitment_id === c.id).reduce((s, r) => s + Number(r.amount_cents), 0) || null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No funding records. Applications are never cash.</Empty>}
      </section>

      <section className="card">
        <h2>Opportunities</h2>
        {opps.length ? (
          <ul className="list">
            {opps.map((o) => (
              <li key={o.id}>
                <div className="row"><strong>{o.name}</strong><StatePill state={o.stage} />{o.synthetic ? <Pill tone="warn">SYNTHETIC</Pill> : null}</div>
                <div className="small">Eligibility evidence: {o.eligibility_claim_id ? "linked" : <Unset />} · Deadline: {o.deadline_kind === "unset" ? <Unset label="Unset" /> : <DateOnly value={o.deadline_date} tz={o.deadline_timezone} />}</div>
              </li>
            ))}
          </ul>
        ) : <Empty>No opportunities qualified yet.</Empty>}
      </section>

      {scenario ? (
        <section className="card">
          <h2>Sources and uses — {scenario.name} <StatePill state={scenario.status} /></h2>
          <p className="small muted">{scenario.notes}</p>
          <div className="grid two">
            <div>
              <h3>Uses</h3>
              <p>Total: {su.uses.totalCents === null ? <><Unset /> (known <Money cents={su.uses.knownCents} />; missing: {su.uses.unknownLines.join(", ")})</> : <Money cents={su.uses.totalCents} />}</p>
            </div>
            <div>
              <h3>Sources</h3>
              <p>Total: {su.sources.totalCents === null ? <Unset /> : <Money cents={su.sources.totalCents} />}</p>
            </div>
          </div>
          <p>Gap: {su.gapCents === null ? <Unset label="Unknown" /> : <Money cents={su.gapCents} />}</p>
          {su.rejectedExcluded.length ? <p className="small">Excluded (rejected assumptions): {su.rejectedExcluded.join("; ")}</p> : null}
          {su.proposedExcluded.length ? <p className="small">Excluded (proposed, not accepted): {su.proposedExcluded.join("; ")}</p> : null}
          <h3>Combined annual operating view</h3>
          <p>
            Income <Money cents={combined.income.totalCents} /> · Expense <Money cents={combined.expense.totalCents} /> · Net <Money cents={combined.netCents} />
          </p>
          {combined.eliminatedTransfers.length ? <p className="small muted">Eliminated internal transfers (not double counted): {combined.eliminatedTransfers.join(", ")}. Property rent is operating income, not a donation.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
