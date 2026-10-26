import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { decideApproval, requestApproval, reviewProposal, saveDraft } from "@/lib/actions";
import { Empty, EvidenceBadge, PageHead, Pill, StatePill, Timestamp, roleLabel } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";

export default async function Review({ searchParams }: PageProps) {
  const db = await getDb();
  const [proposals, drafts, approvals] = await Promise.all([
    db.list("proposals", { eq: { state: "pending" }, order: "created_at" }),
    db.list("drafts", { order: "updated_at", desc: true }),
    db.list("approvals", { order: "created_at", desc: true }),
  ]);
  const editable = canEdit(db);
  const isOwner = db.role === "owner";

  return (
    <div className="stack">
      <PageHead title="Review queue" sub="Agent proposals become records only after a person reviews them. Drafts are never sent by this system." />
      <Flash searchParams={searchParams} />

      <section className="card">
        <h2>Pending proposals ({proposals.length})</h2>
        {proposals.length ? (
          <ul className="list">
            {proposals.map((p) => {
              const m = p.mutation as Record<string, any>;
              return (
                <li key={p.id}>
                  <div className="row">
                    <Pill>{p.target_table.replace(/s$/, "")}</Pill>
                    <Pill tone="info">{roleLabel(p.role)}</Pill>
                    {m.evidence_class ? <EvidenceBadge cls={m.evidence_class} /> : null}
                    {m.origin === "correction" ? <Pill tone="danger">correction</Pill> : null}
                    {p.run_id ? <Link className="small" href={`/runs/${p.run_id}`}>run</Link> : null}
                  </div>
                  <strong>{m.statement ?? m.title ?? m.question}</strong>
                  {m.description ? <pre className="json">{m.description}</pre> : null}
                  {m.body ? <pre className="json">{m.body}</pre> : null}
                  {m.source_refs?.length ? <div className="small muted">Cites: {m.source_refs.map((r: any) => `${r.source_id.slice(0, 8)}${r.locator ? `@${r.locator}` : ""}`).join(", ")}</div> : null}
                  {editable ? (
                    <div className="row">
                      <form action={reviewProposal}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="action" value="apply" /><button type="submit">Apply for review</button></form>
                      <form action={reviewProposal}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="action" value="reject" /><button type="submit" className="secondary">Reject</button></form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nothing waiting for review.</Empty>
        )}
      </section>

      <section className="card">
        <h2>Drafts and approvals</h2>
        <p className="small muted">An approval binds the actor, action, recipient, exact content hash, record version, scope and expiry. Editing content invalidates it. An approved draft is not proof of delivery.</p>
        {drafts.length ? (
          <ul className="list">
            {drafts.map((d) => {
              const aps = approvals.filter((a) => a.record_id === d.id);
              return (
                <li key={d.id}>
                  <div className="row">
                    <StatePill state={d.state} />
                    <Pill>{d.kind}</Pill>
                    {d.contains_confidential ? <Pill tone="danger">contains confidential terms</Pill> : null}
                    <span className="small muted">hash {String(d.content_hash).slice(0, 10)}…</span>
                  </div>
                  <strong>{d.title}</strong> → {d.audience ?? <span className="unset">audience unset</span>}
                  <pre className="json">{d.body}</pre>
                  {aps.map((a) => (
                    <div key={a.id} className="small row">
                      <StatePill state={a.state} /> {a.action_kind.replace("_", " ")} → {a.target} · scope: {a.scope}
                      {a.requested_by_role ? ` · requested by ${roleLabel(a.requested_by_role)} agent` : ""}
                      {a.approved_at ? <> · approved <Timestamp value={a.approved_at} />, expires <Timestamp value={a.expires_at} /></> : null}
                      {a.note ? ` · ${a.note}` : ""}
                      {isOwner && a.state === "requested" ? (
                        <>
                          <form action={decideApproval}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="approve" /><button type="submit">Approve exact content</button></form>
                          <form action={decideApproval}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="reject" /><button type="submit" className="secondary">Reject</button></form>
                        </>
                      ) : null}
                    </div>
                  ))}
                  {editable ? (
                    <details className="disclosure">
                      <summary>Edit or request approval</summary>
                      <DraftForm d={d} />
                      <form action={requestApproval} className="form-row" style={{ marginTop: 12 }}>
                        <input type="hidden" name="draft_id" value={d.id} />
                        <div>
                          <label htmlFor={`ak-${d.id}`}>Action</label>
                          <select id={`ak-${d.id}`} name="action_kind" defaultValue="external_send">
                            {["external_send", "invitation", "publication", "grant_submission", "binding_representation"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`tg-${d.id}`}>Target / recipient</label>
                          <input id={`tg-${d.id}`} name="target" defaultValue={d.audience ?? ""} />
                        </div>
                        <div style={{ alignSelf: "end" }}><button type="submit" className="secondary">Request approval</button></div>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No drafts yet.</Empty>
        )}
        {editable ? (
          <details className="disclosure">
            <summary>New draft</summary>
            <DraftForm />
          </details>
        ) : null}
      </section>
    </div>
  );
}

function DraftForm({ d }: { d?: Record<string, any> }) {
  const p = d ? `d-${d.id}` : "d-new";
  return (
    <form action={saveDraft} className="stack">
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      {d ? <input type="hidden" name="row_version" value={d.row_version} /> : null}
      <div className="form-row">
        <div><label htmlFor={`${p}-t`}>Title</label><input id={`${p}-t`} name="title" defaultValue={d?.title} required /></div>
        <div><label htmlFor={`${p}-a`}>Audience</label><input id={`${p}-a`} name="audience" defaultValue={d?.audience ?? ""} /></div>
        <div>
          <label htmlFor={`${p}-k`}>Kind</label>
          <select id={`${p}-k`} name="kind" defaultValue={d?.kind ?? "email"}>{["email", "inquiry", "memo", "listening_guide", "other"].map((k) => <option key={k}>{k}</option>)}</select>
        </div>
      </div>
      <div><label htmlFor={`${p}-b`}>Body</label><textarea id={`${p}-b`} name="body" defaultValue={d?.body} required /></div>
      <label style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" name="contains_confidential" defaultChecked={d?.contains_confidential} style={{ width: 20, minHeight: 20 }} /> Contains confidential acquisition terms (hidden from viewers)
      </label>
      <div><button type="submit">Save draft</button></div>
    </form>
  );
}
