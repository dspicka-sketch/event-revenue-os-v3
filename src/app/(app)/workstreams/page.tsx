import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { ROLES, SPECIALIST_KEYS, ROLE_KEYS } from "@/lib/domain/roles";
import { PageHead, Pill, StatePill } from "@/components/ui";

export default async function Workstreams() {
  const db = await getDb();
  const [tasks, jobs] = await Promise.all([db.list("tasks"), db.list("agent_jobs", { order: "created_at", desc: true, limit: 200 })]);
  return (
    <div className="stack">
      <PageHead title="Workstreams" sub="Seven specialist lanes plus the chief of staff. Role names describe scope, not hired staff or credentials." />
      <div className="grid two">
        {(["chief_of_staff", ...SPECIALIST_KEYS] as (typeof ROLE_KEYS)[number][]).map((k) => {
          const r = ROLES[k];
          const mine = tasks.filter((t) => (t.assigned_role === k || t.secondary_role === k) && t.status !== "archived");
          const latest = jobs.find((j) => j.role === k);
          const blocked = mine.filter((t) => t.status === "blocked");
          return (
            <section key={k} className="card stack">
              <h2>{r.title}</h2>
              <p className="small">{r.responsibility}</p>
              <p className="small muted">Deliverable: {r.firstOutput}</p>
              <div className="row small">
                <Pill>{mine.filter((t) => t.status !== "done").length} open task(s)</Pill>
                {blocked.length ? <Pill tone="warn">{blocked.length} blocked</Pill> : null}
                <Pill tone="ok">{mine.filter((t) => t.status === "done").length} done</Pill>
              </div>
              <ul className="list small">
                {mine.slice(0, 4).map((t) => (
                  <li key={t.id}>
                    <StatePill state={t.status} /> <Link href={`/tasks#task-${t.id}`}>{t.title}</Link>
                    {t.blocked_reason ? <div className="muted">Blocker: {t.blocked_reason}</div> : null}
                  </li>
                ))}
              </ul>
              {k !== "chief_of_staff" ? (
                latest ? (
                  <p className="small">
                    Latest findings: <Link href={`/runs/${latest.run_id}#job-${latest.id}`}>run job</Link> <StatePill state={latest.state} />
                  </p>
                ) : (
                  <p className="small unset">No runs yet for this specialist.</p>
                )
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
