import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { recordDecision } from "@/lib/actions";
import { DateOnly, Empty, EvidenceBadge, PageHead, Pill, StatePill, Timestamp } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";

export default async function Decisions({ searchParams }: PageProps) {
  const db = await getDb();
  const [decisions, claims] = await Promise.all([db.list("decisions", { order: "created_at" }), db.list("claims")]);
  const open = decisions.filter((d) => d.state === "open");
  const decided = decisions.filter((d) => d.state !== "open");
  const isOwner = db.role === "owner";

  const card = (d: (typeof decisions)[number]) => (
    <article key={d.id} className="card stack" id={`d-${d.id}`}>
      <div className="row between">
        <h2>{d.question}</h2>
        <StatePill state={d.state} />
      </div>
      <div className="row small">
        <Pill>owner: {d.owner ?? "unassigned"}</Pill>
        <Pill tone={d.deadline_kind === "internal_target" ? "info" : "neutral"}>
          deadline: {d.deadline_kind === "unset" ? "not established" : d.deadline_kind.replace("_", " ")}
        </Pill>
        {d.deadline_date ? <DateOnly value={d.deadline_date} /> : null}
        {d.origin === "agent" ? <Pill tone="info">agent proposed</Pill> : null}
      </div>
      <div>
        <h3>Recommendation</h3>
        {d.recommendation ? <p>{d.recommendation}</p> : <p className="unset">No recommendation recorded.</p>}
      </div>
      <div>
        <h3>Alternatives</h3>
        <ul>
          {(d.alternatives as { label: string; implications?: string; cost_note?: string }[]).map((a, i) => (
            <li key={i}>
              <strong>{a.label}</strong>
              {a.implications ? ` — ${a.implications}` : ""}
              {a.cost_note ? <span className="muted"> (cost: {a.cost_note})</span> : <span className="muted small"> (costs not established)</span>}
            </li>
          ))}
        </ul>
      </div>
      {d.claim_ids?.length ? (
        <div>
          <h3>Related evidence</h3>
          <ul className="list">
            {d.claim_ids.map((cid: string) => {
              const c = claims.find((x) => x.id === cid);
              return c ? (
                <li key={cid}>
                  <EvidenceBadge cls={c.evidence_class} /> <Link href={`/evidence/claims/${cid}`}>{c.statement}</Link>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      ) : null}
      {d.state !== "open" ? (
        <p className="small">
          Decided <Timestamp value={d.decided_at} /> · {d.chosen_alternative ? `chose “${d.chosen_alternative}” · ` : ""}rationale: {d.rationale}
        </p>
      ) : isOwner ? (
        <details className="disclosure">
          <summary>Record a decision</summary>
          <form action={recordDecision}>
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="row_version" value={d.row_version} />
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend className="small muted">Decision</legend>
              <div className="row">
                {["accepted", "rejected", "deferred"].map((s) => (
                  <label key={s} style={{ fontWeight: 400, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name="state" value={s} required style={{ width: 20, minHeight: 20 }} /> {s.replace("ed", "")}
                    {s === "accepted" ? "" : ""}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={`alt-${d.id}`}>Chosen alternative (if accepting)</label>
            <select id={`alt-${d.id}`} name="chosen_alternative" defaultValue="">
              <option value="">—</option>
              {(d.alternatives as { label: string }[]).map((a) => (
                <option key={a.label}>{a.label}</option>
              ))}
            </select>
            <label htmlFor={`rat-${d.id}`}>Rationale (required)</label>
            <textarea id={`rat-${d.id}`} name="rationale" required />
            <p className="small muted">Recording a decision here does not substitute for another organization&apos;s board or signatory authority.</p>
            <button type="submit">Record decision</button>
          </form>
        </details>
      ) : (
        <p className="small muted">Only the project owner can record decisions.</p>
      )}
    </article>
  );

  return (
    <div className="stack">
      <PageHead title="Decisions" sub="Recommendations, alternatives, costs, deadlines and evidence. Undecided items stay visibly open." />
      <Flash searchParams={searchParams} />
      <h2>Open ({open.length})</h2>
      {open.length ? <div className="grid">{open.map(card)}</div> : <Empty>No open decisions.</Empty>}
      <h2>Decided ({decided.length})</h2>
      {decided.length ? <div className="grid">{decided.map(card)}</div> : <Empty>No decisions recorded yet.</Empty>}
    </div>
  );
}
