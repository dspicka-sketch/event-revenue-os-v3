// Builds fixtures/demo-snapshot.json for the isolated DEMO mode.
// The inherited baseline comes from the real seed function (single source of truth); every
// additional record is SYNTHETIC and labeled as such. Requires a local Postgres (see README).
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { Pool } from "pg";
import { EXPORT_TABLES } from "../src/lib/export";

const DB = "p104demo";
const DEMO_OWNER = "00000000-0000-4000-8000-00000000de30";

async function main() {
  execFileSync("bash", ["scripts/db-reset-local.sh", DB], { stdio: "inherit" });
  const pool = new Pool({ host: process.env.PGHOST ?? "localhost", user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: DB });
  const c = await pool.connect();
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [DEMO_OWNER]);
  const project = (await c.query("select public.create_project('Protect 104 N. Main Street (DEMO)', $1) id", [
    "DEMO COPY — see live project for the approved mission.",
  ])).rows[0].id as string;
  await c.query("select public.seed_protect104_baseline($1)", [project]);

  // ---- SYNTHETIC records (never real people, funders, amounts or deadlines) ----
  const opp = (await c.query(
    "insert into public.opportunities (project_id, name, funder, stage, synthetic) values ($1,'SYNTHETIC Capital Grant Program','SYNTHETIC Foundation','identified',true) returning id",
    [project],
  )).rows[0].id;
  const fc = (await c.query(
    "insert into public.funding_commitments (project_id, opportunity_id, funder, stage, amount_cents, restricted_to, restriction, synthetic) values ($1,$2,'SYNTHETIC Donor A','binding_commitment',10000000,'acquisition','SYNTHETIC: acquisition only',true) returning id",
    [project, opp],
  )).rows[0].id;
  await c.query("insert into public.receipts (project_id, commitment_id, amount_cents, received_on, synthetic) values ($1,$2,4000000,'2026-10-20',true)", [project, fc]);
  await c.query("insert into public.funding_commitments (project_id, funder, stage, amount_cents, restricted_to, restriction, synthetic) values ($1,'SYNTHETIC Donor B','conditional_pledge',5000000,'operating','SYNTHETIC: conditional on match',true)", [project]);
  await c.query("insert into public.funding_commitments (project_id, funder, stage, synthetic) values ($1,'SYNTHETIC Foundation application','application',true)", [project]);
  await c.query("insert into public.stakeholders (project_id, name, entity, role, privacy, relationship, synthetic, source_note) values ($1,'SYNTHETIC Operator','SYNTHETIC Theater Co.','Existing cultural operator','private','Unknown — listening session not held',true,'Synthetic demo record')", [project]);
  const sc = (await c.query("insert into public.financial_scenarios (project_id, name, status, notes) values ($1,'SYNTHETIC base case','draft','Synthetic numbers for demo only. Purchase price and capital target are Not established.') returning id", [project])).rows[0].id;
  for (const [label, kind, boundary, period, amount, state, key] of [
    ["Purchase price", "use", "property", "one_time", null, "accepted", null],
    ["SYNTHETIC repairs allowance", "use", "property", "one_time", 15000000, "proposed", null],
    ["SYNTHETIC Donor A (binding)", "source", "property", "one_time", 10000000, "accepted", null],
    ["Rent from operator (SYNTHETIC)", "income", "property", "annual", 1560000, "accepted", "operator_rent"],
    ["Operator rent to property (SYNTHETIC)", "expense", "operator", "annual", 1560000, "accepted", "operator_rent"],
    ["SYNTHETIC insurance", "expense", "property", "annual", 900000, "accepted", null],
    ["Investor-deck income figure (REJECTED: quarantined source)", "income", "property", "annual", 9000000, "rejected", null],
  ] as const) {
    await c.query(
      "insert into public.financial_lines (project_id, scenario_id, label, line_kind, boundary, period, amount_cents, assumption_state, internal_transfer_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [project, sc, label, kind, boundary, period, amount, state, key],
    );
  }

  const tables: Record<string, unknown[]> = {};
  for (const t of [...EXPORT_TABLES, "projects", "project_members", "integrations", "audit_events"]) {
    const col = t === "projects" ? "id" : "project_id";
    tables[t] = (await c.query(`select * from public.${t} where ${col} = $1 order by created_at`, [project])).rows;
  }
  await c.query("commit");
  c.release();
  await pool.end();

  mkdirSync("fixtures", { recursive: true });
  writeFileSync(
    "fixtures/demo-snapshot.json",
    JSON.stringify({ _notice: "DEMO FIXTURE. Inherited baseline references plus SYNTHETIC records. Not live data.", demo_owner: DEMO_OWNER, project_id: project, tables }, null, 1),
  );
  console.log(`wrote fixtures/demo-snapshot.json (project ${project})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
