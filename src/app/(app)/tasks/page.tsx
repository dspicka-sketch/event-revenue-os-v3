import Link from "next/link";
import { getDb } from "@/lib/data/context";
import { canEdit } from "@/lib/data/db";
import { saveRisk, saveTask } from "@/lib/actions";
import { ROLE_KEYS } from "@/lib/domain/roles";
import { DateOnly, PageHead, Pill, StatePill, roleLabel } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";

type Row = Record<string, any>;

function TaskForm({ t }: { t?: Row }) {
  const p = t ? `t-${t.id}` : "t-new";
  return (
    <form action={saveTask} className="stack">
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      {t ? <input type="hidden" name="row_version" value={t.row_version} /> : null}
      <div>
        <label htmlFor={`${p}-title`}>Title</label>
        <input id={`${p}-title`} name="title" defaultValue={t?.title} required />
      </div>
      <div className="form-row">
        <div>
          <label htmlFor={`${p}-role`}>Responsible role</label>
          <select id={`${p}-role`} name="assigned_role" defaultValue={t?.assigned_role ?? ""}>
            <option value="">unassigned</option>
            {ROLE_KEYS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${p}-status`}>Status</label>
          <select id={`${p}-status`} name="status" defaultValue={t?.status ?? "open"}>
            {["open", "in_progress", "blocked", "done", "archived"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${p}-dk`}>Deadline type</label>
          <select id={`${p}-dk`} name="deadline_kind" defaultValue={t?.deadline_kind ?? "unset"}>
            <option value="unset">Unset</option>
            <option value="internal_target">Internal target</option>
            <option value="external_soft">External (soft)</option>
            <option value="external_hard">External (hard)</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${p}-due`}>Due date (as stated)</label>
          <input id={`${p}-due`} name="due_date" type="date" defaultValue={t?.due_date ? String(t.due_date).slice(0, 10) : ""} />
        </div>
      </div>
      <div className="form-row">
        <div>
          <label htmlFor={`${p}-tz`}>Deadline timezone</label>
          <input id={`${p}-tz`} name="due_timezone" defaultValue={t?.due_timezone ?? "America/Los_Angeles"} />
        </div>
        <div>
          <label htmlFor={`${p}-prov`}>Deadline provenance (required if set)</label>
          <input id={`${p}-prov`} name="due_provenance" defaultValue={t?.due_provenance ?? ""} />
        </div>
      </div>
      <div>
        <label htmlFor={`${p}-next`}>Next action</label>
        <input id={`${p}-next`} name="next_action" defaultValue={t?.next_action ?? ""} />
      </div>
      <div>
        <label htmlFor={`${p}-blk`}>Blocked reason (required when blocked)</label>
        <input id={`${p}-blk`} name="blocked_reason" defaultValue={t?.blocked_reason ?? ""} />
      </div>
      <div>
        <label htmlFor={`${p}-ev`}>Completion evidence</label>
        <input id={`${p}-ev`} name="completion_evidence" defaultValue={t?.completion_evidence ?? ""} />
      </div>
      <div><button type="submit">{t ? "Save task" : "Create task"}</button></div>
    </form>
  );
}

export default async function Tasks({ searchParams }: PageProps) {
  const db = await getDb();
  const sp = await searchParams;
  const [tasks, deps, risks] = await Promise.all([db.list("tasks"), db.list("task_dependencies"), db.list("risks")]);
  const editable = canEdit(db);
  const show = sp.archived === "1" ? tasks : tasks.filter((t) => t.status !== "archived");
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const editId = typeof sp.edit === "string" ? sp.edit : null;

  return (
    <div className="stack">
      <PageHead title="Risks & tasks" sub="Assign, track dependencies and deadline provenance. Archived items keep their audit trail." actions={<Link href={sp.archived === "1" ? "/tasks" : "/tasks?archived=1"}>{sp.archived === "1" ? "Hide archived" : "Show archived"}</Link>} />
      <Flash searchParams={searchParams} />

      <section className="card">
        <h2>Tasks ({show.length})</h2>
        <ul className="list">
          {show.map((t) => {
            const blockers = deps.filter((d) => d.task_id === t.id).map((d) => byId.get(d.depends_on_id)).filter(Boolean);
            return (
              <li key={t.id} id={`task-${t.id}`}>
                <div className="row">
                  <StatePill state={t.status} />
                  <Pill>{roleLabel(t.assigned_role)}{t.secondary_role ? ` / ${roleLabel(t.secondary_role)}` : ""}</Pill>
                  {t.origin === "correction" ? <Pill tone="danger">correction</Pill> : t.origin === "agent" ? <Pill tone="info">agent</Pill> : null}
                  <span className="small">
                    Due: {t.deadline_kind === "unset" ? <span className="unset">unset</span> : <><DateOnly value={t.due_date} tz={t.due_timezone} /> <Pill tone={t.deadline_kind === "internal_target" ? "info" : "warn"}>{t.deadline_kind.replace("_", " ")}</Pill></>}
                  </span>
                </div>
                <strong>{t.title}</strong>
                {t.next_action ? <div className="small">Next: {t.next_action}</div> : null}
                {t.blocked_reason ? <div className="small notice warn">Blocked: {t.blocked_reason}</div> : null}
                {blockers.length ? <div className="small muted">Depends on: {blockers.map((b) => b!.title).join("; ")}</div> : null}
                {t.completion_evidence ? <div className="small muted">Completion evidence: {t.completion_evidence}</div> : null}
                {t.due_provenance ? <div className="small muted">Deadline source: {t.due_provenance}</div> : null}
                {editable ? (
                  <details className="disclosure" open={editId === t.id}>
                    <summary>Edit</summary>
                    <TaskForm t={t} />
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      {editable ? (
        <section className="card">
          <details className="disclosure">
            <summary>New task</summary>
            <TaskForm />
          </details>
        </section>
      ) : null}

      <section className="card">
        <h2>Risks ({risks.length})</h2>
        <ul className="list">
          {risks.map((r) => (
            <li key={r.id} id={`risk-${r.id}`}>
              <div className="row">
                <StatePill state={r.status} />
                <Pill tone={["high", "severe"].includes(r.impact) ? "danger" : "neutral"}>impact {r.impact}</Pill>
                <Pill>likelihood {r.likelihood}</Pill>
                <Pill>{roleLabel(r.owner_role)}</Pill>
              </div>
              <strong>{r.title}</strong>
              {r.description ? <p className="small">{r.description}</p> : null}
              <p className="small muted">Mitigation: {r.mitigation ?? "—"} · Review: <DateOnly value={r.review_date} /></p>
              <p className="small">
                {(r.claim_ids ?? []).map((id: string) => <Link key={id} href={`/evidence/claims/${id}`} style={{ marginRight: 8 }}>evidence</Link>)}
                {(r.task_ids ?? []).map((id: string) => <Link key={id} href={`/tasks#task-${id}`} style={{ marginRight: 8 }}>task: {byId.get(id)?.title ?? "task"}</Link>)}
              </p>
              {editable ? (
                <details className="disclosure">
                  <summary>Edit risk</summary>
                  <RiskForm r={r} />
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <details className="disclosure">
            <summary>New risk</summary>
            <RiskForm />
          </details>
        ) : null}
      </section>
    </div>
  );
}

