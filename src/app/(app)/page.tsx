import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { MISSION } from "@/lib/domain/roles";
import { modelConfig } from "@/lib/config";
import { Empty, EvidenceBadge, PageHead, Pill, StatePill, Timestamp } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";
import type { Brief } from "@/lib/orchestrator/types";

const STAGES = [
  ["baseline", "Baseline"],
  ["feasibility", "Feasibility"],
  ["structure_funding", "Structure / funding"],
  ["authorized_execution", "Authorized execution"],
  ["stewardship", "Stewardship"],
] as const;

export default async function Overview({ searchParams }: PageProps) {
  const db = await getDb();
  const [projects, runs, decisions, risks, tasks, claims, sources] = await Promise.all([
    db.list("projects"),
    db.list("agent_runs", { order: "created_at", desc: true, limit: 5 }),
    db.list("decisions", { eq: { state: "open" } }),
    db.list("risks", { eq: { status: "open" } }),
    db.list("tasks"),
    db.list("claims", { order: "updated_at", desc: true, limit: 6 }),
    db.list("sources"),
  ]);
  const project = projects.find((p) => p.id === db.projectId) ?? projects[0];
  const lastBriefRun = runs.find((r) => r.brief && ["completed", "partial"].includes(r.state));
  const brief = lastBriefRun?.brief as Brief | undefined;
  const blocked = tasks.filter((t) => t.status === "blocked");
  const missing = sources.filter((s) => s.availability !== "available");
  const urgent = risks.filter((r) => ["high", "severe"].includes(r.impact)).slice(0, 4);
  const model = modelConfig();

  return (
    <div className="stack">
      <PageHead title="Overview" sub="What changed, what needs Daniel, what is blocked, and what supports each recommendation." />
      <Flash searchParams={searchParams} />
      {db.mode === "live" && !model.model ? (
        <div className="notice danger" role="alert">
          Agent runs are blocked: {model.reason} The dashboard and records work without it. See <Link href="/settings">Settings</Link>.
        </div>
      ) : null}

      <section className="card" aria-labelledby="mission-h">
        <h2 id="mission-h">Mission (approved)</h2>
        <p>{db.mode === "demo" ? MISSION : project?.mission || MISSION}</p>
        <p className="small muted">Current stage — advances only with evidence-backed criteria and sponsor signoff.</p>
        <ol className="steps" aria-label="Project stages">
          {STAGES.map(([k, label]) => (
            <li key={k} aria-current={project?.stage === k ? "step" : undefined}>
              {label}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid two">
        <section className="card" aria-labelledby="needs-h">
          <h2 id="needs-h">What needs Daniel</h2>
          {brief?.next_actions?.length ? (
            <ol className="list">
              {brief.next_actions.slice(0, 3).map((a, i) => (
                <li key={i}>
                  <strong>{a.link ? <Link href={a.link.startsWith("#") ? `/runs/${lastBriefRun!.id}${a.link}` : a.link}>{a.action}</Link> : a.action}</strong>
                  <div className="small muted">{a.why}</div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>
              No briefing yet. <Link href="/runs">Run “What needs my attention?”</Link>
            </Empty>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            {decisions.length} open decision(s) · <Link href="/decisions">review decisions</Link>
          </p>
        </section>

        <section className="card" aria-labelledby="blocked-h">
          <h2 id="blocked-h">What is blocked</h2>
          <ul className="list">
            {blocked.slice(0, 4).map((t) => (
              <li key={t.id}>
                <Link href={`/tasks?edit=${t.id}`}>{t.title}</Link>
                <div className="small muted">{t.blocked_reason}</div>
              </li>
            ))}
            <li>
              <Link href="/evidence">{missing.length} source(s) not yet retrieved into this project</Link>
              <div className="small muted">Inherited findings stay “needs review” until their sources are retrieved.</div>
            </li>
          </ul>
        </section>
      </div>

      <div className="grid two">
        <section className="card" aria-labelledby="changed-h">
          <h2 id="changed-h">Evidence changes</h2>
          <ul className="list">
            {claims.map((c) => (
              <li key={c.id}>
                <div className="row">
                  <EvidenceBadge cls={c.evidence_class} />
                  <StatePill state={c.review_state} />
                  {c.code ? <Pill>{c.code}</Pill> : null}
                </div>
                <Link href={`/evidence/claims/${c.id}`}>{c.statement}</Link>
                <div className="small muted">
                  updated <Timestamp value={c.updated_at} />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="risk-h">
          <h2 id="risk-h">Urgent risks</h2>
          {urgent.length ? (
            <ul className="list">
              {urgent.map((r) => (
                <li key={r.id}>
                  <div className="row">
                    <Pill tone="danger">impact {r.impact}</Pill>
                    <Pill>likelihood {r.likelihood}</Pill>
                  </div>
                  <Link href={`/tasks#risk-${r.id}`}>{r.title}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No high-impact open risks recorded.</Empty>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="brief-h">
        <div className="row between">
          <h2 id="brief-h">Last briefing</h2>
          <Link className="button secondary" href="/runs">
            Run a brief
          </Link>
        </div>
        {lastBriefRun ? (
          <div className="stack">
            <div className="row">
              <StatePill state={lastBriefRun.state} />
              <Pill tone={lastBriefRun.live ? "ok" : "warn"}>{lastBriefRun.live ? "live model" : "fixture (not live)"}</Pill>
              <span className="small muted">
                <Timestamp value={lastBriefRun.finished_at ?? lastBriefRun.created_at} />
              </span>
            </div>
            <p>
              <Link href={`/runs/${lastBriefRun.id}`}>{lastBriefRun.question}</Link>
            </p>
            {brief?.conflicts?.length ? <p className="notice warn">{brief.conflicts.length} unresolved conflict(s) between specialists.</p> : null}
          </div>
        ) : (
          <Empty>No completed briefing.</Empty>
        )}
        {runs[0] && runs[0].id !== lastBriefRun?.id ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            Latest run: <Link href={`/runs/${runs[0].id}`}>{runs[0].question}</Link> — <StatePill state={runs[0].state} />
          </p>
        ) : null}
      </section>
    </div>
  );
}
