"use server";
// Server actions. Every action re-checks the caller's role; in live mode Postgres RLS and
// triggers enforce the same rules again (defense in depth).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEditor, requireOwner, getDb } from "./data/context";
import type { Db, Row } from "./data/db";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const num = (f: FormData, k: string) => Number(f.get(k));

function done(path: string, msg?: string): never {
  revalidatePath(path);
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}` : path);
}

function fail(path: string, e: unknown): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent((e as Error).message ?? String(e))}`);
}

async function attempt(path: string, fn: (db: Db) => Promise<unknown>, needs: "editor" | "owner" = "editor") {
  let db: Db;
  try {
    db = needs === "owner" ? await requireOwner() : await requireEditor();
    await fn(db);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    fail(path, e);
  }
}

// ---- Tasks -----------------------------------------------------------------
export async function saveTask(form: FormData) {
  const id = str(form, "id");
  const back = str(form, "back") ?? "/tasks";
  await attempt(back, async (db) => {
    const deadlineKind = str(form, "deadline_kind") ?? "unset";
    const patch: Row = {
      title: str(form, "title"),
      assigned_role: str(form, "assigned_role"),
      status: str(form, "status") ?? "open",
      next_action: str(form, "next_action"),
      blocked_reason: str(form, "blocked_reason"),
      due_date: deadlineKind === "unset" ? null : str(form, "due_date"),
      due_timezone: deadlineKind === "unset" ? null : str(form, "due_timezone") ?? "America/Los_Angeles",
      deadline_kind: deadlineKind,
      due_provenance: deadlineKind === "unset" ? null : str(form, "due_provenance"),
      completion_evidence: str(form, "completion_evidence"),
    };
    if (patch.status === "archived") patch.archived_at = new Date().toISOString();
    if (!patch.title) throw new Error("Title is required.");
    if (id) await db.update("tasks", id, num(form, "row_version"), patch);
    else await db.insert("tasks", { ...patch, origin: "user", created_by: db.userId });
  });
  done(back, "Task saved");
}

export async function saveRisk(form: FormData) {
  const id = str(form, "id");
  await attempt("/tasks", async (db) => {
    const patch: Row = {
      title: str(form, "title"),
      description: str(form, "description"),
      likelihood: str(form, "likelihood") ?? "unknown",
      impact: str(form, "impact") ?? "unknown",
      mitigation: str(form, "mitigation"),
      owner_role: str(form, "owner_role"),
      status: str(form, "status") ?? "open",
      review_date: str(form, "review_date"),
    };
    if (!patch.title) throw new Error("Title is required.");
    if (id) await db.update("risks", id, num(form, "row_version"), patch);
    else await db.insert("risks", { ...patch, origin: "user" });
  });
  done("/tasks", "Risk saved");
}

// ---- Decisions (owner only) -------------------------------------------------
export async function recordDecision(form: FormData) {
  const id = str(form, "id")!;
  await attempt("/decisions", async (db) => {
    const state = str(form, "state");
    if (!state || !["accepted", "rejected", "deferred"].includes(state)) throw new Error("Choose accept, reject or defer.");
    const rationale = str(form, "rationale");
    if (!rationale) throw new Error("A rationale is required.");
    await db.update("decisions", id, num(form, "row_version"), {
      state,
      rationale,
      chosen_alternative: state === "accepted" ? str(form, "chosen_alternative") : null,
    });
  }, "owner");
  done("/decisions", "Decision recorded");
}

// ---- Claims review --------------------------------------------------------
export async function reviewClaim(form: FormData) {
  const id = str(form, "id")!;
  const back = str(form, "back") ?? "/evidence";
  await attempt(back, async (db) => {
    const action = str(form, "action");
    const patch: Row = {};
    if (action === "accept") patch.review_state = "accepted";
    else if (action === "reject") patch.review_state = "rejected";
    else if (action === "needs_review") patch.review_state = "needs_review";
    else if (action === "verify") {
      patch.evidence_class = "verified_current";
      patch.verified_by = db.userEmail ?? db.userId;
      patch.verified_at = new Date().toISOString();
      patch.review_state = "accepted";
    } else throw new Error("Unknown review action.");
    await db.update("claims", id, num(form, "row_version"), patch);
  });
  done(back, "Claim updated");
}

// ---- Proposals: promote or reject agent output -----------------------------
export async function reviewProposal(form: FormData) {
  const id = str(form, "id")!;
  const action = str(form, "action");
  await attempt("/review", async (db) => {
    const p = await db.get("proposals", id);
    if (!p || p.state !== "pending") throw new Error("Proposal is no longer pending.");
    if (action === "reject") {
      await db.update("proposals", id, p.row_version, { state: "rejected", reviewed_by: db.userId, reviewed_at: new Date().toISOString() });
      return;
    }
    const m = p.mutation as Row;
    switch (p.target_table) {
      case "claims": {
        const sources = await db.list("sources");
        const known = new Set(sources.map((s) => s.id));
        const refs = ((m.source_refs as Row[]) ?? []).filter((r) => known.has(r.source_id));
        const claim = await db.insert("claims", {
          statement: m.statement, evidence_class: m.evidence_class, limits: m.limits, conflict_group: m.conflict_group,
          review_state: "proposed", origin: "agent",
        });
        for (const r of refs) await db.insert("claim_sources", { claim_id: claim.id, source_id: r.source_id, locator: r.locator ?? null, passage: r.passage ?? null });
        break;
      }
      case "tasks":
        await db.insert("tasks", { title: m.title, assigned_role: m.assigned_role ?? null, next_action: m.next_action, description: m.description, origin: m.origin === "correction" ? "correction" : "agent" });
        break;
      case "risks":
        await db.insert("risks", { title: m.title, likelihood: m.likelihood, impact: m.impact, mitigation: m.mitigation, owner_role: m.owner_role, origin: "agent" });
        break;
      case "decisions":
        await db.insert("decisions", { question: m.question, recommendation: m.recommendation, alternatives: m.alternatives, owner: m.owner, origin: "agent" });
        break;
      case "drafts": {
        const draft = await db.insert("drafts", { kind: m.kind, title: m.title, audience: m.audience, body: m.body, content_hash: "pending", origin: "agent" });
        const req = m.approval_request as Row | undefined;
        if (req) {
          await db.insert("approvals", {
            action_kind: req.action_kind, target: req.target, record_table: "drafts", record_id: draft.id, record_version: draft.row_version,
            content_hash: draft.content_hash, scope: `${req.action_kind} of this exact draft to ${req.target}, once`, requested_by_role: p.role,
          });
        }
        break;
      }
    }
    await db.update("proposals", id, p.row_version, { state: "applied", reviewed_by: db.userId, reviewed_at: new Date().toISOString() });
  });
  done("/review", action === "reject" ? "Proposal rejected" : "Proposal applied for review");
}

