// Test 16: export → reimport round trip preserves evidence classes, source links,
// restrictions, dates and decision history; secrets and signed URLs are absent.
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Pool } from "pg";
import { as, pool, resetDb } from "./helpers";
import { buildExport, EXPORT_TABLES, prepareImport } from "@/lib/export";

const OWNER = "00000000-0000-4000-8000-0000000000d1";
let p: Pool;
let A: string;
let B: string;

beforeAll(async () => {
  resetDb();
  p = pool();
  [A, B] = await as(p, OWNER, async (c) => {
    const a = (await c.query("select public.create_project('A','m') id")).rows[0].id;
    const b = (await c.query("select public.create_project('B','m') id")).rows[0].id;
    await c.query("select public.seed_protect104_baseline($1)", [a]);
    const s = (await c.query("insert into public.sources (project_id, kind, title, availability, original_url) values ($1,'document','Signed URL test','available','https://x.supabase.co/storage/v1/object/sign/sources/a.pdf?token=abc') returning id", [a])).rows[0].id;
    await c.query("insert into public.source_versions (project_id, source_id, version_no, checksum_sha256, mime_type, size_bytes, storage_key, extracted_text, extraction_state) values ($1,$2,1,$3,'text/plain',5,'secret/key','hello','succeeded')", [a, s, "b".repeat(64)]);
    const fc = (await c.query("insert into public.funding_commitments (project_id, funder, stage, amount_cents, restricted_to, restriction, expires_on, synthetic) values ($1,'SYNTHETIC Funder','binding_commitment',10000000,'acquisition','Acquisition only','2027-06-30',true) returning id", [a])).rows[0].id;
    await c.query("insert into public.receipts (project_id, commitment_id, amount_cents, received_on, synthetic) values ($1,$2,4000000,'2026-11-01',true)", [a, fc]);
    const d = (await c.query("select id, row_version from public.decisions where project_id=$1 order by created_at limit 1", [a])).rows[0];
    await c.query("update public.decisions set state='deferred', rationale='awaiting counsel', row_version=$2 where id=$1", [d.id, d.row_version]);
    return [a, b];
  }, true);
});
afterAll(async () => p?.end());

async function exportOf(projectId: string) {
  return as(p, OWNER, async (c) => {
    const proj = (await c.query("select id, name, mission, timezone, stage from public.projects where id=$1", [projectId])).rows[0];
    return buildExport(proj, async (t) => (await c.query(`select * from public.${t} where project_id=$1 order by created_at, id`, [projectId])).rows);
  });
}

function shape(exp: Awaited<ReturnType<typeof exportOf>>) {
  const t = exp.tables as any;
  const claimCode = new Map(t.claims.map((c: any) => [c.id, c.code ?? c.statement]));
  const srcCode = new Map(t.sources.map((s: any) => [s.id, s.register_code ?? s.title]));
  return {
    claims: t.claims.map((c: any) => [c.code, c.evidence_class, c.review_state, c.inherited_unverified]).sort(),
    links: t.claim_sources.map((l: any) => `${claimCode.get(l.claim_id)}->${srcCode.get(l.source_id)}@${l.locator}`).sort(),
    decisions: t.decisions.map((d: any) => [d.question, d.state, d.rationale, d.decided_by]).sort(),
    commitments: t.funding_commitments.map((f: any) => [f.restricted_to, f.restriction, String(f.amount_cents), new Date(f.expires_on).toISOString().slice(0, 10)]),
    receipts: t.receipts.map((r: any) => [String(r.amount_cents), new Date(r.received_on).toISOString().slice(0, 10)]),
    prices: t.price_observations.map((x: any) => [x.kind, String(x.amount_cents), x.comparator, x.observed_on ? new Date(x.observed_on).toISOString().slice(0, 10) : null]).sort(),
  };
}

it("round trip preserves records and strips secrets", async () => {
  const first = await exportOf(A);
  const json = JSON.stringify(first);
  expect(json).not.toMatch(/token=abc/);
  expect(json).not.toMatch(/secret\/key/);
  expect(json).not.toMatch(/"extracted_text"/);

  const { rows } = prepareImport(JSON.parse(json), B);
  await as(p, OWNER, async (c) => {
    for (const t of EXPORT_TABLES) if (rows[t].length) await c.query("select public.import_rows($1,$2,$3)", [B, t, JSON.stringify(rows[t])]);
  }, true);
  const second = await exportOf(B);
  expect(shape(second)).toEqual(shape(first));
  expect(shape(first).decisions.some((d: any) => d[1] === "deferred" && d[3] === OWNER)).toBe(true);
});
