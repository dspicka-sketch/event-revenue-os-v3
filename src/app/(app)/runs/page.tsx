import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { modelConfig } from "@/lib/config";
import { ROLES, SPECIALIST_KEYS } from "@/lib/domain/roles";
import { Empty, PageHead, Pill, StatePill, Timestamp } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";

export default async function Runs({ searchParams }: PageProps) {
  const db = await getDb();
  const runs = await db.list("agent_runs", { order: "created_at", desc: true, limit: 50 });
  const model = modelConfig();
  const blocked = db.mode === "live" && !model.model;
  const key = randomUUID(); // one key per rendered form → a double-click submits once

  return (
    <div className="stack">
      <PageHead title="Briefings & runs" sub="Run a focused investigation or a chief-of-staff brief. Runs are durable: they survive closing this page." />
      <Flash searchParams={searchParams} />
      {db.mode === "demo" ? <div className="notice warn">Demo runs use a deterministic FIXTURE model that only restates recorded claims. They are not research.</div> : null}
      {blocked ? <div className="notice danger" role="alert">Live model not configured: {model.reason}</div> : null}

      {canEdit(db) ? (
        <div className="grid two">
          <section className="card">
            <h2>Chief-of-staff brief</h2>
            <form action="/api/runs" method="post">
              <input type="hidden" name="idempotency_key" value={`b-${key}`} />
              <input type="hidden" name="kind" value="brief" />
              <input type="hidden" name="question" value="What needs my attention?" />
              <p className="small muted">Reconciles current records and returns at most three actions, each linked to a decision, task or source.</p>
              <button type="submit" disabled={blocked}>What needs my attention?</button>
            </form>
          </section>
          <section className="card">
            <h2>Focused investigation</h2>
            <form action="/api/runs" method="post">
              <input type="hidden" name="idempotency_key" value={`i-${key}`} />
              <input type="hidden" name="kind" value="investigation" />
              <label htmlFor="q">Question</label>
              <input id="q" name="question" placeholder="Assess ownership structures" required />
              <fieldset style={{ border: 0, padding: 0, marginTop: 8 }}>
                <legend className="small">Specialists (optional — leave blank and the chief picks only relevant ones)</legend>
                <div className="row">
                  {SPECIALIST_KEYS.map((k) => (
                    <label key={k} style={{ fontWeight: 400, display: "flex", gap: 6, alignItems: "center", minHeight: 44 }}>
                      <input type="checkbox" name="roles" value={k} style={{ width: 20, minHeight: 20 }} /> {ROLES[k].title}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" disabled={blocked}>Start investigation</button>
            </form>
          </section>
        </div>
      ) : null}

      <section className="card">
        <h2>Runs</h2>
        {runs.length ? (
          <table className="data cards">
            <thead><tr><th>Question</th><th>State</th><th>Mode</th><th>Specialists</th><th>Started</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td data-label="Question"><Link href={`/runs/${r.id}`}>{r.question}</Link></td>
                  <td data-label="State"><StatePill state={r.state} /></td>
                  <td data-label="Mode"><Pill tone={r.live ? "ok" : "warn"}>{r.live ? "live" : "fixture"}</Pill></td>
                  <td data-label="Specialists" className="small">{(r.planned_roles ?? []).join(", ")}</td>
                  <td data-label="Started"><Timestamp value={r.created_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No runs yet.</Empty>
        )}
      </section>
    </div>
  );
}