function RiskForm({ r }: { r?: Row }) {
  const p = r ? `r-${r.id}` : "r-new";
  return (
    <form action={saveRisk} className="stack">
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      {r ? <input type="hidden" name="row_version" value={r.row_version} /> : null}
      <div><label htmlFor={`${p}-t`}>Title</label><input id={`${p}-t`} name="title" defaultValue={r?.title} required /></div>
      <div><label htmlFor={`${p}-d`}>Description</label><input id={`${p}-d`} name="description" defaultValue={r?.description ?? ""} /></div>
      <div className="form-row">
        <div><label htmlFor={`${p}-l`}>Likelihood</label><select id={`${p}-l`} name="likelihood" defaultValue={r?.likelihood ?? "unknown"}>{["unknown", "low", "medium", "high"].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label htmlFor={`${p}-i`}>Impact</label><select id={`${p}-i`} name="impact" defaultValue={r?.impact ?? "unknown"}>{["unknown", "low", "medium", "high", "severe"].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label htmlFor={`${p}-s`}>Status</label><select id={`${p}-s`} name="status" defaultValue={r?.status ?? "open"}>{["open", "mitigating", "closed", "archived"].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label htmlFor={`${p}-o`}>Owner role</label><select id={`${p}-o`} name="owner_role" defaultValue={r?.owner_role ?? ""}><option value="">unassigned</option>{ROLE_KEYS.map((k) => <option key={k} value={k}>{roleLabel(k)}</option>)}</select></div>
        <div><label htmlFor={`${p}-rd`}>Review date</label><input id={`${p}-rd`} type="date" name="review_date" defaultValue={r?.review_date ? String(r.review_date).slice(0, 10) : ""} /></div>
      </div>
      <div><label htmlFor={`${p}-m`}>Mitigation</label><input id={`${p}-m`} name="mitigation" defaultValue={r?.mitigation ?? ""} /></div>
      <div><button type="submit">Save risk</button></div>
    </form>
  );
}
