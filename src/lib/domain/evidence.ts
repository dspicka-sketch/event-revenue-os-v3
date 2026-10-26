import { createHash } from "node:crypto";
import { z } from "zod";
import { ROLE_KEYS } from "./roles";

export const EVIDENCE_CLASSES = [
  "verified_current",
  "documented_historical",
  "user_reported",
  "proposed",
  "inferred",
  "unknown",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const EVIDENCE_LABELS: Record<EvidenceClass, string> = {
  verified_current: "Verified current",
  documented_historical: "Documented (historical)",
  user_reported: "User reported",
  proposed: "Proposed",
  inferred: "Inferred",
  unknown: "Unknown",
};

const SourceRef = z.object({
  source_id: z.string().min(1),
  locator: z.string().max(200).optional(),
  passage: z.string().max(1200).optional(),
});

export const SpecialistOutputSchema = z.object({
  summary: z.string().min(1).max(4000),
  findings: z
    .array(
      z.object({
        statement: z.string().min(1).max(1500),
        evidence_class: z.enum(EVIDENCE_CLASSES),
        source_refs: z.array(SourceRef).max(10).default([]),
        limits: z.string().max(1000).optional(),
        conflict_key: z.string().max(80).optional(),
      }),
    )
    .max(20),
  unknowns: z.array(z.string().max(500)).max(20).default([]),
  recommendations: z.array(z.string().max(800)).max(10).default([]),
  proposed_tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        assigned_role: z.enum(ROLE_KEYS).optional(),
        next_action: z.string().max(500).optional(),
        rationale: z.string().max(800).optional(),
      }),
    )
    .max(10)
    .default([]),
  proposed_risks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        likelihood: z.enum(["unknown", "low", "medium", "high"]).default("unknown"),
        impact: z.enum(["unknown", "low", "medium", "high", "severe"]).default("unknown"),
        mitigation: z.string().max(800).optional(),
      }),
    )
    .max(10)
    .default([]),
  proposed_decisions: z
    .array(
      z.object({
        question: z.string().min(1).max(400),
        recommendation: z.string().max(1000).optional(),
        alternatives: z
          .array(z.object({ label: z.string().max(200), implications: z.string().max(800).optional() }))
          .min(2)
          .max(6),
        owner: z.string().max(100).optional(),
      }),
    )
    .max(5)
    .default([]),
  drafts: z
    .array(
      z.object({
        kind: z.enum(["email", "inquiry", "memo", "listening_guide", "other"]),
        title: z.string().min(1).max(200),
        audience: z.string().max(300).optional(),
        body: z.string().min(1).max(8000),
      }),
    )
    .max(5)
    .default([]),
  approval_requests: z
    .array(
      z.object({
        action_kind: z.enum([
          "external_send",
          "invitation",
          "publication",
          "grant_submission",
          "financial_commitment",
          "paid_service",
          "signature",
          "binding_representation",
        ]),
        target: z.string().max(300),
        reason: z.string().max(800),
        draft_title: z.string().max(200).optional(),
      }),
    )
    .max(5)
    .default([]),
});
export type SpecialistOutput = z.infer<typeof SpecialistOutputSchema>;

// Statements that the evidence baseline specifically forbids, keyed by the reason.
const FORBIDDEN_ASSERTIONS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b501\s*\(c\)\s*\(3\)[^.]{0,60}\b(approved|granted|determined|confirmed|recognized)\b|\b(approved|granted|recognized)\b[^.]{0,40}\b501\s*\(c\)\s*\(3\)/i,
    reason: "A 1023-EZ submission is not an IRS determination; exemption status is not established.",
  },
  {
    pattern: /\btax[- ]exempt status (is|was|has been) (approved|granted|confirmed)/i,
    reason: "Exemption status is not established.",
  },
  {
    pattern: /\b(occupancy|tenancy|lease)\b[^.]{0,50}\b(is|are|remains)\s+(secure|secured|guaranteed|protected)\b/i,
    reason: "Lease terms are not proof of execution; month-to-month terms do not secure occupancy.",
  },
  {
    pattern: /\b(legally (approved|enforceable|binding)|legal approval (is|has been) (given|granted)|this is (legal advice|privileged))\b/i,
    reason: "The general counsel function cannot give legal approval or privilege.",
  },
  {
    pattern: /\b(endorsed by|affiliated with|member of)\s+(niva|nivf|cast)\b/i,
    reason: "No membership, affiliation, or endorsement is established.",
  },
  {
    pattern: /\b(seller|owner|paul)\b[^.]{0,40}\b(accepted|agreed to)\b[^.]{0,40}\b(option|offer|proposal|price)\b/i,
    reason: "No seller acceptance of the September proposal is established.",
  },
  {
    pattern: /\b(landmark|historic(ally)?)\s+(status|protection|designation)\s+(is|exists|applies)\b/i,
    reason: "Landmark protection is not established.",
  },
  {
    pattern: /\b(city|council)\s+(supports|backs|has endorsed)\b/i,
    reason: "City support is not established.",
  },
];

