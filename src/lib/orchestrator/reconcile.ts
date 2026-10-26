import type { Brief, Job, Run } from "./types";

const IMPACT = { severe: 4, high: 3, medium: 2, low: 1, unknown: 0 } as const;
const LIKELIHOOD = { high: 3, medium: 2, low: 1, unknown: 0 } as const;

/**
 * Chief-of-staff reconciliation. Deterministic so that invariants hold regardless of model
 * behavior: disagreements are preserved, agreement between agents is not counted as
 * independent evidence, and at most three next actions are surfaced.
 */
export function reconcile(run: Run, jobs: Job[], mode: Brief["mode"]): Brief {
  const done = jobs.filter((j) => j.state === "completed" && j.output?.publishable);
  const what_changed: string[] = [];
  const supporting: Brief["supporting_evidence"] = [];
  const byConflict = new Map<string, { role: string; statement: string; evidence_class: string }[]>();
  const risks: Brief["risks"] = [];
  const decisions: Brief["decisions_needed"] = [];
  const tasks: { title: string; role: string }[] = [];
  const unknowns = new Set<string>();

  for (const j of done) {
    const out = j.output!.publishable!;
    what_changed.push(`${j.role}: ${out.summary}`);
    for (const f of out.findings) {
      if (f.source_refs.length) {
        supporting.push({ statement: f.statement, evidence_class: f.evidence_class, source_ids: [...new Set(f.source_refs.map((r) => r.source_id))], role: j.role });
      }
      if (f.conflict_key) {
        const list = byConflict.get(f.conflict_key) ?? [];
        list.push({ role: j.role, statement: f.statement, evidence_class: f.evidence_class });
        byConflict.set(f.conflict_key, list);
      }
    }
    out.proposed_risks.forEach((r) => risks.push({ title: r.title, likelihood: r.likelihood, impact: r.impact, role: j.role }));
    out.proposed_decisions.forEach((d) =>
      decisions.push({
        question: d.question,
        alternatives: d.alternatives.map((a) => a.label),
        recommendation: d.recommendation ?? null,
        owner: d.owner ?? "Daniel",
        deadline: "Not established",
      }),
    );
    out.proposed_tasks.forEach((t) => tasks.push({ title: t.title, role: j.role }));
    out.unknowns.forEach((u) => unknowns.add(u));
  }

  const conflicts: Brief["conflicts"] = [];
  for (const [key, positions] of byConflict) {
    const distinct = new Set(positions.map((p) => p.statement.trim().toLowerCase()));
    if (distinct.size > 1) {
      conflicts.push({
        key,
        positions,
        evidence_needed: `A primary source that resolves "${key}". Agreement between agents does not count as independent evidence.`,
      });
    }
  }

  risks.sort((a, b) => IMPACT[b.impact as keyof typeof IMPACT] - IMPACT[a.impact as keyof typeof IMPACT] || LIKELIHOOD[b.likelihood as keyof typeof LIKELIHOOD] - LIKELIHOOD[a.likelihood as keyof typeof LIKELIHOOD]);

  const candidates: Brief["next_actions"] = [
    ...conflicts.map((c) => ({ action: `Resolve conflicting findings on ${c.key}`, why: c.evidence_needed, link: `#conflict-${c.key}` })),
    ...decisions.map((d) => ({ action: `Decide: ${d.question}`, why: d.recommendation ? `Recommended: ${d.recommendation}` : "Alternatives listed; no recommendation", link: "/decisions" })),
    ...tasks.map((t) => ({ action: t.title, why: `Proposed by ${t.role}`, link: "/tasks" })),
  ];

  const failures = jobs
    .filter((j) => j.state !== "completed")
    .map((j) => ({ role: j.role, state: j.state, error: j.error }));
  const issues = jobs.flatMap((j) => (j.output?.issues ?? []).map((i) => ({ role: j.role, path: i.path, message: i.message })));

  return {
    question: run.question,
    generated_at: new Date().toISOString(),
    what_changed,
    supporting_evidence: supporting,
    conflicts,
    risks: risks.slice(0, 10),
    decisions_needed: decisions,
    next_actions: candidates.slice(0, 3),
    unknowns: [...unknowns],
    partial_failures: failures,
    validation_issues: issues,
    injection_flags: jobs.flatMap((j) => j.output?.injectionFlags ?? []),
    mode,
    narrative: null,
  };
}
