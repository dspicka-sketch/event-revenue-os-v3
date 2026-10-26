import { getDb } from "@/lib/data/context";
import { DateOnly, Empty, PageHead, Pill, StatePill } from "@/components/ui";

export default async function Stakeholders() {
  const db = await getDb();
  const [people, interactions, drafts] = await Promise.all([db.list("stakeholders"), db.list("interactions", { order: "occurred_on", desc: true }), db.list("drafts")]);
  return (
    <div className="stack">
      <PageHead title="Stakeholders" sub="Roles, relationships, consent and privacy, contact history and unsent drafts. Support is never inferred." />
      <div className="notice">
        Acquisition discussions were requested to remain among Daniel, Paul and the owners unless otherwise agreed (claim F12). Confidential terms are excluded from outreach drafts by default.
      </div>
      {people.length ? (
        <div className="grid two">
          {people.map((p) => (
            <article key={p.id} className="card stack">
              <div className="row between">
                <h2>{p.name}</h2>
                {p.synthetic ? <Pill tone="warn">SYNTHETIC</Pill> : null}
              </div>
              <div className="row small">
                <Pill>{p.privacy}</Pill>
                <Pill>consent: {p.consent_state.replace("_", " ")}</Pill>
                <Pill tone={p.support_status === "unknown" ? "neutral" : "info"}>position: {p.support_status.replace("_", " ")}</Pill>
              </div>
              <p className="small">{p.entity} · {p.role}</p>
              <p className="small muted">{p.relationship}</p>
              <h3>History</h3>
              <ul className="list small">
                {interactions.filter((i) => i.stakeholder_id === p.id).map((i) => (
                  <li key={i.id}>
                    <StatePill state={i.status} /> {i.kind} · <DateOnly value={i.occurred_on} /> — {i.summary}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <Empty>No stakeholders recorded. The outreach specialist can propose a private map; names are never published.</Empty>
      )}
      <section className="card">
        <h2>Unsent outreach drafts</h2>
        {drafts.filter((d) => ["email", "inquiry", "listening_guide"].includes(d.kind)).length ? (
          <ul className="list">
            {drafts.filter((d) => ["email", "inquiry", "listening_guide"].includes(d.kind)).map((d) => (
              <li key={d.id}>
                <StatePill state={d.state} /> <strong>{d.title}</strong> → {d.audience ?? "audience unset"}
                <div className="small muted">Approved ≠ sent. This system has no send capability.</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No drafts.</Empty>
        )}
      </section>
    </div>
  );
}
