import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { addClaim, addManualSource } from "@/lib/actions";
import { EVIDENCE_CLASSES, EVIDENCE_LABELS } from "@/lib/domain/evidence";
import { DateOnly, EvidenceBadge, PageHead, Pill, StatePill } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";

export default async function Evidence({ searchParams }: PageProps) {
  const db = await getDb();
  const [sources, versions, claims, links] = await Promise.all([
    db.list("sources", { order: "register_code" }),
    db.list("source_versions"),
    db.list("claims", { order: "code" }),
    db.list("claim_sources"),
  ]);
  const editable = canEdit(db);
  const groups = new Map<string, typeof claims>();
  for (const c of claims) if (c.conflict_group) groups.set(c.conflict_group, [...(groups.get(c.conflict_group) ?? []), c]);
  const srcById = new Map(sources.map((s) => [s.id, s]));

  return (
    <div className="stack">
      <PageHead title="Evidence" sub="Sources, extraction status, claims with exact locators, freshness, and contradiction groups." />
      <Flash searchParams={searchParams} />

      {editable ? (
        <div className="grid two">
          <section className="card" aria-labelledby="upload-h">
            <h2 id="upload-h">Upload a document</h2>
            <p className="small muted">Stored privately. PDF, text, Markdown, HTML, email (.eml), PNG/JPEG (OCR not configured), DOCX. Max 25 MB. Identical files are deduplicated.</p>
            <form action="/api/sources/upload" method="post" encType="multipart/form-data">
              <label htmlFor="file">File</label>
              <input id="file" name="file" type="file" required accept=".pdf,.txt,.md,.html,.eml,.png,.jpg,.jpeg,.docx" />
              <div className="form-row">
                <div>
                  <label htmlFor="up-title">Title</label>
                  <input id="up-title" name="title" />
                </div>
                <div>
                  <label htmlFor="up-date">Source date (as stated in the document)</label>
                  <input id="up-date" name="source_date" type="date" />
                </div>
              </div>
              <label htmlFor="up-class">Access classification</label>
              <select id="up-class" name="access_classification" defaultValue="confidential">
                <option value="confidential">Confidential (members)</option>
                <option value="restricted">Restricted (owner only)</option>
                <option value="internal">Internal</option>
              </select>
              <label htmlFor="up-existing">New version of an existing source (optional)</label>
              <select id="up-existing" name="source_id" defaultValue="">
                <option value="">— new source —</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.register_code ? `${s.register_code} ` : ""}
                    {s.title}
                  </option>
                ))}
              </select>
              <p style={{ marginTop: 12 }}>
                <button type="submit">Upload</button>
              </p>
            </form>
          </section>
          <section className="card" aria-labelledby="manual-h">
            <h2 id="manual-h">Record a source reference</h2>
            <p className="small muted">For a document or page you have not uploaded yet. It is marked “pending retrieval”.</p>
            <form action={addManualSource}>
              <label htmlFor="m-title">Title</label>
              <input id="m-title" name="title" required />
              <div className="form-row">
                <div>
                  <label htmlFor="m-kind">Kind</label>
                  <select id="m-kind" name="kind" defaultValue="web_page">
                    {["document", "email", "web_page", "statute", "dataset", "other"].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="m-date">Source date</label>
                  <input id="m-date" name="source_date" type="date" />
                </div>
              </div>
              <label htmlFor="m-url">URL (https only)</label>
              <input id="m-url" name="original_url" type="url" />
              <label htmlFor="m-ac">Access classification</label>
              <select id="m-ac" name="access_classification" defaultValue="confidential">
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted (owner only)</option>
              </select>
              <p style={{ marginTop: 12 }}>
                <button type="submit" className="secondary">
                  Record source
                </button>
              </p>
            </form>
          </section>
        </div>
      ) : null}

      <section className="card" aria-labelledby="sources-h">
        <h2 id="sources-h">Source register ({sources.length})</h2>
        <div className="scroll-x">
          <table className="data cards">
            <thead>
              <tr>
                <th>ID</th>
                <th>Source</th>
                <th>Source date</th>
                <th>Availability</th>
                <th>Extraction</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const v = versions.filter((x) => x.source_id === s.id).sort((a, b) => b.version_no - a.version_no)[0];
                return (
                  <tr key={s.id}>
                    <td data-label="ID">{s.register_code ?? "—"}</td>
                    <td data-label="Source">
                      <Link href={`/evidence/sources/${s.id}`}>{s.title}</Link>
                      <div className="row small">
                        {s.inherited ? <Pill tone="warn">inherited summary</Pill> : null}
                        <Pill>{s.access_classification}</Pill>
                      </div>
                    </td>
                    <td data-label="Source date">
                      <DateOnly value={s.source_date} />
                    </td>
                    <td data-label="Availability">
                      <StatePill state={s.availability} />
                    </td>
                    <td data-label="Extraction">{v ? <StatePill state={v.extraction_state} /> : <span className="unset">no file</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {groups.size ? (
        <section className="card" aria-labelledby="conf-h">
          <h2 id="conf-h">Contradiction groups</h2>
          {[...groups].map(([g, cs]) => (
            <div key={g} id={`group-${g}`} style={{ marginBottom: 12 }}>
              <h3>
                {g} <span className="muted small">— dated observations, none selected as current</span>
              </h3>
              <ul className="list">
                {cs.map((c) => (
                  <li key={c.id}>
                    <div className="row">
                      <EvidenceBadge cls={c.evidence_class} />
                      <StatePill state={c.review_state} />
                    </div>
                    <Link href={`/evidence/claims/${c.id}`}>{c.statement}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card" aria-labelledby="claims-h">
        <h2 id="claims-h">Claims ({claims.length})</h2>
        <ul className="list">
          {claims.map((c) => {
            const cl = links.filter((l) => l.claim_id === c.id);
            return (
              <li key={c.id}>
                <div className="row">
                  {c.code ? <Pill>{c.code}</Pill> : null}
                  <EvidenceBadge cls={c.evidence_class} />
                  <StatePill state={c.review_state} />
                  {c.inherited_unverified ? <Pill tone="warn">awaiting local retrieval</Pill> : null}
                  {c.origin === "agent" ? <Pill tone="info">agent proposed</Pill> : null}
                </div>
                <Link href={`/evidence/claims/${c.id}`}>{c.statement}</Link>
                {c.limits ? <div className="small muted">Limits: {c.limits}</div> : null}
                <div className="small">
                  {cl.length
                    ? cl.map((l) => (
                        <span key={l.id} style={{ marginRight: 10 }}>
                          <Link href={`/evidence/sources/${l.source_id}`}>{srcById.get(l.source_id)?.register_code ?? "source"}</Link>
                          {l.locator ? ` @ ${l.locator}` : ""}
                        </span>
                      ))
                    : <span className="unset">no source link</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {editable ? (
        <section className="card" aria-labelledby="addclaim-h">
          <h2 id="addclaim-h">Record a claim</h2>
          <form action={addClaim}>
            <label htmlFor="c-st">Statement</label>
            <textarea id="c-st" name="statement" required />
            <div className="form-row">
              <div>
                <label htmlFor="c-ec">Evidence class</label>
                <select id="c-ec" name="evidence_class" defaultValue="unknown">
                  {EVIDENCE_CLASSES.filter((c) => c !== "verified_current").map((c) => (
                    <option key={c} value={c}>
                      {EVIDENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="c-src">Source</label>
                <select id="c-src" name="source_id" defaultValue="">
                  <option value="">— none —</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.register_code ?? ""} {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="c-loc">Locator (page/section)</label>
                <input id="c-loc" name="locator" />
              </div>
            </div>
            <label htmlFor="c-pass">Supporting passage (only what is necessary)</label>
            <textarea id="c-pass" name="passage" maxLength={1200} />
            <label htmlFor="c-lim">Limits — what this does not establish</label>
            <input id="c-lim" name="limits" />
            <p style={{ marginTop: 12 }}>
              <button type="submit">Record claim</button>
            </p>
          </form>
        </section>
      ) : null}
    </div>
  );
}
