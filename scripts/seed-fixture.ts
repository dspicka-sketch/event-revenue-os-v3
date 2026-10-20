// Creates an isolated FIXTURE organization with two performances of the
// synthetic show. Never touches live organizations.
import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { createConnection, createMappedEvent, createOrganization } from "../src/db/repo.js";
import { FIXTURE_ACCOUNT_ID, pilotFixture } from "../src/providers/eventbrite/fixtures.js";
import { syncEvent } from "../src/sync/syncEvent.js";

const db = createPool();
try {
  await migrate(db);
  const existing = await db.query("SELECT id FROM organizations WHERE is_fixture AND name = $1", ["[FIXTURE] Demo Venue"]);
  if (existing.rowCount) {
    console.log(`Fixture organization already exists: ${existing.rows[0].id}`);
  } else {
    const org = await createOrganization(db, { name: "[FIXTURE] Demo Venue", isFixture: true });
    // Fixture-only assumption so the proceeds derivation path can be exercised.
    // Live connections start as 'unverified' until fee ownership is documented.
    const conn = await createConnection(db, {
      organizationId: org.id, provider: "eventbrite", providerAccountId: FIXTURE_ACCOUNT_ID, mode: "fixture",
      secretRef: null, proceedsPolicy: "gross_minus_fees_and_tax",
    });
    for (const ev of pilotFixture()) {
      const { canonicalEventId } = await createMappedEvent(db, {
        organizationId: org.id, connectionId: conn.id, sourceEventId: ev.event.id,
        name: ev.event.name!.text!, startUtc: ev.event.start!.utc!,
      });
      const out = await syncEvent(db, org.id, canonicalEventId);
      console.log(`Fixture event ${ev.event.id}: ${out.ok ? "synced" : `FAILED ${out.kind}: ${out.message}`}`);
    }
    console.log(`Fixture organization created: ${org.id}`);
  }
} finally {
  await db.end();
}
