import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { reviewClaim } from "@/lib/actions";
import { EvidenceBadge, PageHead, Pill, StatePill, Timestamp } from "@/components/ui";
import { Flash } from "@/components/flash";

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const db = await getDb();
  const c = await db.get("claims", id);
  if (!c) notFound();
  const [links, sources, history, related] = await Promise.all([
    db.list("claim_sources", { eq: { claim_id: id } }),
    db.list("sources"),
    db.role === "viewer" ? Promise.resolve([]) : db.list("audit_events", { eq: { record_id: id }, order: "created_at", desc: true, limit: 20 }),
    c.conflict_group ? db.list("claims", { eq: { conflict_group: c.conflict_group } }) : Promise.resolve([]),
  ]);
  const back = `/evidence/claims/${id}`;
  return (
    <div className="stack">
      <p className="small">
        <Link href="/evidence">← Evidence</Link>
      </p>
      <PageHead title={c.code ? `Claim ${c.code}` : "Claim"} />
      <Flash searchParams={searchParams} />
      <section className="card stack">
        <div className="row">
          <EvidenceBadge cls={c.evidence_class} />
          <StatePill state={c.review_state} />
          {c.inherited_unverified ? <Pill tone="warn">inherited — awaiting local retrieval</Pill> : null}
          <Pill>origin: {c.origin}</Pill>
        </div>
        <p style={{ fontSize: "1.1rem" }}>{c.statement}</p>
        {c.limits ? <p className="notice warn">Limits: {c.limits}</p> : null}
        <p className="small muted">
          Verified by: {c.verified_by ?? "—"} {c.verified_at ? <Timestamp value={c.verified_at} /> : null} · Next check: <Timestamp value={c.next_check_at} />
        </p>
      </section>

      <section className="card" aria-labelledby="src-h">
        <h2 id="src-h">Sources and exact locators</h2>
        {links.length ? (
          <ul className="list">
            {links.map((l) => {
              const s = sources.find((x) => x.id === l.source_id);
              return (
                <li key={l.id}>
                  <Link href={`/evidence/sources/${l.source_id}#link-${l.id}`}>
                    {s?.register_code ? `${s.register_code} — ` : ""}
                    {s?.title ?? "Source (not visible to your role)"}
                  </Link>
                  {l.locator ? <span className="muted"> @ {l.locator}</span> : null}
                  {s && s.availability !== "available" ? <div className="small"><StatePill state={s.availability} /> {s.retrieval_task}</div> : null}
                  {l.passage ? <blockquote>{l.passage}</blockquote> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="notice danger">No source link. This claim cannot be accepted until a source is attached.</p>
        )}
      </section>

      {related.length > 1 ? (
        <section className="card">
          <h2>Contradiction group: {c.conflict_group}</h2>
          <ul className="list">
            {related.filter((r) => r.id !== id).map((r) => (
              <li key={r.id}>
                <EvidenceBadge cls={r.evidence_class} /> <Link href={`/evidence/claims/${r.id}`}>{r.statement}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canEdit(db) ? (
        <section className="card" aria-labelledby="rev-h">
          <h2 id="rev-h">Review</h2>
          <p className="small muted">Model confidence and agreement between agents are not verification. “Verify” records you as the reviewer and requires that you opened the source.</p>
          <div className="row">
            {(["accept", "needs_review", "reject"] as const).map((a) => (
              <form key={a} action={reviewClaim}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="row_version" value={c.row_version} />
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="action" value={a} />
                <button type="submit" className={a === "accept" ? "" : "secondary"}>
                  {a.replace("_", " ")}
                </button>
              </form>
            ))}
            {!c.inherited_unverified ? (
              <form action={reviewClaim}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="row_version" value={c.row_version} />
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="action" value="verify" />
                <button type="submit" className="secondary">I opened the source — verify as current</button>
              </form>
            ) : (
              <span className="small muted">Inherited: upload/retrieve the source and record a new claim before verifying.</span>
            )}
          </div>
        </section>
      ) : null}

      {history.length ? (
        <section className="card">
          <h2>Review history</h2>
          <ul className="list small">
            {history.map((h) => (
              <li key={h.id}>
                <Timestamp value={h.created_at} /> · {h.action} by {h.actor ?? h.actor_kind} · v{h.record_version}
                {h.after?.review_state ? ` · review: ${h.after.review_state}` : ""}
                {h.after?.evidence_class ? ` · class: ${h.after.evidence_class}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
