import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { UNRESOLVED_DECISIONS } from "@/lib/domain/roles";
import { PageHead, StatePill, Unset } from "@/components/ui";

const DIMENSIONS: [string, string][] = [
  ["owner_entity", "Owner entity"],
  ["protection_duration", "Protection duration"],
  ["protected_uses", "Protected uses and access"],
  ["board_design", "Board design and selection"],
  ["enforcement", "Independent enforcement"],
  ["financing", "Financing"],
];

export default async function Governance() {
  const db = await getDb();
  const options = await db.list("governance_options");
  return (
    <div className="stack">
      <PageHead title="Governance" sub="Compare owner entities, protection durations, board designs and enforcement. Nothing is selected without a recorded decision." />
      <div className="notice warn">
        General counsel output in this system is issue spotting for qualified counsel — not legal advice, approval, or representation.
      </div>
      <div className="grid two">
        {DIMENSIONS.map(([key, label]) => {
          const opts = options.filter((o) => o.dimension === key);
          const selected = opts.find((o) => o.state === "selected");
          return (
            <section key={key} className="card">
              <h2>{label}</h2>
              <p>
                Selected: {selected ? <strong>{selected.label}</strong> : <Unset label="Unset — undecided" />}
              </p>
              {opts.length ? (
                <ul className="list">
                  {opts.map((o) => (
                    <li key={o.id}>
                      <div className="row">
                        <strong>{o.label}</strong>
                        <StatePill state={o.state} />
                      </div>
                      {o.description ? <p className="small">{o.description}</p> : null}
                      {o.tradeoffs ? <p className="small muted">Tradeoffs: {o.tradeoffs}</p> : <p className="small unset">Tradeoffs not yet analyzed</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="unset">No options recorded yet.</p>
              )}
            </section>
          );
        })}
      </div>
      <section className="card">
        <h2>Unresolved decisions</h2>
        <ul>
          {UNRESOLVED_DECISIONS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <Link href="/decisions">Go to decisions</Link>
      </section>
    </div>
  );
}
