import { randomUUID } from "node:crypto";
import { z } from "zod";

export const EXPORT_FORMAT = "protect104-export@1";

/** Tables included in an export, in dependency order for re-import. */
export const EXPORT_TABLES = [
  "sources",
  "source_versions",
  "claims",
  "claim_sources",
  "tasks",
  "task_dependencies",
  "risks",
  "decisions",
  "price_observations",
  "property_checks",
  "governance_options",
  "stakeholders",
  "interactions",
  "opportunities",
  "funding_commitments",
  "receipts",
  "financial_scenarios",
  "financial_lines",
  "drafts",
  "approvals",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

// Columns that must never leave the database in an export.
const STRIP = new Set(["extracted_text", "signed_url", "access_token", "refresh_token", "storage_key"]);
const SECRETISH = /(token|secret|password|api[_-]?key|signature=|X-Amz-|sig=)/i;

export const ExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  exported_at: z.string(),
  project: z.object({ id: z.string(), name: z.string(), mission: z.string(), timezone: z.string(), stage: z.string() }),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type ProjectExport = z.infer<typeof ExportSchema>;

export function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (STRIP.has(k)) continue;
    if (typeof v === "string" && /^https?:\/\//.test(v) && SECRETISH.test(v)) continue; // signed/expiring URLs
    out[k] = v;
  }
  return out;
}

export async function buildExport(
  project: ProjectExport["project"],
  fetchTable: (t: ExportTable) => Promise<Record<string, unknown>[]>,
  now = new Date(),
): Promise<ProjectExport> {
  const tables: ProjectExport["tables"] = {};
  for (const t of EXPORT_TABLES) tables[t] = (await fetchTable(t)).map(sanitizeRow);
  return { format: EXPORT_FORMAT, exported_at: now.toISOString(), project, tables };
}

// Foreign keys to remap on import (column -> referenced table).
const FK: Partial<Record<ExportTable, Record<string, ExportTable>>> = {
  source_versions: { source_id: "sources" },
  claims: { supersedes_id: "claims" },
  claim_sources: { claim_id: "claims", source_id: "sources", source_version_id: "source_versions" },
  task_dependencies: { task_id: "tasks", depends_on_id: "tasks" },
  price_observations: { claim_id: "claims" },
  governance_options: { decision_id: "decisions" },
  stakeholders: { support_claim_id: "claims" },
  interactions: { stakeholder_id: "stakeholders" },
  opportunities: { eligibility_claim_id: "claims" },
  funding_commitments: { opportunity_id: "opportunities", agreement_source_id: "sources" },
  receipts: { commitment_id: "funding_commitments", source_id: "sources" },
  financial_lines: { scenario_id: "financial_scenarios", source_claim_id: "claims" },
  approvals: { record_id: "drafts" },
};
const FK_ARRAYS: Partial<Record<ExportTable, Record<string, ExportTable>>> = {
  risks: { claim_ids: "claims", task_ids: "tasks" },
  decisions: { claim_ids: "claims" },
  property_checks: { claim_ids: "claims" },
};
const DROP_ON_IMPORT = new Set(["id", "project_id", "row_version"]);

/**
 * Prepare an export for import into `targetProjectId`: new ids, remapped references,
 * original ids preserved under `imported_from` in the returned map.
 */
export function prepareImport(data: unknown, targetProjectId: string) {
  const exp = ExportSchema.parse(data);
  const idMap = new Map<string, string>();
  for (const t of EXPORT_TABLES) for (const r of exp.tables[t] ?? []) idMap.set(String(r.id), randomUUID());
  const rows: Record<ExportTable, Record<string, unknown>[]> = {} as any;
  for (const t of EXPORT_TABLES) {
    rows[t] = (exp.tables[t] ?? []).map((r) => {
      const o: Record<string, unknown> = { id: idMap.get(String(r.id)), project_id: targetProjectId, row_version: 1 };
      for (const [k, v] of Object.entries(r)) {
        if (DROP_ON_IMPORT.has(k)) continue;
        if (FK[t]?.[k] && v) o[k] = idMap.get(String(v)) ?? null;
        else if (FK_ARRAYS[t]?.[k] && Array.isArray(v)) o[k] = v.map((x) => idMap.get(String(x))).filter(Boolean);
        else o[k] = v;
      }
      return o;
    });
  }
  return { rows, idMap, source: exp };
}
