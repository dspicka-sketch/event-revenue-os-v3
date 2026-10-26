// Compare the latest computed revenue for an event with figures copied from
// the source system's own report.
// Usage: npm run reconcile:compare -- <orgId> <eventId> <report.json>
// report.json: { "currency": "USD", "filters": "...", "grossSales": 123456, "refunds": 0, ... } (minor units)
import { readFile } from "node:fs/promises";
import { createPool } from "../src/db/pool.js";
import { attachSourceReport, getEventSummary } from "../src/db/repo.js";
import { compareWithSourceReport, type SourceReportFigures } from "../src/domain/revenue.js";

const [orgId, eventId, file] = process.argv.slice(2);
if (!orgId || !eventId || !file) {
  console.error("Usage: npm run reconcile:compare -- <orgId> <eventId> <report.json>");
  process.exit(1);
}
const report = JSON.parse(await readFile(file, "utf8")) as SourceReportFigures;
if (!report.filters) throw new Error("report.filters must describe the source report's date range, statuses and fee settings.");
const db = createPool();
try {
  const ev = await getEventSummary(db, orgId, eventId);
  const cur = ev?.latest_result?.currencies.find((c) => c.currency === report.currency.toUpperCase());
  if (!cur) throw new Error("No computed revenue for that event/currency. Run a sync first.");
  const rows = compareWithSourceReport(cur, report);
  await attachSourceReport(db, orgId, eventId, report, rows);
  for (const r of rows) console.log(`${r.explained ? "OK  " : "DIFF"} ${r.label}: RevOS ${r.left.minor} vs report ${r.right.minor} (diff ${r.difference})`);
  if (rows.some((r) => !r.explained)) process.exitCode = 2;
} finally {
  await db.end();
}
