// Manual one-off sync of a mapped event: npm run sync -- <orgId> <eventId>
import { createPool } from "../src/db/pool.js";
import { actionFor } from "../src/providers/errors.js";
import { syncEvent } from "../src/sync/syncEvent.js";

const [orgId, eventId] = process.argv.slice(2);
if (!orgId || !eventId) {
  console.error("Usage: npm run sync -- <organizationId> <canonicalEventId>");
  process.exit(1);
}
const db = createPool();
try {
  const out = await syncEvent(db, orgId, eventId);
  if (out.ok) {
    console.log(`Sync ${out.runId} succeeded: ${out.counts.inserted} new, ${out.counts.updated} updated, ${out.counts.missing} newly missing orders.`);
    for (const c of out.revenue.currencies) {
      console.log(`${c.currency}: paid tickets ${c.tickets.paid}, gross ${c.measures.grossSales.minor} (${c.measures.grossSales.status}), refunds ${c.measures.refunds.minor}`);
    }
    console.log(`${out.revenue.exceptions.length} exception(s).`);
  } else {
    console.error(`Sync failed [${out.kind}]: ${out.message}\n${actionFor(out.kind)}`);
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
