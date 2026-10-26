import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { DateOnly, Money, PageHead, Pill, StatePill } from "@/components/ui";

const KIND_LABEL: Record<string, string> = {
  broker_list: "Broker list price (historical)",
  outbound_proposal: "Outbound proposal (not accepted)",
  user_reported: "User-reported account",
  appraisal: "Appraisal",
  agreed: "Agreed price",
};

export default async function Property() {
  const db = await getDb();
  const [prices, checks, claims] = await Promise.all([
    db.list("price_observations", { order: "observed_on" }),
    db.list("property_checks", { order: "area" }),
    db.list("claims"),
  ]);
  const agreed = prices.find((p) => p.kind === "agreed");
  return (
    <div className="stack">
      <PageHead title="Property — 104 N. Main Street, Sebastopol" sub="APN lead, ownership verification, leases, title and condition. Prices are dated observations, never one unlabeled number." />
      <section className="card">
        <h2>Current agreed price</h2>
        {agreed ? <Money cents={agreed.amount_cents} /> : <p className="unset" style={{ fontSize: "1.2rem" }}>Unknown — no agreement established</p>}
      </section>
      <section className="card">
        <h2>Price observations</h2>
        <table className="data cards">
          <thead>
            <tr><th>Date</th><th>Observation</th><th>Amount</th><th>Status</th><th>Evidence</th></tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id}>
                <td data-label="Date">{p.observed_on ? <DateOnly value={p.observed_on} /> : <span className="unset">{p.observed_on_note ?? "undated"}</span>}</td>
                <td data-label="Observation">{KIND_LABEL[p.kind] ?? p.kind}</td>
                <td data-label="Amount"><Money cents={p.amount_cents} comparator={p.comparator} /></td>
                <td data-label="Status" className="small">{p.status_note}</td>
                <td data-label="Evidence">{p.claim_id ? <Link href={`/evidence/claims/${p.claim_id}`}>{claims.find((c) => c.id === p.claim_id)?.code ?? "claim"}</Link> : <span className="unset">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Diligence checklist</h2>
        <table className="data cards">
          <thead>
            <tr><th>Area</th><th>Item</th><th>Status</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td data-label="Area"><Pill>{c.area}</Pill></td>
                <td data-label="Item">{c.item}</td>
                <td data-label="Status"><StatePill state={c.status} /></td>
                <td data-label="Notes" className="small">
                  {c.note}
                  {(c.claim_ids ?? []).map((id: string) => (
                    <span key={id}> · <Link href={`/evidence/claims/${id}`}>{claims.find((x) => x.id === id)?.code ?? "claim"}</Link></span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