// ---- Drafts and approvals -------------------------------------------------
export async function saveDraft(form: FormData) {
  const id = str(form, "id");
  await attempt("/review", async (db) => {
    const patch = { title: str(form, "title"), audience: str(form, "audience"), body: str(form, "body"), kind: str(form, "kind") ?? "other", contains_confidential: form.get("contains_confidential") === "on" };
    if (!patch.title || !patch.body) throw new Error("Title and body are required.");
    if (id) await db.update("drafts", id, num(form, "row_version"), patch);
    else await db.insert("drafts", { ...patch, content_hash: "pending", origin: "user" });
  });
  done("/review", "Draft saved — any prior approval for changed content is invalidated");
}

export async function requestApproval(form: FormData) {
  const draftId = str(form, "draft_id")!;
  await attempt("/review", async (db) => {
    const d = await db.get("drafts", draftId);
    if (!d) throw new Error("Draft not found.");
    const target = str(form, "target") ?? d.audience;
    if (!target) throw new Error("Name the intended recipient/target.");
    await db.insert("approvals", {
      action_kind: str(form, "action_kind") ?? "external_send",
      target, record_table: "drafts", record_id: d.id, record_version: d.row_version, content_hash: d.content_hash,
      scope: `${str(form, "action_kind") ?? "external_send"} of this exact draft to ${target}, once`, requested_by_user: db.userId,
    });
  });
  done("/review", "Approval requested");
}

export async function decideApproval(form: FormData) {
  const id = str(form, "id")!;
  await attempt("/review", async (db) => {
    const a = await db.get("approvals", id);
    if (!a) throw new Error("Approval not found.");
    const action = str(form, "action");
    if (action === "approve") {
      const d = a.record_table === "drafts" ? await db.get("drafts", a.record_id) : null;
      if (d && d.content_hash !== a.content_hash) throw new Error("The draft changed after this request; request approval again.");
      await db.update("approvals", id, a.row_version, { state: "approved", expires_at: new Date(Date.now() + 14 * 864e5).toISOString() });
      if (d) await db.update("drafts", d.id, d.row_version, { state: "approved" });
    } else {
      await db.update("approvals", id, a.row_version, { state: "rejected", note: str(form, "note") });
    }
  }, "owner");
  done("/review", "Approval updated — approval is not delivery; send it yourself if appropriate");
}

// ---- Manual source entry --------------------------------------------------
export async function addManualSource(form: FormData) {
  await attempt("/evidence", async (db) => {
    const url = str(form, "original_url");
    if (url && !/^https:\/\//.test(url)) throw new Error("Only https URLs can be recorded.");
    await db.insert("sources", {
      kind: str(form, "kind") ?? "other",
      title: str(form, "title") ?? "Untitled source",
      source_date: str(form, "source_date"),
      original_url: url,
      access_classification: str(form, "access_classification") ?? "confidential",
      availability: "pending_retrieval",
      retrieval_task: "Manually recorded reference; retrieve and upload the original.",
      created_by: db.userId,
    });
  });
  done("/evidence", "Source recorded as pending retrieval");
}

export async function addClaim(form: FormData) {
  await attempt("/evidence", async (db) => {
    const statement = str(form, "statement");
    const sourceId = str(form, "source_id");
    if (!statement) throw new Error("Statement is required.");
    const claim = await db.insert("claims", { statement, evidence_class: str(form, "evidence_class") ?? "unknown", limits: str(form, "limits"), review_state: "proposed", origin: "user", created_by: db.userId });
    if (sourceId) await db.insert("claim_sources", { claim_id: claim.id, source_id: sourceId, locator: str(form, "locator"), passage: str(form, "passage") });
  });
  done("/evidence", "Claim recorded as proposed");
}

export async function seedBaseline() {
  await attempt("/settings", async (db) => {
    await db.rpc("seed_protect104_baseline", { p_project: db.projectId });
  }, "owner");
  done("/settings", "Baseline seeded");
}

export async function inviteMember(form: FormData) {
  await attempt("/settings", async (db) => {
    const userId = str(form, "user_id");
    const role = str(form, "role");
    if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Provide the invited user's Supabase user id (created via Auth → Invite).");
    if (!role || !["editor", "viewer"].includes(role)) throw new Error("Role must be editor or viewer.");
    await db.insert("project_members", { user_id: userId, role, access_state: "active", invited_email: str(form, "email") });
  }, "owner");
  done("/settings", "Member added");
}

export async function signOut() {
  const db = await getDb();
  if (db.mode === "live") {
    const { supabaseServer } = await import("./supabase/server");
    await (await supabaseServer()).auth.signOut();
  }
  redirect("/login");
}
