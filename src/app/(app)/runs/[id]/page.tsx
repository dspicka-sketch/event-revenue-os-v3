import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { EvidenceBadge, PageHead, Pill, StatePill, Timestamp, roleLabel } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { Flash } from "@/components/flash";
import type { Brief, JobOutput } from "@/lib/orchestrator/types";

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const db = await getDb();
  const run = await db.get("agent_runs", id);
  if (!run) notFound();
  const [jobs, events, sources] = await Promise.all([
    db.list("agent_jobs", { eq: { run_id: id }, order: "created_at" }),
    db.list("run_events", { eq: { run_id: id }, order: "seq" }),
    db.list("sources"),
  ]);
  const brief = run.brief as Brief | null;
  const active = ["queued", "running"].includes(run.state);
  const srcLabel = (sid: string) => {
    const s = sources.find((x) => x.id === sid);
    return s ? (s.register_code ?? s.title) : `${sid.slice(0, 8)}…`;
  };
  const usage = run.usage ?? {};

  return (
    <div className="stack">
      <p className="small"><Link href="/runs">← Runs</Link></p>
      <PageHead title={run.question} sub={<>{run.kind === "brief" ? "Chief-of-staff brief" : "Investigation"} · started <Timestamp value={run.created_at} /></>} />
      <Flash searchParams={searchParams} />
      <div className="row">
        <StatePill state={run.state} />
        <Pill tone={run.live ? "ok" : "warn"}>{run.live ? `live model: ${run.model}` : "FIXTURE — deterministic, not live research"}</Pill>
        {run.cancel_requested && run.state !== "cancelled" ? <Pill tone="warn">cancel requested</Pill> : null}
      </div>
      <AutoRefresh active={active} />
      {canEdit(db) ? (
        <div className="row">
          {active ? (
            <form action={`/api/runs/${id}/cancel`} method="post"><button type="submit" className="danger">Cancel run</button></form>
          ) : null}
          {["partial", "failed"].includes(run.state) ? (
            <form action={`/api/runs/${id}/retry`} method="post"><button type="submit" className="secondary">Retry failed specialists only</button></form>
          ) : null}
          {run.state === "running" ? (
            <form action={`/api/runs/${id}/resume`} method="post"><button type="submit" className="secondary">Resume (if stalled)</button></form>
          ) : null}
        </div>
      ) : null}

      {brief ? (
        <>
          <section className="card">
            <h2>Recommended next actions (max 3)</h2>
            <ol className="list">
              {brief.next_actions.map((a, i) => (
                <li key={i}><strong>{a.link ? <Link href={a.link.startsWith("#") ? a.link : a.link}>{a.action}</Link> : a.action}</strong><div className="small muted">{a.why}</div></li>
              ))}
              {!brief.next_actions.length ? <li className="unset">No actions proposed.</li> : null}
            </ol>
          </section>
          <section className="card">
            <h2>What changed</h2>
            <ul>{brief.what_changed.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </section>
          {brief.conflicts.length ? (
            <section className="card">
              <h2>Unresolved conflicts</h2>
              {brief.conflicts.map((c) => (
                <div key={c.key} id={`conflict-${c.key}`} className="notice warn" style={{ marginBottom: 8 }}>
                  <strong>{c.key}</strong>
                  <ul>{c.positions.map((p, i) => <li key={i}>{roleLabel(p.role)} ({p.evidence_class}): {p.statement}</li>)}</ul>
                  <p className="small">Needed: {c.evidence_needed}</p>
                </div>
              ))}
            </section>
          ) : null}
          <section className="card">
            <h2>Supporting evidence</h2>
            {brief.supporting_evidence.length ? (
              <ul className="list">
                {brief.supporting_evidence.map((e, i) => (
                  <li key={i}>
                    <div className="row"><EvidenceBadge cls={e.evidence_class} /><Pill>{roleLabel(e.role)}</Pill></div>
                    {e.statement}
                    <div className="small">{e.source_ids.map((s) => <Link key={s} href={`/evidence/sources/${s}`} style={{ marginRight: 8 }}>{srcLabel(s)}</Link>)}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="unset">No sourced findings.</p>}
          </section>
          <div className="grid two">
            <section className="card">
              <h2>Ranked risks</h2>
              <ul>{brief.risks.map((r, i) => <li key={i}>{r.title} <span className="small muted">(impact {r.impact}, likelihood {r.likelihood}; {roleLabel(r.role)})</span></li>)}</ul>
              {!brief.risks.length ? <p className="unset">None proposed.</p> : null}
            </section>
            <section className="card">
              <h2>Decisions needed</h2>
              <ul>{brief.decisions_needed.map((d, i) => <li key={i}><strong>{d.question}</strong> — alternatives: {d.alternatives.join(" / ")}; owner {d.owner}; deadline {d.deadline}</li>)}</ul>
              {!brief.decisions_needed.length ? <p className="unset">None proposed.</p> : null}
            </section>
          </div>
          {brief.unknowns.length ? <section className="card"><h2>Unknowns</h2><ul>{brief.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></section> : null}
          {brief.validation_issues.length ? (
            <section className="card">
              <h2>Rejected by evidence validation</h2>
              <p className="small muted">These findings were not published. Correction tasks were proposed in the review queue.</p>
              <ul className="small">{brief.validation_issues.map((v, i) => <li key={i}>{roleLabel(v.role)} · {v.path}: {v.message}</li>)}</ul>
            </section>
          ) : null}
          {brief.injection_flags.length ? <div className="notice danger">Embedded instructions detected in {brief.injection_flags.length} source read(s). They were treated as data; no action was taken.</div> : null}
          {brief.partial_failures.length ? (
            <section className="card">
              <h2>Partial failures</h2>
              <ul>{brief.partial_failures.map((f, i) => <li key={i}>{roleLabel(f.role)}: <StatePill state={f.state} /> {f.error}</li>)}</ul>
            </section>
          ) : null}
        </>
      ) : null}

      <section className="card">
        <h2>Specialist jobs</h2>
        <ul className="list">
          {jobs.map((j) => {
            const out = j.output as JobOutput | null;
            return (
              <li key={j.id} id={`job-${j.id}`}>
                <div className="row">
                  <strong>{roleLabel(j.role)}</strong>
                  <StatePill state={j.state} />
                  <span className="small muted">attempts {j.attempt} · steps {j.steps} · tokens {j.tokens_in + j.tokens_out}</span>
                </div>
                {j.error ? <p className="small notice danger">{j.error}</p> : null}
                {out?.publishable ? <p className="small">{out.publishable.summary}</p> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <details className="card disclosure">
        <summary>Run details</summary>
        <p className="small">
          Usage: {usage.tokensIn ?? 0} input / {usage.tokensOut ?? 0} output tokens · cost:{" "}
          {usage.costUsd === null || usage.costUsd === undefined ? "unknown" : `$${Number(usage.costUsd).toFixed(4)} (${usage.costBasis})`}
          {usage.stoppedAtBudget ? " · stopped at budget cap" : ""}
        </p>
        <p className="small">Prompt version: {run.prompt_version} · Budget: <code>{JSON.stringify(run.budget)}</code></p>
        <p className="small">Input snapshot: {run.input_snapshot?.source_ids?.length ?? 0} sources, {run.input_snapshot?.claim_ids?.length ?? 0} claims · permission: {JSON.stringify(run.permission_context)}</p>
        <h3>Events</h3>
        <ul className="small">
          {events.map((e) => (
            <li key={e.id}><Timestamp value={e.created_at} /> · {e.kind} {e.payload && Object.keys(e.payload).length ? <code>{JSON.stringify(e.payload).slice(0, 200)}</code> : null}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
