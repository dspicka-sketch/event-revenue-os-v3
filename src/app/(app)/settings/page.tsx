import { getDb } from "@/lib/data/context";
import { inviteMember, seedBaseline, signOut } from "@/lib/actions";
import { modelConfig, PROJECT_TIMEZONE } from "@/lib/config";
import { ROLE_SPEC_VERSION } from "@/lib/domain/roles";
import { PROMPT_VERSION } from "@/lib/orchestrator/engine";
import { DEFAULT_BUDGET } from "@/lib/orchestrator/types";
import { PageHead, Pill, StatePill, Timestamp } from "@/components/ui";
import { Flash, type PageProps } from "@/components/flash";

export default async function Settings({ searchParams }: PageProps) {
  const db = await getDb();
  const [members, integrations, sources, audit] = await Promise.all([
    db.list("project_members"),
    db.list("integrations", { order: "provider" }),
    db.list("sources", { limit: 1 }),
    db.role === "viewer" ? Promise.resolve([]) : db.list("audit_events", { order: "created_at", desc: true, limit: 25 }),
  ]);
  const model = modelConfig();
  const isOwner = db.role === "owner";

  return (
    <div className="stack">
      <PageHead title="Settings" sub="Membership, connection state, model and budget, export and audit." />
      <Flash searchParams={searchParams} />

      <section className="card">
        <h2>Session</h2>
        <p>Signed in as {db.userEmail ?? db.userId} ({db.role}) · mode: <Pill tone={db.mode === "live" ? "ok" : "warn"}>{db.mode}</Pill></p>
        <p className="small muted">Project timezone: {PROJECT_TIMEZONE}. Timestamps are stored in UTC and shown in Pacific time; date-only deadlines are shown exactly as stated.</p>
        <form action={signOut}><button type="submit" className="secondary">Sign out</button></form>
      </section>

      <section className="card">
        <h2>Connections (actual state)</h2>
        <p className="small muted">A connection is shown as connected only after a verified check — never because an environment variable exists.</p>
        <ul className="list">
          <li>
            <div className="row"><strong>Agent model (Vercel AI Gateway)</strong><StatePill state={db.mode === "demo" ? "disabled" : model.model ? "configured_unverified" : "not_configured"} /></div>
            <div className="small">{db.mode === "demo" ? "Demo mode uses a fixture model only." : model.model ? `AGENT_MODEL=${model.model}. Verified only by a completed live run (see Runs, “live model”).` : model.reason}</div>
          </li>
          {integrations.map((i) => (
            <li key={i.id}>
              <div className="row"><strong>{i.provider.replaceAll("_", " ")}</strong><StatePill state={i.state} /></div>
              <div className="small muted">{i.note} {i.verified_at ? <>· verified <Timestamp value={i.verified_at} /></> : null}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Model and budget</h2>
        <ul className="small">
          <li>Max concurrent specialists: {DEFAULT_BUDGET.maxConcurrent}</li>
          <li>Run token cap: {DEFAULT_BUDGET.maxTokens.toLocaleString()} (per-job reservation {DEFAULT_BUDGET.perJobTokenEstimate.toLocaleString()})</li>
          <li>Run cost cap: {DEFAULT_BUDGET.maxCostUsd === null ? "not set — cost shown as unknown unless the gateway reports it" : `$${DEFAULT_BUDGET.maxCostUsd}`}</li>
          <li>Tool steps per specialist: {DEFAULT_BUDGET.maxStepsPerSpecialist} · automatic retries for transient errors: {DEFAULT_BUDGET.maxTransientRetries}</li>
          <li>Role spec {ROLE_SPEC_VERSION} · prompt {PROMPT_VERSION}</li>
          <li>Recurring research: disabled until Daniel selects cadence and budget.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Members</h2>
        <ul className="list">
          {members.map((m) => (
            <li key={m.id} className="row"><code className="small">{m.invited_email ?? m.user_id}</code><Pill>{m.role}</Pill><StatePill state={m.access_state} /></li>
          ))}
        </ul>
        {isOwner && db.mode === "live" ? (
          <form action={inviteMember} className="form-row">
            <div><label htmlFor="inv-email">Email (label)</label><input id="inv-email" name="email" type="email" /></div>
            <div><label htmlFor="inv-id">Supabase user id (after Auth → Invite user)</label><input id="inv-id" name="user_id" required /></div>
            <div><label htmlFor="inv-role">Role</label><select id="inv-role" name="role" defaultValue="viewer"><option value="viewer">viewer</option><option value="editor">editor</option></select></div>
            <div style={{ alignSelf: "end" }}><button type="submit">Add member</button></div>
          </form>
        ) : null}
      </section>

      <section className="card">
        <h2>Export</h2>
        <p className="small">Download records with evidence classes, source ids, restrictions, dates and decision history. Signed URLs, storage keys, extracted text and secrets are excluded.</p>
        {db.role !== "viewer" ? <a className="button secondary" href="/api/export">Download export (JSON)</a> : <p className="small muted">Viewers cannot export.</p>}
        {isOwner && db.mode === "live" && sources.length === 0 ? (
          <form action={seedBaseline} style={{ marginTop: 12 }}>
            <p className="small">This project has no sources yet. Seed the October 26, 2026 inherited evidence baseline (references only; findings marked needs-review).</p>
            <button type="submit">Seed inherited baseline</button>
          </form>
        ) : null}
      </section>

      {audit.length ? (
        <section className="card">
          <h2>Recent audit events</h2>
          <ul className="small list">
            {audit.map((a) => (
              <li key={a.id}><Timestamp value={a.created_at} /> · {a.actor_kind}{a.actor ? ` ${String(a.actor).slice(0, 8)}…` : ""} · {a.action} {a.table_name} v{a.record_version}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