// Topics that always require a citation, whatever evidence class the model chose.
const CITATION_REQUIRED = /\b(eligib\w*|deadline|due (on|by)|grant (award|amount)|apn|parcel|zon(ed|ing)|title|owner of record)\b/i;

export interface ValidationIssue {
  path: string;
  message: string;
  kind: "schema" | "unsupported_source" | "missing_citation" | "forbidden_assertion" | "verification_claim";
}

export interface ValidationResult {
  ok: boolean;
  output: SpecialistOutput | null;
  /** findings that passed; rejected findings are excluded from publication */
  publishable: SpecialistOutput | null;
  issues: ValidationIssue[];
}

/**
 * Validate a specialist's output against schema and evidence rules.
 * Unsupported findings are excluded from publication; the caller turns `issues` into
 * correction tasks. Schema failures reject the whole output.
 */
export function validateSpecialistOutput(raw: unknown, allowedSourceIds: Set<string>): ValidationResult {
  const parsed = SpecialistOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      output: null,
      publishable: null,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, kind: "schema" })),
    };
  }
  const out = parsed.data;
  const issues: ValidationIssue[] = [];
  const keepFindings: SpecialistOutput["findings"] = [];

  const textIssues = (text: string, path: string) => {
    for (const f of FORBIDDEN_ASSERTIONS) {
      if (f.pattern.test(text)) issues.push({ path, message: f.reason, kind: "forbidden_assertion" });
    }
  };

  out.findings.forEach((f, i) => {
    const before = issues.length;
    const path = `findings.${i}`;
    for (const ref of f.source_refs) {
      if (!allowedSourceIds.has(ref.source_id)) {
        issues.push({ path, message: `Cited source "${ref.source_id}" is not in the run's evidence scope.`, kind: "unsupported_source" });
      }
    }
    if (f.evidence_class === "verified_current") {
      issues.push({ path, message: "Agents cannot assign verified_current; a named human reviewer verifies.", kind: "verification_claim" });
    }
    if ((f.evidence_class === "documented_historical" || f.evidence_class === "user_reported") && f.source_refs.length === 0) {
      issues.push({ path, message: `${f.evidence_class} findings must cite a source.`, kind: "missing_citation" });
    }
    if (CITATION_REQUIRED.test(f.statement) && f.source_refs.length === 0 && f.evidence_class !== "unknown") {
      issues.push({ path, message: "This kind of statement (eligibility, deadline, title, zoning) requires a cited source.", kind: "missing_citation" });
    }
    textIssues(f.statement, path);
    if (issues.length === before) keepFindings.push(f);
  });

  out.recommendations.forEach((r, i) => textIssues(r, `recommendations.${i}`));
  textIssues(out.summary, "summary");
  const summaryRejected = issues.some((x) => x.path === "summary" || x.path.startsWith("recommendations"));

  const publishable: SpecialistOutput = {
    ...out,
    summary: summaryRejected ? "[Summary withheld: failed evidence validation]" : out.summary,
    recommendations: out.recommendations.filter((_, i) => !issues.some((x) => x.path === `recommendations.${i}`)),
    findings: keepFindings,
  };
  return { ok: issues.length === 0, output: out, publishable, issues };
}

// Instruction-like text inside a source. Detection only labels it for reviewers; sources
// are always passed to models as delimited data and no tool can act on embedded instructions.
const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /\b(you are now|new instructions|system prompt)\b/i,
  /\b(send|email|forward|upload|post)\b[^.]{0,60}\b(to|at)\b[^.]{0,40}(@|https?:\/\/)/i,
  /\boverride\b[^.]{0,40}\b(mission|policy|rules)\b/i,
];

export function detectEmbeddedInstructions(text: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

export function wrapUntrustedSource(sourceId: string, title: string, text: string): string {
  const safe = text.replaceAll("</untrusted_source>", "</untrusted_source_>");
  return `<untrusted_source id="${sourceId}" title="${title.replaceAll('"', "'")}">\n${safe}\n</untrusted_source>`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Must match public.draft_hash() in the database. */
export function draftContentHash(title: string, audience: string | null | undefined, body: string): string {
  return sha256Hex(`${title}\x1f${audience ?? ""}\x1f${body}`);
}
