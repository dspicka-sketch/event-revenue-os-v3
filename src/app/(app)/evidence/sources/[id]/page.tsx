import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { detectEmbeddedInstructions } from "@/lib/domain/evidence";
import { DateOnly, EvidenceBadge, PageHead, Pill, StatePill, Timestamp } from "@/components/ui";
import { Flash } from "@/components/flash";

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const db = await getDb();
  const s = await db.get("sources", id);
  if (!s) notFound();
  const [versions, links, claims] = await Promise.all([
    db.list("source_versions", { eq: { source_id: id }, order: "version_no", desc: true }),
    db.list("claim_sources", { eq: { source_id: id } }),
    db.list("claims"),
  ]);
  const latest = versions[0];
  const flags = latest?.extracted_text ? detectEmbeddedInstructions(latest.extracted_text) : [];

  return (
    <div className="stack">
      <p className="small">
        <Link href="/evidence">← Evidence</Link>
      </p>
      <PageHead title={`${s.register_code ? `${s.register_code} · ` : ""}${s.title}`} />
      <Flash searchParams={searchParams} />
      <section className="card">
        <dl className="grid three">
          <div><dt className="muted small">Kind</dt><dd>{s.kind}</dd></div>
          <div><dt className="muted small">Source date</dt><dd><DateOnly value={s.source_date} /></dd></div>
          <div><dt className="muted small">Retrieved</dt><dd><Timestamp value={s.retrieved_at} /> <span className="small muted">{s.retrieved_by}</span></dd></div>
          <div><dt className="muted small">Availability</dt><dd><StatePill state={s.availability} /></dd></div>
          <div><dt className="muted small">Access</dt><dd><Pill>{s.access_classification}</Pill></dd></div>
          <div><dt className="muted small">Provenance</dt><dd>{s.inherited ? <Pill tone="warn">inherited — not independently opened</Pill> : <Pill tone="ok">retrieved into project</Pill>}</dd></div>
        </dl>
        {s.original_url ? (
          <p className="small">
            Original reference (may require the owner&apos;s signed-in account): <span style={{ wordBreak: "break-all" }}>{s.original_url}</span>
          </p>
        ) : null}
        {s.provider_id ? <p className="small muted">Provider id (a retrieval lead, not proof of access): {s.provider_id}</p> : null}
        {s.coverage_note ? <p className="small">Coverage: {s.coverage_note}</p> : null}
        {s.availability !== "available" ? (
          <p className="notice warn">
            Unavailable in this project. Retrieval task: {s.retrieval_task ?? "upload the original through Evidence → Upload."}
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="v-h">
        <h2 id="v-h">Versions and extraction</h2>
        {versions.length ? (
          <ul className="list">
            {versions.map((v) => (
              <li key={v.id}>
                <div className="row">
                  <strong>v{v.version_no}</strong>
                  <StatePill state={v.extraction_state} />
                  <span className="small muted">
                    {v.original_filename} · {v.mime_type} · {Math.round(v.size_bytes / 1024)} KB · sha256 {String(v.checksum_sha256).slice(0, 12)}…
                  </span>
                </div>
                {v.extraction_error ? <p className="small notice danger">Extraction error: {v.extraction_error} (attempts: {v.extraction_attempts})</p> : null}
                {v.ocr_limitations ? <p className="small muted">OCR limitations: {v.ocr_limitations}</p> : null}
                {canEdit(db) && v.extraction_state === "failed" ? (
                  <form action="/api/sources/extract" method="post">
                    <input type="hidden" name="version_id" value={v.id} />
                    <button type="submit" className="secondary">
                      Retry extraction
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="unset">No file uploaded for this source.</p>
        )}
      </section>

      {latest?.extracted_text ? (
        <section className="card" aria-labelledby="prev-h">
          <h2 id="prev-h">Extracted text preview</h2>
          {flags.length ? (
            <p className="notice danger" role="alert">
              This document contains instruction-like text. It is treated strictly as untrusted data; no agent tool can act on it.
            </p>
          ) : null}
          <pre className="json">{String(latest.extracted_text).slice(0, 6000)}</pre>
        </section>
      ) : null}

      <section className="card" aria-labelledby="claims-h">
        <h2 id="claims-h">Claims citing this source</h2>
        {links.length ? (
          <ul className="list">
            {links.map((l) => {
              const c = claims.find((x) => x.id === l.claim_id);
              return c ? (
                <li key={l.id} id={`link-${l.id}`}>
                  <div className="row">
                    <EvidenceBadge cls={c.evidence_class} />
                    <StatePill state={c.review_state} />
                    {l.locator ? <Pill>@ {l.locator}</Pill> : null}
                  </div>
                  <Link href={`/evidence/claims/${c.id}`}>{c.statement}</Link>
                  {l.passage ? <blockquote>{l.passage}</blockquote> : null}
                </li>
              ) : null;
            })}
          </ul>
        ) : (
          <p className="unset">No claims cite this source yet.</p>
        )}
      </section>
    </div>
  );
}
